"""占星计算入口、人物绑定与持久化；密钥始终留在服务端。"""

import asyncio
import copy
import hashlib
import json
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from . import db, maintenance
from .config import DATA_DIR
from .settings import runtime_settings
from .chart_data import finite, make_chart
from .astro_pack.providers.router import ToolService
from .astro_pack.shared.config import Config
from .astro_pack.shared.errors import ToolError
from .astro_pack.shared.protocol import tool_catalog
from .astro_pack.shared.validation import validate_input

PERSONAL_TOOLS = {"natal-chart", "synastry", "composite-chart", "transits", "transit-calendar", "solar-return", "secondary-progressions"}
EXACT_TOOLS = PERSONAL_TOOLS - {"natal-chart", "synastry"}


def public_error(code):
    if code in {"PROFILE_REQUIRED", "MISSING_BIRTH_DATE", "MISSING_LOCATION", "EXACT_TIME_REQUIRED", "VALIDATION_ERROR", "INVALID_INPUT"}:
        return "这一步还需要更完整或更准确的资料，先一起确认一下。"
    if code == "AUTHENTICATION_FAILED":
        return "占星服务的鉴权未通过，请管理员检查对应服务卡密钥。"
    if code == "MISSING_API_KEY":
        return "这张 AstroWay 服务卡尚未配置密钥，已尝试其他可用服务。"
    if code in {"CREDIT_SPEND_NOT_ALLOWED", "UNKNOWN_COST_NOT_ALLOWED", "COST_LIMIT_EXCEEDED", "PAYMENT_REQUIRED", "CREDITS_EXHAUSTED", "SPEND_CAP_REACHED", "KEY_BUDGET_EXHAUSTED"}:
        return "占星服务的额度或费用策略不允许执行这项计算，已尝试其他可用服务。"
    if code in {"TOOL_DISABLED", "UNSUPPORTED_CAPABILITY"}:
        return "当前没有已启用的占星服务能处理这项参数组合。"
    if code in {"NETWORK_ERROR", "PROVIDER_UNAVAILABLE", "RATE_LIMIT", "TIMEOUT", "OFFLINE", "CACHE_MISS_OFFLINE"}:
        return "占星服务当前连接不稳定，已尝试其他可用服务。"
    if code == "SANDBOX_DATA":
        return "当前取得的是演示数据，暂不用于你的真实星盘解读。"
    if code in {"PROVIDER_RESPONSE_ERROR", "PROVIDER_ERROR", "PROVIDER_REQUEST_REJECTED"}:
        return "占星服务返回的数据暂不可用，已尝试其他可用服务。"
    return "这部分星象暂时未能取得，已完成的内容会为你保留。"


def make_config(user_id, settings):
    # 密钥切换、供应商切换和用户之间不复用缓存。
    service_scope = ":".join("%s:%s" % (item.get("id", ""), item.get("api_key", "")) for item in settings.get("services", []))
    namespace = hashlib.sha256(service_scope.encode()).hexdigest()[:20]
    return Config(provider="auto", api_key="", allow_credit_spend=settings["allow_credit_spend"],
                  allow_unknown_cost=settings["allow_unknown_cost"], max_credits=settings["max_credits"],
                  timeout=settings["timeout"], cache_enabled=settings["cache_enabled"],
                  cache_dir=DATA_DIR / "astro-cache" / user_id / namespace)


def profile_chart(profile, exact=False):
    if not profile.get("birth_date"):
        raise ToolError("MISSING_BIRTH_DATE", "请补充这个人物的出生日期。")
    if profile.get("latitude") is None or profile.get("longitude") is None:
        raise ToolError("MISSING_LOCATION", "请在人物卡中搜索并确认出生地点。")
    known = profile.get("time_accuracy") == "exact" and bool(profile.get("birth_time"))
    if exact and not known:
        raise ToolError("EXACT_TIME_REQUIRED", "此项分析需要准确的出生时间，不能使用大约时间或未知时间。")
    result = {"name": profile["name"], "date": profile["birth_date"], "latitude": profile["latitude"],
              "longitude": profile["longitude"]}
    if profile.get("location_name"):
        result["city"] = profile["location_name"]
    if known:
        result["time"] = profile["birth_time"]
    else:
        result["time_unknown"] = True
    if profile.get("timezone"):
        result["timezone"] = profile["timezone"]
    return result


def bind_payload(tool, payload, profiles):
    if not isinstance(payload, dict):
        raise ToolError("INVALID_INPUT", "计算资料需要是一个对象。")
    by_id = {p["id"]: p for p in profiles}
    used = []

    def chart_ref(value):
        if not isinstance(value, dict) or set(value) != {"profile_id"} or value.get("profile_id") not in by_id:
            raise ToolError("PROFILE_REQUIRED", "请引用本次对话中已确认的人物卡，不要重新填写或推测出生信息。")
        identity = value["profile_id"]
        if identity not in used:
            used.append(identity)
        return profile_chart(by_id[identity], tool in EXACT_TOOLS)

    bound = copy.deepcopy(payload)
    if tool == "natal-chart":
        bound = chart_ref(payload)
    elif tool in {"synastry", "composite-chart"}:
        bound["chart1"] = chart_ref(payload.get("chart1"))
        bound["chart2"] = chart_ref(payload.get("chart2"))
        if len(used) != 2:
            raise ToolError("PROFILE_REQUIRED", "比较关系时需要两张不同的人物卡。")
    elif tool in PERSONAL_TOOLS:
        bound["natal"] = chart_ref(payload.get("natal"))
    return bound, used


def safe_result(envelope, profiles, used):
    meta = envelope.get("meta") or {}
    source = meta.get("source") or {}
    result = {"status": envelope["status"], "tool": envelope.get("tool"), "data": copy.deepcopy(envelope.get("data")),
              "source": {"name": meta.get("provider"), "url": "https://cosmyday.com" if meta.get("provider") == "cosmyday" else "https://api.astroway.info",
                         "kind": source.get("data_kind"), "retrieved_at": source.get("retrieved_at")},
              "cache": {key: bool((meta.get("cache") or {}).get(key)) for key in ("hit", "stale")},
              "profile_versions": {p["id"]: p["version"] for p in profiles if p["id"] in used},
              "limitations": []}
    if meta.get("sandbox") or meta.get("is_mock"):
        result.update(status="error", data=None, error={"code": "SANDBOX_DATA", "message": public_error("SANDBOX_DATA"),
                      "retryable": False, "attempts": len(meta.get("attempts") or []), "exhausted": True})
    if result["cache"]["stale"]:
        result["limitations"].append("实时获取失败，当前资料来自过期缓存；不能当作最新观测。")
    if meta.get("degraded"):
        result["limitations"].append("本次计算有降级或备用来源。")
    for item in [*envelope.get("warnings", []), *envelope.get("uncertainty", [])]:
        if item.get("code") in {"HISTORICAL_TIMEZONE", "MOMENT_DEFAULTS_APPLIED", "TIMEZONE_OFFSET_IGNORED"}:
            result["limitations"].append(item["message"])
    if any(p.get("time_accuracy") != "exact" or not p.get("birth_time") for p in profiles if p["id"] in used):
        result["limitations"].append("出生时间不确定：不解读宫位、上升、精确月亮或精确事件时间；剩余位置仅供日期层面参考。")

        def redact(value):
            if isinstance(value, dict):
                for key in ("houses", "ascendant", "mc", "sidereal_time", "julian_day", "part_of_fortune", "sect"):
                    value.pop(key, None)
                if isinstance(value.get("planets"), list):
                    value["planets"] = [p for p in value["planets"] if str(p.get("name", "")).lower() not in {"moon", "月亮"} and p.get("id") != 1]
                    for planet in value["planets"]:
                        planet.pop("house", None)
                # 不确定出生时刻的相位需要区间验证，当前供应商没有提供。
                for key in ("aspects", "cross_aspects", "parallel_aspects", "antiscia", "compatibility"):
                    value.pop(key, None)
                for child in value.values():
                    redact(child)
            elif isinstance(value, list):
                for child in value:
                    redact(child)
        redact(result["data"])
    return result


def execute_sync(tool, payload, user, conversation_id=None, profiles=None, stop=None):
    profiles = profiles or []
    settings = runtime_settings()
    run_id, created = db.uid(), db.now()
    provider, service_name, credits, cache_hit, chart = "", None, None, False, None
    used, resolved, envelope = [], payload, None
    attempt_records = []
    try:
        if tool not in settings["enabled_tools"] or tool in {"provider-usage", "render-chart"}:
            raise ToolError("TOOL_DISABLED", "当前功能未开放。")
        resolved, used = bind_payload(tool, payload, profiles)
        normalized, warnings, uncertainty = validate_input(tool, resolved)
        config = make_config(user["id"], settings)
        envelope = ToolService(config, settings.get("services", [])).execute(tool, normalized, warnings, uncertainty, stop=stop)
        meta = envelope.get("meta") or {}
        provider = meta.get("provider") or next((item.get("provider", "") for item in meta.get("attempts", [])[::-1] if item.get("code") is None), "")
        service_name = meta.get("service_name")
        cache_meta = meta.get("cache") or {}
        cache_hit = bool(cache_meta.get("hit"))
        raw_credits = (meta.get("credits") or {}).get("used")
        credits = 0 if cache_hit or provider == "cosmyday" else raw_credits if finite(raw_credits) and raw_credits >= 0 else None
        current_attempts = meta.get("attempts") or []
        if cache_hit and cache_meta.get("stale") and current_attempts:
            attempt_records = [*current_attempts, {"service_name": service_name, "provider": provider,
                             "code": None, "retryable": False, "credits": 0, "cache_hit": True}]
        else:
            attempt_records = current_attempts or [{"service_name": service_name, "provider": provider,
                             "code": None, "credits": credits}]
        result = safe_result(envelope, profiles, used)
        result["attempts"] = attempt_records
        chart = make_chart(tool, envelope, run_id, used, profiles, created)
        if tool in {"natal-chart", "synastry", "composite-chart", "transits", "solar-return", "secondary-progressions", "horary-chart"} and result["status"] == "ok" and not chart:
            raise ToolError("PROVIDER_RESPONSE_ERROR", "计算响应缺少可用的星位资料。")
    except ToolError as exc:
        chart = None
        details = exc.details if isinstance(exc.details, dict) else {}
        attempt_records = details.get("attempts") or attempt_records
        exhausted = bool(details.get("exhausted", False))
        detail = exc.message if exc.code in {"PROFILE_REQUIRED", "MISSING_BIRTH_DATE", "MISSING_LOCATION", "EXACT_TIME_REQUIRED", "VALIDATION_ERROR", "INVALID_INPUT"} else public_error(exc.code)
        result = {"status": "error", "tool": tool, "data": None,
                  "error": {"code": exc.code, "message": detail, "retryable": bool(exc.retryable),
                            "attempts": len(attempt_records), "exhausted": exhausted}}
    except Exception as exc:
        chart = None
        diagnostic = "内部执行错误（%s）" % type(exc).__name__
        result = {"status": "error", "tool": tool, "data": None,
                  "error": {"code": "INTERNAL_ERROR", "message": "星象计算遇到内部错误，已停止重试。",
                            "retryable": False, "attempts": len(attempt_records), "exhausted": True,
                            "diagnostic": diagnostic}}
    try:
        input_hash = hashlib.sha256(json.dumps([tool, resolved], ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    except Exception:
        input_hash = hashlib.sha256(str(tool).encode()).hexdigest()
    error_code = (result.get("error") or {}).get("code")
    result.update(run_id=run_id, profile_ids=used, created_at=created)
    if chart and result["status"] == "ok":
        result["chart_id"] = chart["id"]
    with db.connect() as connection:
        if not connection.execute("SELECT 1 FROM users WHERE id=?", (user["id"],)).fetchone():
            return result, None
        if conversation_id and not connection.execute("SELECT 1 FROM conversations WHERE id=? AND user_id=?", (conversation_id, user["id"])).fetchone():
            return result, None
        records = attempt_records or [{"service_name": service_name, "provider": provider, "credits": credits, "code": error_code}]
        for index, attempt in enumerate(records, 1):
            final = index == len(records)
            row_id = run_id if final else db.uid()
            row_status = result["status"] if final else "error"
            row_result = result if final else {"status": "error", "tool": tool,
                         "error": {"code": attempt.get("code") or "PROVIDER_ERROR", "message": public_error(attempt.get("code"))}}
            connection.execute(
                "INSERT INTO tool_runs (id,conversation_id,user_id,tool,provider,service_name,attempt,status,credits,cache_hit,input_hash,result,error_code,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (row_id, conversation_id, user["id"], tool, attempt.get("provider") or provider or "unknown",
                 attempt.get("service_name") or service_name, index, row_status, attempt.get("credits"),
                 int(cache_hit if final else False), input_hash, db.dumps(row_result),
                 (row_result.get("error") or {}).get("code"), created),
            )
        if chart and result["status"] == "ok" and conversation_id:
            connection.execute("INSERT INTO charts VALUES (?,?,?,?)", (chart["id"], conversation_id, db.dumps(chart), created))
    maintenance.notify("tool_runs", len(records))
    return result, chart


async def execute(tool, payload, user, conversation_id=None, profiles=None, stop=None):
    return await asyncio.to_thread(execute_sync, tool, payload, user, conversation_id, profiles, stop)


async def search_locations(query, user):
    result, _ = await execute("geocode", {"query": query}, user)
    if result["status"] != "ok":
        return {"locations": [], "message": "地点搜索暂时不可用，请稍后重试；也可以先保存为未知。"}
    data = result.get("data") or {}
    items = data.get("items", data.get("results", data.get("locations", data.get("data", []))))
    if not isinstance(items, list):
        items = []
    locations = []
    for item in items[:30]:
        if not isinstance(item, dict):
            continue
        lat, lon = item.get("latitude", item.get("lat")), item.get("longitude", item.get("lon", item.get("lng")))
        try:
            lat, lon = float(lat), float(lon)
        except (TypeError, ValueError):
            continue
        if not finite(lat) or not finite(lon) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
            continue
        name = item.get("display_name") or item.get("name") or item.get("label")
        if not isinstance(name, str) or not name:
            continue
        zone = item.get("timezone") or item.get("time_zone")
        try:
            if not isinstance(zone, str):
                zone = None
            elif zone:
                ZoneInfo(zone)
        except (ZoneInfoNotFoundError, ValueError):
            zone = None
        locations.append({"name": name[:300], "latitude": lat, "longitude": lon, "timezone": zone})
    return {"locations": locations, **({"message": "没有找到匹配地点，请补充城市或地区名称。"} if not locations else {})}
