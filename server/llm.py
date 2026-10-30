import base64
import json
import math
import re
from dataclasses import dataclass

import httpx

from . import db
from .auth import decrypt_key
from .config import UPLOAD_DIR


class ModelError(Exception):
    pass


def estimate_tokens(text):
    text = str(text)
    non_ascii = sum(ord(char) > 127 for char in text)
    return max(1, math.ceil(non_ascii * 1.5 + (len(text) - non_ascii) / 3))


def estimate_messages(messages):
    return sum(estimate_tokens(m.get("content", "")) + 12 + 2048 * len(m.get("images", [])) for m in messages)


def extract_json(text):
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.IGNORECASE)
    start = cleaned.find("{")
    if start < 0:
        raise ValueError("模型未返回结构化内容")
    value, _ = json.JSONDecoder().raw_decode(cleaned[start:])
    if not isinstance(value, dict):
        raise ValueError("模型返回的内容不是对象")
    return value


def endpoint(base, schema):
    suffix = {"chat_completions": "/chat/completions", "responses": "/responses", "anthropic": "/messages"}[schema]
    for ending in ("/chat/completions", "/responses", "/messages"):
        if base.endswith(ending):
            base = base[:-len(ending)]
            break
    return base.rstrip("/") + suffix


def image_data(image):
    row = db.one("SELECT * FROM uploads WHERE id=?", (image["id"],))
    if not row:
        raise ModelError("对话中的图片已不可用，请重新上传")
    try:
        data = base64.b64encode((UPLOAD_DIR / row["filename"]).read_bytes()).decode()
    except OSError as exc:
        raise ModelError("图片文件无法读取，请重新上传") from exc
    return row["mime_type"], data


def request_payload(model, messages):
    schema = model["schema_type"]
    system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
    converted = []
    for message in messages:
        role = message["role"]
        if role == "system":
            continue
        content = message.get("content", "")
        images = message.get("images", [])
        if images and not model["supports_images"]:
            content += "\n[这条历史消息含图片，当前模型不具备图片能力；请依据已有文字信息，不臆测牌面或图片内容。]"
            images = []
        if schema == "chat_completions":
            parts = [{"type": "text", "text": content or "请理解这张图片"}]
            for image in images:
                mime, data = image_data(image)
                parts.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{data}"}})
            converted.append({"role": role, "content": parts if images else content})
        elif schema == "responses":
            text_type = "output_text" if role == "assistant" else "input_text"
            parts = [{"type": text_type, "text": content or "请理解这张图片"}]
            for image in images:
                mime, data = image_data(image)
                parts.append({"type": "input_image", "image_url": f"data:{mime};base64,{data}"})
            converted.append({"role": role, "content": parts})
        else:
            parts = []
            for image in images:
                mime, data = image_data(image)
                parts.append({"type": "image", "source": {"type": "base64", "media_type": mime, "data": data}})
            parts.append({"type": "text", "text": content or "请理解这张图片"})
            if converted and converted[-1]["role"] == role:
                converted[-1]["content"].extend(parts)
            else:
                converted.append({"role": role, "content": parts})
    payload = {"model": model["model_id"], "stream": True}
    effort = model["reasoning_effort"]
    custom_field = model.get("reasoning_field", "")
    output = model["max_output_tokens"]
    if schema == "chat_completions":
        payload["messages"] = ([{"role": "system", "content": system}] if system else []) + converted
        payload["stream_options"] = {"include_usage": True}
        token_key = "max_completion_tokens" if re.match(r"^(o[1-9]|gpt-5)", model["model_id"]) else "max_tokens"
        payload[token_key] = output
        if effort != "none" and not custom_field:
            payload["reasoning_effort"] = effort
    elif schema == "responses":
        payload.update(instructions=system, input=converted, max_output_tokens=output, store=False)
        if effort != "none" and not custom_field:
            payload["reasoning"] = {"effort": effort, "summary": "auto"}
    else:
        payload.update(messages=converted, max_tokens=output)
        if system:
            payload["system"] = system
        if effort != "none" and not custom_field:
            budgets = {"low": 1024, "medium": 4096, "high": 8192, "xhigh": 16384, "max": 32768}
            if effort not in budgets:
                raise ModelError("此 Anthropic 思考级别需要配置自定义请求字段")
            payload["thinking"] = {"type": "enabled", "budget_tokens": min(budgets[effort], output - 1024)}
    if effort != "none" and custom_field:
        target = payload
        keys = custom_field.split(".")
        for key in keys[:-1]:
            target = target.setdefault(key, {})
        target[keys[-1]] = effort
    return payload


@dataclass
class Usage:
    input_tokens: int | None = None
    output_tokens: int | None = None
    cached_tokens: int | None = None

    def update(self, value, schema):
        if not isinstance(value, dict):
            return
        if schema == "anthropic":
            if "input_tokens" in value:
                self.input_tokens = int(value["input_tokens"]) + int(value.get("cache_creation_input_tokens") or 0) + int(value.get("cache_read_input_tokens") or 0)
            if "output_tokens" in value:
                self.output_tokens = int(value["output_tokens"])
            if "cache_read_input_tokens" in value:
                self.cached_tokens = int(value["cache_read_input_tokens"])
        else:
            input_key, output_key = ("prompt_tokens", "completion_tokens") if schema == "chat_completions" else ("input_tokens", "output_tokens")
            if input_key in value:
                self.input_tokens = int(value[input_key])
            if output_key in value:
                self.output_tokens = int(value[output_key])
            details = value.get("prompt_tokens_details" if schema == "chat_completions" else "input_tokens_details") or {}
            if "cached_tokens" in details:
                self.cached_tokens = int(details["cached_tokens"])
            elif "prompt_cache_hit_tokens" in value:
                self.cached_tokens = int(value["prompt_cache_hit_tokens"])


def record_usage(model, user, purpose, usage, messages, text):
    estimated = usage.input_tokens is None or usage.output_tokens is None
    input_count = usage.input_tokens if usage.input_tokens is not None else estimate_messages(messages)
    output_count = usage.output_tokens if usage.output_tokens is not None else (estimate_tokens(text) if text else 0)
    cached = min(max(0, usage.cached_tokens), input_count) if usage.cached_tokens is not None else None
    with db.connect() as connection:
        user_id = user["id"] if connection.execute("SELECT 1 FROM users WHERE id=?", (user["id"],)).fetchone() else None
        model_id = model["id"] if connection.execute("SELECT 1 FROM models WHERE id=?", (model["id"],)).fetchone() else None
        connection.execute("INSERT INTO usage VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                           (db.uid(), user_id, model_id, user["username"], model["name"], purpose,
                            input_count, output_count, cached, int(estimated), db.now()))


async def sse_data(response):
    data_lines = []
    async for line in response.aiter_lines():
        if line.startswith("data:"):
            data_lines.append(line[5:].lstrip())
        elif not line and data_lines:
            yield "\n".join(data_lines)
            data_lines = []
    if data_lines:
        yield "\n".join(data_lines)


async def stream(model, user, purpose, messages, *, include_reasoning=False):
    payload = request_payload(model, messages)
    headers = {"Content-Type": "application/json", "Accept": "text/event-stream"}
    key = decrypt_key(model["api_key"])
    schema = model["schema_type"]
    if schema == "anthropic":
        headers["anthropic-version"] = "2023-06-01"
        if key:
            headers["x-api-key"] = key
    elif key:
        headers["Authorization"] = f"Bearer {key}"
    usage, output, reasoning_output, accepted, ended = Usage(), [], [], False, False
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=20)) as client:
            async with client.stream("POST", endpoint(model["base_url"], schema), headers=headers, json=payload) as response:
                if response.status_code >= 400:
                    hints = {401: "API Key 无效", 403: "模型访问被拒绝", 404: "接入点或模型 ID 不存在", 429: "额度不足或请求过于频繁"}
                    hint = hints.get(response.status_code, "请核对模型、协议与思考参数")
                    raise ModelError(f"模型服务返回 HTTP {response.status_code}：{hint}")
                accepted = True
                if "text/event-stream" not in response.headers.get("content-type", ""):
                    raise ModelError("模型服务未返回流式响应，请检查 Schema 类型及接入点")
                async for raw in sse_data(response):
                    if raw.strip() == "[DONE]":
                        ended = True
                        continue
                    try:
                        event = json.loads(raw)
                    except json.JSONDecodeError as exc:
                        raise ModelError("模型流式响应格式异常，请重试") from exc
                    if event.get("error") or event.get("type") == "error":
                        raise ModelError("模型在生成过程中返回错误，请检查服务额度和配置")
                    text, reasoning = "", ""
                    if schema == "chat_completions":
                        usage.update(event.get("usage"), schema)
                        choices = event.get("choices") or []
                        if choices:
                            choice = choices[0]
                            reason = choice.get("finish_reason")
                            if reason in ("length", "content_filter"):
                                raise ModelError("模型输出被截断或过滤，请调整最大输出长度后重试")
                            if reason:
                                ended = True
                            delta = choice.get("delta") or {}
                            text = delta.get("content") or ""
                            reasoning = delta.get("reasoning_content") or delta.get("reasoning") or ""
                    elif schema == "responses":
                        kind = event.get("type", "")
                        if kind == "response.output_text.delta":
                            text = event.get("delta", "")
                        elif kind in ("response.reasoning_summary_text.delta", "response.reasoning_text.delta"):
                            reasoning = event.get("delta", "")
                        if kind in ("response.completed", "response.incomplete", "response.failed"):
                            result = event.get("response", {})
                            usage.update(result.get("usage"), schema)
                            if kind != "response.completed":
                                raise ModelError("模型未能完整输出，请调整输出预算或稍后重试")
                            ended = True
                    else:
                        kind = event.get("type", "")
                        if kind == "message_start":
                            usage.update(event.get("message", {}).get("usage"), schema)
                        elif kind == "content_block_delta" and event.get("delta", {}).get("type") == "text_delta":
                            text = event["delta"].get("text", "")
                        elif kind == "content_block_delta" and event.get("delta", {}).get("type") == "thinking_delta":
                            reasoning = event["delta"].get("thinking", "")
                        elif kind == "message_delta":
                            usage.update(event.get("usage"), schema)
                            if event.get("delta", {}).get("stop_reason") == "max_tokens":
                                raise ModelError("模型输出达到上限，请增大输出预算后重试")
                        elif kind == "message_stop":
                            ended = True
                    if isinstance(reasoning, str) and reasoning:
                        reasoning_output.append(reasoning)
                        if include_reasoning:
                            yield {"type": "reasoning", "text": reasoning}
                    if isinstance(text, str) and text:
                        output.append(text)
                        yield {"type": "text", "text": text} if include_reasoning else text
                if not ended:
                    raise ModelError("与模型的连接提前中断，请重试")
                if not output:
                    raise ModelError("模型未返回可展示内容，请检查思考预算或模型配置")
    except httpx.TimeoutException as exc:
        raise ModelError("模型响应超时，请稍后重试") from exc
    except httpx.RequestError as exc:
        raise ModelError("无法连接模型服务，请检查接入点和网络") from exc
    finally:
        if accepted:
            record_usage(model, user, purpose, usage, messages, "".join(reasoning_output + output))


async def complete(model, user, purpose, messages):
    parts = []
    async for text in stream(model, user, purpose, messages):
        parts.append(text)
    return "".join(parts)
