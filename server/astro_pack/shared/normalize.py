"""供应商字段到稳定 snake_case 数据结构的映射。"""

import re
from typing import Any, Dict, List, Optional


SIGNS = [
    "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
    "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces",
]

def snake_key(key: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", key).lower()


def plain(value: Any) -> Any:
    if isinstance(value, dict):
        return {snake_key(str(key)): plain(item) for key, item in value.items()}
    if isinstance(value, list):
        return [plain(item) for item in value]
    return value


def sign_position(longitude: Any) -> Dict[str, Any]:
    if not isinstance(longitude, (int, float)) or isinstance(longitude, bool):
        return {"sign": None, "degree_in_sign": None}
    normalized = longitude % 360.0
    return {"sign": SIGNS[int(normalized // 30)], "degree_in_sign": normalized % 30}


def astroway_planet(raw: Dict[str, Any]) -> Dict[str, Any]:
    longitude = raw.get("longitude")
    return {
        "id": raw.get("id"),
        "name": raw.get("name"),
        "longitude": longitude,
        "latitude": raw.get("latitude"),
        "distance": raw.get("distance"),
        "speed_longitude": raw.get("speedLong"),
        "speed_latitude": raw.get("speedLat"),
        "speed_distance": raw.get("speedDist"),
        "is_retrograde": raw.get("isRetrograde"),
        "declination": raw.get("declination"),
        "right_ascension": raw.get("rightAscension"),
        "house": raw.get("house"),
        **sign_position(longitude),
    }


def cosmyday_planet(name: str, raw: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": None,
        "name": name,
        "longitude": raw.get("lon"),
        "latitude": raw.get("lat"),
        "distance": raw.get("dist"),
        "speed_longitude": raw.get("speed_lon"),
        "speed_latitude": None,
        "speed_distance": None,
        "is_retrograde": raw.get("retrograde"),
        "declination": None,
        "right_ascension": None,
        "house": raw.get("house"),
        "dignity": raw.get("dignity"),
        "sign": raw.get("sign"),
        "degree_in_sign": raw.get("degInSign"),
    }


def aspect(raw: Dict[str, Any]) -> Dict[str, Any]:
    aspect_type = raw.get("type")
    if isinstance(aspect_type, dict):
        name = aspect_type.get("name")
        angle = aspect_type.get("angle")
        is_major = aspect_type.get("isMajor")
    else:
        name = aspect_type
        angle = raw.get("angle")
        is_major = None
    orb = raw.get("orb")
    if orb is None:
        orb = raw.get("delta")
    return {
        "point1": raw.get("planet1", raw.get("a")),
        "point2": raw.get("planet2", raw.get("b")),
        "aspect": name,
        "angle": angle,
        "exact_angle": raw.get("exactAngle", raw.get("angle")),
        "orb": orb,
        "is_applying": raw.get("isApplying", raw.get("applying")),
        "is_major": is_major,
    }


def aspects(raw: Any) -> List[Dict[str, Any]]:
    return [aspect(item) for item in raw or [] if isinstance(item, dict)]


def astroway_houses(raw: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if raw is None:
        return None
    return {
        "system": raw.get("system"),
        "cusps": raw.get("cusps"),
        "ascendant": raw.get("ascendant"),
        "mc": raw.get("mc"),
        "armc": raw.get("armc"),
        "vertex": raw.get("vertex"),
    }


def astroway_chart(raw: Dict[str, Any], chart_type: str) -> Dict[str, Any]:
    result = {
        "chart_type": chart_type,
        "julian_day": raw.get("julianDay"),
        "sidereal_time": raw.get("siderealTime"),
        "planets": [astroway_planet(item) for item in raw.get("planets") or []],
        "houses": astroway_houses(raw.get("houses")),
        "aspects": aspects(raw.get("aspects")),
        "parallel_aspects": plain(raw.get("parallelAspects")),
        "antiscia": plain(raw.get("antiscia")),
        "sect": raw.get("chartSect"),
        "engine": plain(raw.get("meta")),
    }
    for source, target in (
        ("returnMoment", "return_moment"),
        ("timeUnknown", "time_unknown"),
        ("localized", "localized"),
    ):
        if source in raw:
            result[target] = plain(raw.get(source))
    return result


def cosmyday_chart(raw: Dict[str, Any]) -> Dict[str, Any]:
    planets = raw.get("planets") or {}
    return {
        "chart_type": "natal",
        "julian_day": None,
        "sidereal_time": None,
        "planets": [cosmyday_planet(name, item) for name, item in planets.items()],
        "houses": {
            "system": raw.get("houseSystem"),
            "cusps": raw.get("cusps"),
            "ascendant": raw.get("ascendant"),
            "mc": raw.get("midheaven"),
            "armc": None,
            "vertex": None,
        },
        "aspects": aspects(raw.get("aspects")),
        "parallel_aspects": None,
        "antiscia": None,
        "sect": None,
        "part_of_fortune": plain(raw.get("partOfFortune")),
        "engine": None,
    }


def synastry(raw: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "chart_type": "synastry",
        "chart1": astroway_chart(raw.get("chart1") or {}, "natal"),
        "chart2": astroway_chart(raw.get("chart2") or {}, "natal"),
        "cross_aspects": aspects(raw.get("crossAspects")),
        "compatibility": plain(raw.get("compatibility")),
    }


def horary(raw: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "chart_type": "horary",
        "chart": astroway_chart(raw.get("chart") or {}, "horary"),
        "indicators": plain(raw.get("indicators")),
    }


def object_data(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, dict):
        return plain(raw)
    if isinstance(raw, list):
        return {"items": plain(raw)}
    return {"value": raw}
