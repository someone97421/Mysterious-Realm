"""固定版式解读的渐进解析与完整校验。"""

import json
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

LAYOUTS = {
    "natal": [("portrait", "星盘画像"), ("patterns", "内在模式"), ("growth", "成长方向")],
    "relationship": [("resonance", "彼此的呼应"), ("tension", "关系中的张力"), ("connection", "相处的可能")],
    "forecast": [("background", "这段时光的底色"), ("rhythm", "值得关注的节奏"), ("preparation", "为变化留出空间")],
    "decision": [("question", "问题与边界"), ("evidence", "星象依据"), ("choices", "选择与下一步")],
}


class Section(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(min_length=1, max_length=60)
    title: str = Field(min_length=1, max_length=160)
    body: str = Field(min_length=1, max_length=16000)
    highlights: list[str] = Field(default_factory=list, max_length=6)


class Source(BaseModel):
    name: str
    url: str


class Reading(BaseModel):
    model_config = ConfigDict(extra="ignore")
    layout: Literal["natal", "relationship", "forecast", "decision"]
    title: str = Field(min_length=1, max_length=160)
    subtitle: str = Field(default="", max_length=400)
    summary: str = Field(min_length=1, max_length=4000)
    sections: list[Section] = Field(min_length=3, max_length=3)
    actions: list[str] = Field(default_factory=list, max_length=8)
    closing: str = Field(default="", max_length=3000)
    sources: list[Source] = Field(default_factory=list)


def instructions(layout):
    skeleton = {"layout": layout, "title": "解读标题", "subtitle": "人物与咨询主题", "summary": "重点概括",
                "sections": [{"id": identity, "title": title, "body": "依据真实资料展开的Markdown段落", "highlights": ["简短要点"]} for identity, title in LAYOUTS[layout]],
                "actions": ["具体可探索的建议"], "closing": "自然收束", "sources": []}
    return ("现在生成结构化占星解读，只输出下述JSON对象，不要代码围栏或其他文字。"
            "sections必须严格按给定id和顺序输出三段，title可以结合问题调整；没有证据的部分明确写资料限制。"
            "字段正文可用Markdown，不重复标题；不输出原始推理、API或工具日志。sources由程序补充，输出空数组。"
            "趋势版式只能引用实际计算返回的日期，不能为了时间线而造日期；关系版式不编造匹配分数。"
            "每个body建议100到350中文字，避免输出长度截断。结构：\n" + json.dumps(skeleton, ensure_ascii=False))


_STRING = re.compile(r'"((?:[^"\\]|\\.)*)("|\\?$)', re.DOTALL)


def _decode_fragment(value):
    value = re.sub(r'\\u[0-9a-fA-F]{0,3}$', '', value)
    if len(value) - len(value.rstrip('\\')) & 1:
        value = value[:-1]
    try:
        return json.loads('"' + value + '"', strict=False).encode('utf-8', errors='ignore').decode('utf-8')
    except (ValueError, UnicodeError):
        return ""


def partial_object(text):
    position = text.find('{')
    if position < 0:
        return {}
    missing = object()
    decoder = json.JSONDecoder(strict=False)
    def skip_space():
        nonlocal position
        while position < len(text) and text[position].isspace():
            position += 1

    def parse(depth=0):
        nonlocal position
        skip_space()
        if position >= len(text) or depth > 24:
            return missing
        opening = text[position]
        if opening == '"':
            match = _STRING.match(text, position)
            if not match:
                return missing
            position = match.end()
            return _decode_fragment(match[1])
        if opening in '{[':
            mapping = opening == '{'
            result = {} if mapping else []
            position += 1
            while position < len(text):
                skip_space()
                if position >= len(text):
                    break
                if text[position] == ('}' if mapping else ']'):
                    position += 1
                    break
                if mapping:
                    match = _STRING.match(text, position)
                    if not match or match[2] != '"':
                        break
                    key = _decode_fragment(match[1])
                    position = match.end()
                    skip_space()
                    if position >= len(text) or text[position] != ':':
                        break
                    position += 1
                value = parse(depth + 1)
                if value is missing:
                    break
                if mapping:
                    result[key] = value
                else:
                    result.append(value)
                skip_space()
                if position >= len(text) or text[position] != ',':
                    if position < len(text) and text[position] == ('}' if mapping else ']'):
                        position += 1
                    break
                position += 1
            return result
        try:
            value, position = decoder.raw_decode(text, position)
            return value
        except ValueError:
            return missing
    result = parse()
    return result if isinstance(result, dict) else {}


def preview(text, layout):
    value = partial_object(text)
    result = {"layout": layout, "sections": [], "sources": []}
    for field in ("title", "subtitle", "summary", "closing"):
        result[field] = value.get(field) if isinstance(value.get(field), str) else ""
    sections = value.get("sections")
    if isinstance(sections, list):
        for index, item in enumerate(sections[:3]):
            identity, title = LAYOUTS[layout][index]
            if not isinstance(item, dict) or item.get("id") != identity:
                continue
            result["sections"].append({"id": identity, "title": item.get("title") if isinstance(item.get("title"), str) else title,
                                       "body": item.get("body") if isinstance(item.get("body"), str) else "",
                                       "highlights": [x for x in item.get("highlights", []) if isinstance(x, str)] if isinstance(item.get("highlights"), list) else []})
    result["actions"] = [x for x in value.get("actions", []) if isinstance(x, str)] if isinstance(value.get("actions"), list) else []
    return result


def validate(value, layout, sources):
    value = {**value, "sources": sources}
    if isinstance(value.get("actions"), list):
        value["actions"] = value["actions"][:8]
    if isinstance(value.get("sections"), list):
        value["sections"] = [{**section, "highlights": section["highlights"][:6]} if isinstance(section, dict) and isinstance(section.get("highlights"), list) else section for section in value["sections"]]
    result = Reading.model_validate(value)
    if result.layout != layout or [s.id for s in result.sections] != [identity for identity, _ in LAYOUTS[layout]]:
        raise ValueError("解读版式或段落顺序不匹配")
    return result.model_dump()


def markdown(value):
    if not value.get("summary") and not any(section.get("body") for section in value.get("sections", [])):
        return ""
    parts = ["# " + (value.get("title") or "星象解读")]
    for field in ("subtitle", "summary"):
        if value.get(field):
            parts.append(value[field])
    for section in value.get("sections", []):
        parts.extend(["## " + section.get("title", ""), section.get("body", "")])
        parts.extend("- " + text for text in section.get("highlights", []))
    if value.get("actions"):
        parts.append("## 可以尝试的下一步")
        parts.extend(f"{index + 1}. {text}" for index, text in enumerate(value["actions"]))
    if value.get("closing"):
        parts.append(value["closing"])
    parts.extend(f"资料来源：[{source['name']}]({source['url']})" for source in value.get("sources", []))
    return "\n\n".join(parts)
