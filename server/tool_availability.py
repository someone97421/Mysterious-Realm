"""记录服务卡明确拒绝的接口；编辑服务卡后允许重新确认权限。"""

import json

from . import db
from .astro_pack.shared.protocol import tool_catalog

PREFIX = "astro.unavailable."
PERMANENT_DENIALS = {
    "PAYMENT_REQUIRED": {"PLAN_UPGRADE_REQUIRED", "PLAN_PACK_MISMATCH"},
    "PERMISSION_DENIED": {"INSUFFICIENT_SCOPE", "ENDPOINT_NOT_IN_SCOPE", "KEY_SUSPENDED", "DOMAIN_MISMATCH", "FORBIDDEN_ORIGIN"},
    "AUTHENTICATION_FAILED": {"INVALID_API_KEY"},
}
UNAVAILABLE_ERRORS = set(PERMANENT_DENIALS) | {
    "TOOL_DISABLED", "UNSUPPORTED_CAPABILITY", "MISSING_API_KEY", "CREDIT_SPEND_NOT_ALLOWED",
    "UNKNOWN_COST_NOT_ALLOWED", "COST_LIMIT_EXCEEDED", "CREDITS_EXHAUSTED", "SPEND_CAP_REACHED", "KEY_BUDGET_EXHAUSTED",
}


def blocked_services():
    result = {}
    for row in db.all_rows("SELECT key,value FROM settings WHERE key LIKE ?", (PREFIX + "%",)):
        try:
            value = json.loads(row["value"])
        except (TypeError, json.JSONDecodeError):
            continue
        if isinstance(value, dict):
            result[row["key"]] = value
    return result


def services_for(tool, settings, blocked=None):
    blocked = blocked if blocked is not None else blocked_services()
    spec = tool_catalog().get(tool, {})
    result = []
    for service in settings.get("services", []):
        if not service.get("enabled") or service.get("provider") not in spec.get("providers", []):
            continue
        if service["provider"] == "astroway":
            key = service.get("api_key", "").strip()
            if not key:
                continue
            if not key.startswith("aw_test_"):
                cost = spec.get("credits", {}).get("astroway")
                if not settings["allow_credit_spend"]:
                    continue
                if cost is None and not settings["allow_unknown_cost"]:
                    continue
                if cost is not None and settings["max_credits"] is not None and cost > settings["max_credits"]:
                    continue
        entry = blocked.get(PREFIX + service["id"] + "." + tool)
        if entry and entry.get("revision") == service.get("updated_at"):
            continue
        result.append(service)
    return result


def available_tools(settings):
    blocked = blocked_services()
    return {tool for tool in settings["enabled_tools"] if services_for(tool, settings, blocked)}


def remember_denials(connection, tool, attempts, settings):
    services = {service["id"]: service for service in settings.get("services", [])}
    for attempt in attempts:
        provider_code = attempt.get("provider_code")
        if not isinstance(provider_code, str) or provider_code not in PERMANENT_DENIALS.get(attempt.get("code"), set()):
            continue
        service = services.get(attempt.get("service_id"))
        if not service:
            continue
        key = PREFIX + service["id"] + "." + tool
        value = {"revision": service.get("updated_at"), "code": attempt["code"],
                 "provider_code": provider_code, "created_at": db.now()}
        connection.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                           (key, db.dumps(value)))
