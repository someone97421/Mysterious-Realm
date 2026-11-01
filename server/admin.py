import shutil
import sqlite3
import time

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import ValidationError

from . import auth, db, llm, usage, settings as astrology_settings
from .config import DATA_DIR, UPLOAD_DIR
from .schemas import AstrologyServiceInput, AstrologySettingsPatch, ModelConfig, UserCreate, UserPatch

router = APIRouter(prefix="/api/admin", dependencies=[Depends(auth.administrator)])


def model_public(row):
    result = {key: value for key, value in row.items() if key != "api_key"}
    result.setdefault("reasoning_field", "")
    result.update(
        has_api_key=bool(row["api_key"]),
        supports_images=bool(row["supports_images"]),
        is_default=bool(row["is_default"]),
        mode_scope=row.get("mode_scope") or "both",
        is_default_tarot=bool(row.get("is_default_tarot")),
        is_default_astrology=bool(row.get("is_default_astrology")),
    )
    return result


def supports_mode(model, mode):
    return model.get("mode_scope", "both") in ("both", mode)




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
    shutil.rmtree(DATA_DIR / "astro-cache" / user_id, ignore_errors=True)
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
        values["is_default_tarot"] = bool(body.is_default_tarot or first) and supports_mode(values, "tarot")
        values["is_default_astrology"] = bool(body.is_default_astrology or first) and supports_mode(values, "astrology")
        if values["is_default"]:
            connection.execute("UPDATE models SET is_default=0")
        if values["is_default_tarot"]:
            connection.execute("UPDATE models SET is_default_tarot=0")
        if values["is_default_astrology"]:
            connection.execute("UPDATE models SET is_default_astrology=0")
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
        if values["is_default_tarot"]:
            connection.execute("UPDATE models SET is_default_tarot=0")
        if values["is_default_astrology"]:
            connection.execute("UPDATE models SET is_default_astrology=0")
        connection.execute("UPDATE models SET " + ",".join(f"{key}=?" for key in values) + " WHERE id=?", (*values.values(), model_id))
    return model_public(get_model(model_id))


@router.post("/models/{model_id}/default")
def set_default(model_id: str, body: dict | None = None):
    model = get_model(model_id)
    mode = (body or {}).get("mode", "global")
    if mode not in {"global", "tarot", "astrology"}:
        raise HTTPException(422, "默认模型模式无效")
    if mode != "global" and not supports_mode(model, mode):
        raise HTTPException(400, "该模型未绑定当前模式")
    with db.connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        if mode == "global":
            connection.execute("UPDATE models SET is_default=0")
            connection.execute("UPDATE models SET is_default=1 WHERE id=?", (model_id,))
        else:
            field = "is_default_tarot" if mode == "tarot" else "is_default_astrology"
            connection.execute(f"UPDATE models SET {field}=0")
            connection.execute(f"UPDATE models SET {field}=1 WHERE id=?", (model_id,))
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


@router.get("/stats")
def stats(days: int = Query(30, ge=1, le=366), user_id: str = "", model_id: str = "",
          page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=100)):
    return usage.stats(days, user_id, model_id, page, page_size)

@router.get("/astrology")
def get_astrology_settings():
    return astrology_settings.public_settings()


@router.put("/astrology")
def update_astrology_settings(body: AstrologySettingsPatch, admin=Depends(auth.administrator)):
    return astrology_settings.save_settings(body)


@router.post("/astrology/services")
def create_astrology_service(body: AstrologyServiceInput):
    return astrology_settings.create_service(body)


@router.put("/astrology/services/{service_id}")
def update_astrology_service(service_id: str, body: AstrologyServiceInput):
    result = astrology_settings.update_service(service_id, body)
    if not result:
        raise HTTPException(404, "占星服务配置不存在")
    return result


@router.delete("/astrology/services/{service_id}")
def delete_astrology_service(service_id: str):
    if not astrology_settings.delete_service(service_id):
        raise HTTPException(404, "占星服务配置不存在")
    return {"ok": True}


@router.get("/astrology/usage")
def astrology_usage(page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=100)):
    return usage.tool_usage(page, page_size)
