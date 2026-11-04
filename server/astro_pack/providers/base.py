"""标准库 HTTP、供应商错误与响应元数据。"""

import http.client
import json
import socket
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, Mapping, Optional, Tuple

from ..shared.config import Config
from ..shared.errors import ToolError
from ..shared.protocol import empty_meta, utc_now


MAX_RESPONSE_BYTES = 16 * 1024 * 1024


@dataclass
class HttpResponse:
    payload: Any
    headers: Mapping[str, str]


class BaseProvider:
    name = "base"
    base_url = ""
    documentation = ""

    def __init__(self, config: Config) -> None:
        self.config = config

    def can_handle(self, tool: str, payload: Dict[str, Any]) -> bool:
        raise NotImplementedError

    def execute(self, tool: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        raise NotImplementedError

    def cache_namespace(self) -> str:
        return self.name

    def request(
        self,
        method: str,
        path: str,
        query: Optional[Dict[str, Any]] = None,
        body: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> HttpResponse:
        url = self.base_url + path
        if query:
            clean = {key: value for key, value in query.items() if value is not None}
            url += "?" + urllib.parse.urlencode(clean, doseq=True)
        request_headers = {
            "Accept": "application/json",
            "User-Agent": self.config.user_agent,
        }
        if headers:
            request_headers.update(headers)
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            request_headers["Content-Type"] = "application/json; charset=utf-8"
        request = urllib.request.Request(url, data=data, headers=request_headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=self.config.timeout) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                response_headers = dict(response.headers.items())
        except urllib.error.HTTPError as error:
            raw = error.read(MAX_RESPONSE_BYTES)
            payload = decode_json(raw, required=False)
            raise self.http_error(error.code, payload, dict(error.headers.items()))
        except (urllib.error.URLError, socket.timeout, TimeoutError) as error:
            reason = getattr(error, "reason", error)
            raise ToolError(
                "NETWORK_ERROR",
                "%s 网络请求失败：%s" % (self.name, str(reason)[:300]),
                retryable=True,
            )
        except http.client.HTTPException as error:
            raise ToolError("NETWORK_ERROR", "%s HTTP 响应不完整或无效：%s" % (self.name, str(error)[:300]), retryable=True)
        except OSError as error:
            raise ToolError("NETWORK_ERROR", "%s 网络请求失败：%s" % (self.name, str(error)[:300]), retryable=True)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ToolError("PROVIDER_RESPONSE_ERROR", "%s 响应超过允许大小。" % self.name)
        payload = decode_json(raw, required=True)
        return HttpResponse(payload, response_headers)

    def http_error(self, status: int, payload: Any, headers: Dict[str, str]) -> ToolError:
        provider_code = None
        message = "%s 返回 HTTP %d。" % (self.name, status)
        details: Dict[str, Any] = {"http_status": status}
        if isinstance(payload, dict):
            error = payload.get("error")
            if isinstance(error, dict):
                provider_code = error.get("code")
                if error.get("message"):
                    message = str(error["message"])[:500]
                if "details" in error:
                    details["provider_details"] = error["details"]
            elif payload.get("detail") is not None:
                details["provider_details"] = payload["detail"]
        if provider_code:
            details["provider_code"] = provider_code
        retry_after = header(headers, "Retry-After") or header(headers, "X-RateLimit-Reset")
        if retry_after:
            details["retry_after"] = retry_after
        non_retryable_429 = {"CREDITS_EXHAUSTED", "SPEND_CAP_REACHED", "KEY_BUDGET_EXHAUSTED"}
        if status in {400, 404, 409, 422}:
            code = "PROVIDER_REQUEST_REJECTED"
            retryable = False
        elif status == 401:
            code = "AUTHENTICATION_FAILED"
            retryable = False
        elif status == 403:
            code = "PERMISSION_DENIED"
            retryable = False
        elif status == 402:
            code = "PAYMENT_REQUIRED"
            retryable = False
        elif status == 429:
            code = provider_code or "RATE_LIMIT"
            retryable = provider_code not in non_retryable_429
        elif status >= 500:
            code = "PROVIDER_UNAVAILABLE"
            retryable = True
        else:
            code = provider_code or "PROVIDER_ERROR"
            retryable = False
        return ToolError(code, message, retryable=retryable, details=details)

    def meta(
        self,
        endpoint: str,
        data_kind: str,
        calculation: Optional[Dict[str, Any]] = None,
        headers: Optional[Mapping[str, str]] = None,
        sandbox: bool = False,
        estimated_credits: Optional[int] = None,
    ) -> Dict[str, Any]:
        result = empty_meta(self.name)
        result["source"] = {
            "name": self.name,
            "endpoint": endpoint,
            "documentation": self.documentation,
            "retrieved_at": utc_now(),
            "data_kind": data_kind,
        }
        if self.name == "cosmyday":
            result["source"]["attribution"] = "Data: https://cosmyday.com (visible link required for publication)"
        result["calculation"] = calculation or {}
        result["sandbox"] = sandbox
        if headers:
            result["request_id"] = header(headers, "X-Request-Id")
            result["credits"] = {
                "estimated": estimated_credits,
                "used": numeric_header(headers, "X-Credits-Used"),
                "remaining": numeric_header(headers, "X-Credits-Remaining"),
                "limit": numeric_header(headers, "X-Credits-Limit"),
                "reset": header(headers, "X-Credits-Reset"),
                "cache": header(headers, "X-Cache"),
            }
            result["rate_limit"] = {
                "limit": numeric_header(headers, "X-RateLimit-Limit"),
                "remaining": numeric_header(headers, "X-RateLimit-Remaining"),
                "reset": header(headers, "X-RateLimit-Reset"),
                "scope": header(headers, "X-RateLimit-Scope"),
            }
        elif estimated_credits is not None:
            result["credits"] = {"estimated": estimated_credits}
        return result


def decode_json(raw: bytes, required: bool) -> Any:
    if not raw:
        if required:
            raise ToolError("PROVIDER_RESPONSE_ERROR", "供应商返回空响应。")
        return None
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        if required:
            raise ToolError("PROVIDER_RESPONSE_ERROR", "供应商未返回有效 UTF-8 JSON。", retryable=True)
        return None


def header(headers: Mapping[str, str], name: str) -> Optional[str]:
    target = name.lower()
    for key, value in headers.items():
        if key.lower() == target:
            return value
    return None


def numeric_header(headers: Mapping[str, str], name: str) -> Any:
    value = header(headers, name)
    if value is None:
        return None
    try:
        number = float(value)
        return int(number) if number.is_integer() else number
    except ValueError:
        return value


def calculation_parameters(payload: Dict[str, Any]) -> Dict[str, Any]:
    chart = payload
    for key in ("natal", "chart", "chart1"):
        if isinstance(payload.get(key), dict):
            chart = payload[key]
            break
    result: Dict[str, Any] = {}
    for source, target in (
        ("house_system", "house_system"),
        ("zodiac_type", "zodiac_type"),
        ("time_unknown", "time_unknown"),
        ("ayanamsa", "ayanamsa"),
    ):
        if source in chart:
            result[target] = chart[source]
    if "timezone_offset" in chart:
        result["timezone_mode"] = "explicit_offset"
    elif "timezone" in chart:
        result["timezone_mode"] = chart["timezone"]
    else:
        result["timezone_mode"] = "auto"
    return result
