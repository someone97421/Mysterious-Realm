import sqlite3
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import ValidationError

from . import auth, db, llm
from .config import UPLOAD_DIR
from .schemas import ModelConfig, UserCreate, UserPatch

router = APIRouter(prefix="/api/admin", dependencies=[Depends(auth.administrator)])


def model_public(row):
    result = {key: value for key, value in row.items() if key != "api_key"}
    result.update(has_api_key=bool(row["api_key"]), supports_images=bool(row["supports_images"]), is_default=bool(row["is_default"]))
    return result


def get_model(model_id):
    model = db.one("SELECT * FROM models WHERE id=?", (model_id,))
    if not model:
        raise HTTPException(404, "模型配置不存在")
    return model


@router.get("/users")
def users():
    return [auth.public_user(user) for user in db.all_rows("SELECT * FROM users ORDER BY created_at DESC")]


@router.post("/users")
def create_user(body: UserCreate):
    username = body.username.strip()
    if not username:
        raise HTTPException(422, "账号不能为空")
    user = dict(id=db.uid(), username=username, display_name=body.display_name.strip() or username,
                role=body.role, is_active=body.is_active, created_at=db.now())
    try:
        db.execute("INSERT INTO users VALUES (?,?,?,?,?,?,?)",
                   (user["id"], username, user["display_name"], auth.hash_password(body.password),
                    body.role, int(body.is_active), user["created_at"]))
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, "账号已存在") from exc
    return auth.public_user(user)


@router.patch("/users/{user_id}")
def update_user(user_id: str, body: UserPatch, admin=Depends(auth.administrator)):
    existing = db.one("SELECT * FROM users WHERE id=?", (user_id,))
    if not existing:
        raise HTTPException(404, "账号不存在")
    values = body.model_dump(exclude_none=True)
    if user_id == admin["id"] and (values.get("role", "admin") != "admin" or values.get("is_active") is False):
        raise HTTPException(400, "请使用另一管理员账号调整当前账号的角色或状态")
    password = values.pop("password", None)
    if password and not password.strip():
        password = None
    for key in ("username", "display_name"):
        if key in values:
            values[key] = values[key].strip()
            if not values[key]:
                raise HTTPException(422, "账号和显示名称不能为空")
    if password:
        values["password_hash"] = auth.hash_password(password)
    if values:
        try:
            with db.connect() as connection:
                connection.execute("UPDATE users SET " + ",".join(f"{key}=?" for key in values) + " WHERE id=?", (*values.values(), user_id))
                if password or values.get("is_active") is False:
                    connection.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "账号已存在") from exc
    return auth.public_user(db.one("SELECT * FROM users WHERE id=?", (user_id,)))


@router.delete("/users/{user_id}")
def delete_user(user_id: str, admin=Depends(auth.administrator)):
    if user_id == admin["id"]:
        raise HTTPException(400, "无法删除当前登录账号")
    files = db.all_rows("SELECT filename FROM uploads WHERE user_id=?", (user_id,))
    if not db.execute("DELETE FROM users WHERE id=?", (user_id,)):
        raise HTTPException(404, "账号不存在")
    for file in files:
        (UPLOAD_DIR / file["filename"]).unlink(missing_ok=True)
    return {"ok": True}


@router.get("/models")
def models():
    return [model_public(model) for model in db.all_rows("SELECT * FROM models ORDER BY is_default DESC,created_at DESC")]


@router.post("/models")
def create_model(body: ModelConfig):
    values = body.model_dump()
    values["api_key"] = auth.encrypt_key(values["api_key"])
    values.update(id=db.uid(), created_at=db.now())
    with db.connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        first = not connection.execute("SELECT 1 FROM models LIMIT 1").fetchone()
        values["is_default"] = bool(first or body.is_default)
        if values["is_default"]:
            connection.execute("UPDATE models SET is_default=0")
        columns = ",".join(values)
        connection.execute(f"INSERT INTO models ({columns}) VALUES ({','.join('?' for _ in values)})", tuple(values.values()))
    return model_public(get_model(values["id"]))


@router.patch("/models/{model_id}")
def update_model(model_id: str, body: dict):
    existing = get_model(model_id)
    combined = {key: existing[key] for key in ModelConfig.model_fields if key != "api_key"}
    combined.update({key: value for key, value in body.items() if key in ModelConfig.model_fields})
    try:
        values = ModelConfig.model_validate(combined).model_dump()
    except ValidationError as exc:
        raise HTTPException(422, "模型配置无效，请核对必填字段、上下文长度及输出预算") from exc
    values["api_key"] = auth.encrypt_key(values["api_key"]) if values["api_key"] else existing["api_key"]
    with db.connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        if values["is_default"]:
            connection.execute("UPDATE models SET is_default=0")
        connection.execute("UPDATE models SET " + ",".join(f"{key}=?" for key in values) + " WHERE id=?", (*values.values(), model_id))
    return model_public(get_model(model_id))


@router.post("/models/{model_id}/default")
def set_default(model_id: str):
    get_model(model_id)
    with db.connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("UPDATE models SET is_default=0")
        connection.execute("UPDATE models SET is_default=1 WHERE id=?", (model_id,))
    return model_public(get_model(model_id))


@router.delete("/models/{model_id}")
def delete_model(model_id: str):
    if not db.execute("DELETE FROM models WHERE id=?", (model_id,)):
        raise HTTPException(404, "模型配置不存在")
    return {"ok": True}


@router.post("/models/{model_id}/check")
async def check_model(model_id: str, admin=Depends(auth.administrator)):
    model = get_model(model_id)
    start = time.monotonic()
    try:
        await llm.complete(model, admin, "check", [{"role": "user", "content": "请仅回复：连接成功"}])
        return {"ok": True, "message": "连接成功，模型可以返回文本", "latency_ms": round((time.monotonic() - start) * 1000)}
    except llm.ModelError as exc:
        return {"ok": False, "message": str(exc), "latency_ms": round((time.monotonic() - start) * 1000)}


def aggregate(rows):
    total_in = sum(row["input_tokens"] for row in rows)
    known = [row for row in rows if row["cached_tokens"] is not None and not row["estimated"]]
    known_input = sum(row["input_tokens"] for row in known)
    cached = sum(row["cached_tokens"] or 0 for row in rows)
    return {"input_tokens": total_in, "output_tokens": sum(row["output_tokens"] for row in rows),
            "cached_tokens": cached, "cache_hit_rate": sum(row["cached_tokens"] for row in known) / known_input if known_input else None,
            "requests": len(rows), "estimated_requests": sum(bool(row["estimated"]) for row in rows)}


@router.get("/stats")
def stats(days: int = Query(30, ge=1, le=366), user_id: str = "", model_id: str = ""):
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    conditions, args = ["created_at>=?"], [since]
    if user_id:
        conditions.append("user_id=?")
        args.append(user_id)
    if model_id:
        conditions.append("model_id=?")
        args.append(model_id)
    rows = db.all_rows("SELECT * FROM usage WHERE " + " AND ".join(conditions) + " ORDER BY created_at DESC", args)

    def grouped(key, label_key=None):
        groups = defaultdict(list)
        for row in rows:
            value = row["created_at"][:10] if key == "day" else (row[key] or row[label_key])
            groups[value].append(row)
        result = [{"label": group[0][label_key] if label_key else value, **aggregate(group)} for value, group in groups.items()]
        return sorted(result, key=lambda row: row["label"]) if key == "day" else sorted(result, key=lambda row: row["input_tokens"] + row["output_tokens"], reverse=True)

    return {"totals": aggregate(rows), "by_user": grouped("user_id", "username"),
            "by_model": grouped("model_id", "model_name"), "daily": grouped("day"),
            "recent": [{**row, "estimated": bool(row["estimated"])} for row in rows[:100]]}
