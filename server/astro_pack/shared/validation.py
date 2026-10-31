"""与公开输入 Schema 对应的轻量标准库校验。"""

import re
from datetime import datetime
from typing import Any, Dict, List, Tuple

from .errors import ToolError
from .protocol import issue, tool_catalog


HOUSE_SYSTEMS = set("PKRCEWBMOTVD FGHIiLNQSUXY".replace(" ", ""))
SIGNS = {
    "aries", "taurus", "gemini", "cancer", "leo", "virgo",
    "libra", "scorpio", "sagittarius", "capricorn", "aquarius", "pisces",
}
CHART_KEYS = {
    "date", "time", "time_unknown", "latitude", "longitude", "timezone",
    "timezone_offset", "house_system", "zodiac_type", "ayanamsa", "name", "city",
}


def fail(message: str, details: Any = None) -> None:
    raise ToolError("INVALID_INPUT", message, details=details)


def mapping(value: Any, label: str) -> Dict[str, Any]:
    if not isinstance(value, dict):
        fail("%s 必须是 JSON 对象。" % label)
    return dict(value)


def unknown_keys(value: Dict[str, Any], allowed: set, label: str) -> None:
    unknown = sorted(set(value) - allowed)
    if unknown:
        fail("%s 包含未定义字段。" % label, {"fields": unknown})


def required(value: Dict[str, Any], names: Tuple[str, ...], label: str) -> None:
    missing = [name for name in names if name not in value or value[name] is None]
    if missing:
        fail("%s 缺少必需字段。" % label, {"fields": missing})


def number(value: Any, label: str, minimum: float, maximum: float) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        fail("%s 必须是数字。" % label)
    if value < minimum or value > maximum:
        fail("%s 必须在 %s 到 %s 之间。" % (label, minimum, maximum))
    return value


def integer(value: Any, label: str, minimum: int, maximum: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        fail("%s 必须是整数。" % label)
    if value < minimum or value > maximum:
        fail("%s 必须在 %d 到 %d 之间。" % (label, minimum, maximum))
    return value


def boolean(value: Any, label: str) -> bool:
    if not isinstance(value, bool):
        fail("%s 必须是布尔值。" % label)
    return value


def text(value: Any, label: str, minimum: int = 1) -> str:
    if not isinstance(value, str) or len(value.strip()) < minimum:
        fail("%s 必须是至少 %d 个字符的字符串。" % (label, minimum))
    return value.strip()


def date(value: Any, label: str) -> str:
    value = text(value, label)
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        fail("%s 必须是有效的 YYYY-MM-DD 日期。" % label)
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        fail("%s 必须是有效的 YYYY-MM-DD 日期。" % label)
    return value


def time_value(value: Any, label: str) -> str:
    value = text(value, label)
    if not re.fullmatch(r"\d{2}:\d{2}(:\d{2})?", value):
        fail("%s 必须是 HH:MM 或 HH:MM:SS。" % label)
    normalized = value if len(value) == 8 else value + ":00"
    try:
        datetime.strptime(normalized, "%H:%M:%S")
    except ValueError:
        fail("%s 不是有效时刻。" % label)
    return value


def chart(value: Any, label: str = "chart", require_time: bool = False) -> Tuple[Dict[str, Any], List[Dict[str, Any]], List[Dict[str, Any]]]:
    result = mapping(value, label)
    unknown_keys(result, CHART_KEYS, label)
    required(result, ("date", "latitude", "longitude"), label)
    result["date"] = date(result["date"], label + ".date")
    result["latitude"] = number(result["latitude"], label + ".latitude", -90, 90)
    result["longitude"] = number(result["longitude"], label + ".longitude", -180, 180)
    unknown = result.get("time_unknown", False)
    result["time_unknown"] = boolean(unknown, label + ".time_unknown")
    if "time" in result:
        result["time"] = time_value(result["time"], label + ".time")
    if result["time_unknown"] and "time" in result:
        fail("%s 在时间未知时不能同时提供 time。" % label)
    if not result["time_unknown"] and "time" not in result:
        fail("%s 需要提供 time，或明确设置 time_unknown=true。" % label)
    if require_time and (result["time_unknown"] or "time" not in result):
        fail("%s 需要明确时间，不支持 time_unknown。" % label)
    result.setdefault("house_system", "P")
    if result["house_system"] not in HOUSE_SYSTEMS:
        fail("%s.house_system 不是受支持的 Swiss Ephemeris 宫位制代码。" % label)
    result.setdefault("zodiac_type", "tropical")
    if result["zodiac_type"] not in {"tropical", "sidereal"}:
        fail("%s.zodiac_type 仅支持 tropical 或 sidereal。" % label)
    if "timezone" in result:
        result["timezone"] = text(result["timezone"], label + ".timezone")
    if "timezone_offset" in result:
        result["timezone_offset"] = number(result["timezone_offset"], label + ".timezone_offset", -14, 14)
    if "ayanamsa" in result and result["ayanamsa"] is not None:
        result["ayanamsa"] = text(result["ayanamsa"], label + ".ayanamsa")
        if result["zodiac_type"] != "sidereal":
            fail("%s.ayanamsa 只能与 sidereal 黄道一起使用。" % label)
        if result["ayanamsa"] not in {"fagan-bradley", "lahiri", "de-luce", "raman", "krishnamurti", "kp", "yukteshwar", "jn-bhasin", "true-citra", "djwhal-khul"}:
            fail("%s.ayanamsa 不受支持。" % label)
    for key in ("name", "city"):
        if key in result:
            result[key] = text(result[key], label + "." + key)
    warnings: List[Dict[str, Any]] = []
    uncertainty: List[Dict[str, Any]] = []
    if result["time_unknown"]:
        uncertainty.append(issue(
            "BIRTH_TIME_UNKNOWN",
            "出生时间未知；宫位、角度、昼夜信息及依赖时刻的判断不可用或受限。",
            ["time", "houses", "angles", "sect"],
        ))
    if "timezone" in result and "timezone_offset" in result:
        warnings.append(issue(
            "TIMEZONE_OFFSET_IGNORED",
            "同时提供 timezone 与 timezone_offset 时，供应商以 timezone 为准。",
            ["timezone_offset"],
        ))
    if int(result["date"][:4]) < 1970 and "timezone_offset" not in result:
        uncertainty.append(issue(
            "HISTORICAL_TIMEZONE",
            "1970 年前的历史时区并非所有地点都可靠；已知当地 UTC 偏移时宜明确提供。",
            ["timezone"],
        ))
    return result, warnings, uncertainty


def pair(value: Any, require_time: bool) -> Tuple[Dict[str, Any], List[Dict[str, Any]], List[Dict[str, Any]]]:
    result = mapping(value, "input")
    unknown_keys(result, {"chart1", "chart2"}, "input")
    required(result, ("chart1", "chart2"), "input")
    warnings: List[Dict[str, Any]] = []
    uncertainty: List[Dict[str, Any]] = []
    for key in ("chart1", "chart2"):
        result[key], current_warnings, current_uncertainty = chart(result[key], key, require_time)
        warnings.extend(current_warnings)
        uncertainty.extend(current_uncertainty)
    return result, warnings, uncertainty


def moment(value: Any, label: str) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    result = mapping(value, label)
    unknown_keys(result, {"date", "time", "timezone_offset"}, label)
    required(result, ("date",), label)
    result["date"] = date(result["date"], label + ".date")
    defaulted = False
    if "time" not in result:
        result["time"] = "12:00:00"
        defaulted = True
    else:
        result["time"] = time_value(result["time"], label + ".time")
    if "timezone_offset" not in result:
        result["timezone_offset"] = 0
        defaulted = True
    else:
        result["timezone_offset"] = number(result["timezone_offset"], label + ".timezone_offset", -14, 14)
    warnings = [issue("MOMENT_DEFAULTS_APPLIED", "未完整提供目标时刻时，默认使用 12:00:00 与 UTC+0。")] if defaulted else []
    return result, warnings


def nested_natal(result: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    required(result, ("natal",), "input")
    normalized, warnings, uncertainty = chart(result["natal"], "natal", True)
    result["natal"] = normalized
    return warnings, uncertainty


def render_options(value: Any) -> Dict[str, Any]:
    result = mapping(value, "options")
    allowed = {"size", "theme", "show_aspects", "show_retrograde", "title", "bodies", "outer_label", "cross_aspects"}
    unknown_keys(result, allowed, "options")
    if "size" in result:
        integer(result["size"], "options.size", 200, 2000)
    if "theme" in result and result["theme"] not in {"light", "dark", "console", "css"}:
        fail("options.theme 不受支持。")
    for key in ("show_aspects", "show_retrograde", "cross_aspects"):
        if key in result:
            boolean(result[key], "options." + key)
    for key, maximum in (("title", 120), ("outer_label", 40)):
        if key in result:
            result[key] = text(result[key], "options." + key)
            if len(result[key]) > maximum:
                fail("options.%s 不能超过 %d 个字符。" % (key, maximum))
    if "bodies" in result:
        if not isinstance(result["bodies"], list) or not 1 <= len(result["bodies"]) <= 14:
            fail("options.bodies 必须包含 1 到 14 个天体名称。")
        result["bodies"] = [text(item, "options.bodies") for item in result["bodies"]]
    return result


def validate_input(tool: str, payload: Any) -> Tuple[Dict[str, Any], List[Dict[str, Any]], List[Dict[str, Any]]]:
    if tool not in tool_catalog():
        raise ToolError("UNKNOWN_TOOL", "未知工具：%s" % tool)
    result = mapping(payload, "input")
    warnings: List[Dict[str, Any]] = []
    uncertainty: List[Dict[str, Any]] = []

    if tool == "geocode":
        unknown_keys(result, {"query"}, "input")
        required(result, ("query",), "input")
        result["query"] = text(result["query"], "query", 2)
    elif tool == "natal-chart":
        result, warnings, uncertainty = chart(result, "input", False)
    elif tool == "synastry":
        result, warnings, uncertainty = pair(result, False)
    elif tool == "composite-chart":
        result, warnings, uncertainty = pair(result, True)
    elif tool in {"electional-day", "horary-chart", "horary-diagnostics"}:
        result, warnings, uncertainty = chart(result, "input", True)
    elif tool == "transits":
        unknown_keys(result, {"natal", "transit"}, "input")
        required(result, ("natal", "transit"), "input")
        warnings, uncertainty = nested_natal(result)
        result["transit"], current = moment(result["transit"], "transit")
        warnings.extend(current)
    elif tool == "secondary-progressions":
        unknown_keys(result, {"natal", "target", "converse"}, "input")
        required(result, ("natal", "target"), "input")
        warnings, uncertainty = nested_natal(result)
        result["target"], current = moment(result["target"], "target")
        warnings.extend(current)
        result["converse"] = boolean(result.get("converse", False), "converse")
    elif tool == "transit-calendar":
        allowed = {"natal", "start_date", "end_date", "max_orb", "aspect_angles", "transit_planet_ids"}
        unknown_keys(result, allowed, "input")
        required(result, ("natal", "start_date", "end_date"), "input")
        warnings, uncertainty = nested_natal(result)
        result["start_date"] = date(result["start_date"], "start_date")
        result["end_date"] = date(result["end_date"], "end_date")
        if result["start_date"] > result["end_date"]:
            fail("start_date 不能晚于 end_date。")
        if "max_orb" in result:
            number(result["max_orb"], "max_orb", 0.000001, 10)
        if "aspect_angles" in result:
            if not isinstance(result["aspect_angles"], list) or len(result["aspect_angles"]) > 64:
                fail("aspect_angles 必须是最多 64 项的数组。")
            for item in result["aspect_angles"]:
                if not isinstance(item, (int, float)) or isinstance(item, bool) or item not in {0, 60, 90, 120, 180}:
                    fail("aspect_angles 仅支持数字 0、60、90、120、180。")
            if len(set(result["aspect_angles"])) != len(result["aspect_angles"]):
                fail("aspect_angles 不能包含重复项。")
        if "transit_planet_ids" in result:
            if not isinstance(result["transit_planet_ids"], list) or len(result["transit_planet_ids"]) > 32:
                fail("transit_planet_ids 必须是最多 32 项的数组。")
            for item in result["transit_planet_ids"]:
                if not isinstance(item, int) or isinstance(item, bool) or item < 0:
                    fail("transit_planet_ids 必须是非负整数。")
            if len(set(result["transit_planet_ids"])) != len(result["transit_planet_ids"]):
                fail("transit_planet_ids 不能包含重复项。")
    elif tool == "solar-return":
        unknown_keys(result, {"natal", "year", "location"}, "input")
        required(result, ("natal", "year"), "input")
        warnings, uncertainty = nested_natal(result)
        integer(result["year"], "year", 1, 9999)
        if "location" in result:
            location = mapping(result["location"], "location")
            unknown_keys(location, {"latitude", "longitude"}, "location")
            required(location, ("latitude", "longitude"), "location")
            location["latitude"] = number(location["latitude"], "location.latitude", -90, 90)
            location["longitude"] = number(location["longitude"], "location.longitude", -180, 180)
            result["location"] = location
    elif tool == "sky-events":
        unknown_keys(result, {"days", "limit", "min_importance", "kind", "from_date"}, "input")
        result["days"] = integer(result.get("days", 30), "days", 1, 400)
        result["limit"] = integer(result.get("limit", 50), "limit", 1, 200)
        result["min_importance"] = integer(result.get("min_importance", 0), "min_importance", 0, 100)
        if result.get("kind") is not None:
            result["kind"] = text(result["kind"], "kind")
        if "from_date" in result:
            result["from_date"] = date(result["from_date"], "from_date")
    elif tool in {"sky-event-kinds", "provider-usage"}:
        unknown_keys(result, set(), "input")
    elif tool == "horoscope":
        unknown_keys(result, {"period", "sign", "month"}, "input")
        required(result, ("period",), "input")
        if result["period"] not in {"daily", "weekly", "monthly"}:
            fail("period 仅支持 daily、weekly、monthly。")
        if "sign" in result:
            result["sign"] = text(result["sign"], "sign").lower()
            if result["sign"] not in SIGNS:
                fail("sign 不是有效的英文星座名。")
        if "month" in result:
            if result["period"] != "monthly" or "sign" not in result:
                fail("month 仅可与 monthly 及 sign 一起使用。")
            result["month"] = text(result["month"], "month")
            if not re.fullmatch(r"\d{4}-\d{2}", result["month"]):
                fail("month 必须是有效的 YYYY-MM。")
            try:
                datetime.strptime(result["month"], "%Y-%m")
            except ValueError:
                fail("month 必须是有效的 YYYY-MM。")
    elif tool == "astro-content":
        unknown_keys(result, {"topic"}, "input")
        required(result, ("topic",), "input")
        if result["topic"] not in {"moon", "transit", "week-ahead", "monthly-overview"}:
            fail("topic 不受支持。")
    elif tool == "render-chart":
        allowed = {"kind", "chart", "natal", "outer", "chart1", "chart2", "options"}
        unknown_keys(result, allowed, "input")
        required(result, ("kind",), "input")
        kind = result["kind"]
        if kind not in {"western", "bi-wheel", "composite"}:
            fail("kind 仅支持 western、bi-wheel、composite。")
        fields = {"western": ("chart",), "bi-wheel": ("natal", "outer"), "composite": ("chart1", "chart2")}[kind]
        irrelevant = sorted(({"chart", "natal", "outer", "chart1", "chart2"} - set(fields)) & set(result))
        if irrelevant:
            fail("当前 render kind 包含无关盘字段。", {"fields": irrelevant})
        required(result, fields, "input")
        for key in fields:
            result[key], current_warnings, current_uncertainty = chart(result[key], key, True)
            warnings.extend(current_warnings)
            uncertainty.extend(current_uncertainty)
        if "options" in result:
            result["options"] = render_options(result["options"])
    return result, warnings, uncertainty
