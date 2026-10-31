import json

from . import auth, db
from .schemas import ASTRO_TOOLS, AstrologyServiceInput, AstrologySettingsPatch

DEFAULTS = {
    "allow_credit_spend": False,
    "allow_unknown_cost": False,
    "max_credits": 100,
    "timeout": 30.0,
    "cache_enabled": True,
    "enabled_tools": list(ASTRO_TOOLS),
}


def _setting_values():
    values = {**DEFAULTS, "enabled_tools": list(DEFAULTS["enabled_tools"])}
    for row in db.all_rows("SELECT key,value FROM settings"):
        if row["key"] in values:
            try:
                values[row["key"]] = json.loads(row["value"])
            except (TypeError, json.JSONDecodeError):
                continue
    return values


def _service_rows(decrypt=False):
    rows = db.all_rows("SELECT id,name,provider,enabled,priority,api_key,created_at,updated_at FROM astrology_services ORDER BY priority,id")
    result = []
    for row in rows:
        item = dict(row)
        item["enabled"] = bool(item["enabled"])
        if decrypt:
            item["api_key"] = auth.decrypt_key(item["api_key"]) if item["api_key"] else ""
        else:
            item.pop("api_key", None)
            item["has_api_key"] = bool(row["api_key"])
        result.append(item)
    return result


def runtime_settings():
    values = _setting_values()
    # 空 services 是用户明确配置状态，不能从旧 settings 复活已删除的服务卡。
    values["services"] = _service_rows(decrypt=True)
    return values


def public_settings():
    values = _setting_values()
    return {**values, "services": _service_rows(decrypt=False)}


def save_settings(body: AstrologySettingsPatch):
    values = body.model_dump(exclude={"provider", "api_key", "clear_api_key"})
    with db.connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        for key, value in values.items():
            connection.execute(
                "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, db.dumps(value)),
            )
    return public_settings()


def _service_public(row):
    result = {key: row[key] for key in ("id", "name", "provider", "created_at", "updated_at")}
    result.update(enabled=bool(row["enabled"]), priority=int(row["priority"]), has_api_key=bool(row.get("api_key")))
    return result


def create_service(body: AstrologyServiceInput):
    values = body.model_dump()
    key = "" if body.provider == "cosmyday" else (body.api_key or "")
    if body.clear_api_key:
        key = ""
    if key:
        key = auth.encrypt_key(key)
    identity, created = db.uid(), db.now()
    with db.connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            "INSERT INTO astrology_services (id,name,provider,enabled,priority,api_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (identity, body.name, body.provider, int(body.enabled), body.priority, key, created, created),
        )
    return _service_public(db.one("SELECT * FROM astrology_services WHERE id=?", (identity,)))


def update_service(service_id: str, body: AstrologyServiceInput):
    existing = db.one("SELECT * FROM astrology_services WHERE id=?", (service_id,))
    if not existing:
        return None
    key = existing["api_key"]
    if body.provider == "cosmyday" or body.clear_api_key:
        key = ""
    elif body.api_key:
        key = auth.encrypt_key(body.api_key)
    updated = db.now()
    with db.connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            "UPDATE astrology_services SET name=?,provider=?,enabled=?,priority=?,api_key=?,updated_at=? WHERE id=?",
            (body.name, body.provider, int(body.enabled), body.priority, key, updated, service_id),
        )
    return _service_public(db.one("SELECT * FROM astrology_services WHERE id=?", (service_id,)))


def delete_service(service_id: str):
    return bool(db.execute("DELETE FROM astrology_services WHERE id=?", (service_id,)))
