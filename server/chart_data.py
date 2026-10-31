"""把实际计算结果映射为可交互星盘，不补造缺失数据。"""

import math
import re

NAMES = {
    "sun": "太阳", "moon": "月亮", "mercury": "水星", "venus": "金星",
    "mars": "火星", "jupiter": "木星", "saturn": "土星", "uranus": "天王星",
    "neptune": "海王星", "pluto": "冥王星", "true_node": "北交点",
    "mean_node": "平均北交点", "chiron": "凯龙星",
}
ANGLES = {"conjunction": 0, "sextile": 60, "square": 90, "trine": 120, "opposition": 180,
          "合相": 0, "六合": 60, "刑相": 90, "拱相": 120, "冲相": 180}
TITLES = {"natal-chart": "本命星盘", "synastry": "关系比较盘", "composite-chart": "关系组合盘",
          "transits": "行运星盘", "solar-return": "太阳返照盘", "secondary-progressions": "次限推运盘", "horary-chart": "问题时刻盘"}


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def point_id(value):
    if isinstance(value, dict):
        value = value.get("name", value.get("id", ""))
    return re.sub(r"[^a-z0-9_\u4e00-\u9fff-]", "_", str(value).lower().strip())


def planets(raw, prefix=""):
    output, aliases = [], {}
    for item in raw or []:
        if not isinstance(item, dict) or not finite(item.get("longitude")):
            continue
        longitude = item["longitude"]
        if not 0 <= longitude < 360:
            continue
        identity = point_id(item.get("name") or item.get("id", ""))
        if not identity or any(p["id"] == prefix + identity for p in output):
            continue
        planet = {"id": prefix + identity, "name": NAMES.get(identity, str(item.get("name") or identity)),
                  "longitude": longitude, "retrograde": bool(item.get("is_retrograde")), "sign": item.get("sign")}
        if isinstance(item.get("house"), int) and 1 <= item["house"] <= 12:
            planet["house"] = item["house"]
        output.append(planet)
        for alias in (item.get("id"), item.get("name"), identity):
            if alias is not None:
                aliases[point_id(alias)] = planet["id"]
    return output, aliases


def houses(raw):
    cusps = raw.get("cusps") if isinstance(raw, dict) else None
    if isinstance(cusps, dict):
        entries = [(str(number), value) for number, value in cusps.items()]
    elif isinstance(cusps, list):
        entries = [(str(i + 1), value) for i, value in enumerate(cusps)]
    else:
        return []
    result = []
    for number, value in entries:
        if isinstance(value, dict):
            number = str(value.get("house", value.get("number", number)))
            value = value.get("longitude")
        if number.isdigit() and 1 <= int(number) <= 12 and finite(value) and 0 <= value < 360:
            result.append({"number": int(number), "longitude": value})
    return result


def aspects(raw, first, second=None):
    second = first if second is None else second
    result = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        source, target = first.get(point_id(item.get("point1"))), second.get(point_id(item.get("point2")))
        angle = item.get("angle")
        if not finite(angle):
            angle = ANGLES.get(str(item.get("aspect", "")).lower())
        if source and target and source != target and finite(angle) and 0 <= angle <= 180:
            result.append({"from": source, "to": target, "angle": angle,
                           **({"orb": item["orb"]} if finite(item.get("orb")) else {})})
    return result


def make_chart(tool, envelope, run_id, profile_ids, profiles, created_at):
    if tool not in TITLES or envelope.get("status") != "ok":
        return None
    data, meta = envelope.get("data") or {}, envelope.get("meta") or {}
    if meta.get("sandbox") or meta.get("is_mock"):
        return None
    if not isinstance(data, dict):
        return None
    raw = data.get("chart1", {}) if tool == "synastry" else data.get("chart", data)
    if not isinstance(raw, dict):
        return None
    inner, aliases = planets(raw.get("planets"))
    if not inner:
        return None
    outer, outer_aliases = planets((data.get("chart2") or {}).get("planets"), "outer:") if tool == "synastry" else ([], {})
    lines = aspects(data.get("cross_aspects"), aliases, outer_aliases) if tool == "synastry" else aspects(raw.get("aspects"), aliases)
    uncertain = any(p.get("time_accuracy") != "exact" or not p.get("birth_time") for p in profiles if p["id"] in profile_ids)
    warnings = []
    if uncertain:
        lines = []
        warnings.append("出生时间不确定，盘面不展示宫位、相位与月亮的精确位置。")
        inner = [p for p in inner if p["id"] != "moon"]
        outer = [p for p in outer if p["id"] != "outer:moon"]
        for planet in inner + outer:
            planet.pop("house", None)
    visible = {p["id"] for p in inner + outer}
    lines = [a for a in lines if a["from"] in visible and a["to"] in visible]
    if (meta.get("cache") or {}).get("stale"):
        warnings.append("当前使用此前保存的星象数据。")
    if meta.get("degraded"):
        warnings.append("本次部分数据使用了备用来源。")
    by_id = {p["id"]: p for p in profiles}
    names = [by_id[identity]["name"] for identity in profile_ids if identity in by_id]
    source = meta.get("provider")
    return {"id": run_id, "kind": tool, "title": " · ".join([*names, TITLES[tool]]),
            "profile_ids": profile_ids, "created_at": created_at, "planets": inner,
            "inner_label": names[0] if names else "", "outer_label": names[1] if len(names) > 1 and outer else "",
            "outer_planets": outer, "houses": [] if uncertain else houses(raw.get("houses")), "aspects": lines,
            "source": {"name": "CosmyDay" if source == "cosmyday" else "AstroWay",
                       "url": "https://cosmyday.com" if source == "cosmyday" else "https://api.astroway.info"},
            "warnings": warnings}
