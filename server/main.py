import asyncio
import io
import sqlite3
import warnings
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError

from . import admin, auth, conversations, db, maintenance, profiles
from .config import CARD_DIR, MAX_UPLOAD_BYTES, UPLOAD_DIR, WEB_DIR
from .schemas import Login, Setup


@asynccontextmanager
async def lifespan(app):
    db.initialize()
    auth.initialize_cipher()
    log_maintenance = maintenance.start()
    try:
        yield
    finally:
        await asyncio.gather(log_maintenance.shutdown(), conversations.shutdown(), return_exceptions=True)


app = FastAPI(title="秘域 · Mysterious Realm", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(admin.router)
app.include_router(profiles.router)
app.include_router(conversations.router)


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    errors = []
    for error in exc.errors():
        field = ".".join(str(part) for part in error["loc"] if part != "body")
        errors.append(f"{field}：{error['msg']}")
    return JSONResponse(status_code=422, content={"detail": "；".join(errors)})


@app.middleware("http")
async def response_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/auth/me")
def me(request: Request):
    user = auth.optional_user(request)
    return {"user": auth.public_user(user) if user else None,
            "setup_required": not bool(db.one("SELECT 1 FROM users LIMIT 1"))}


@app.post("/api/auth/setup")
def setup(body: Setup, response: Response):
    username = body.username.strip()
    if not username:
        raise HTTPException(422, "账号不能为空")
    user_id = db.uid()
    with db.connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        if connection.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            raise HTTPException(409, "管理员已经创建，请登录")
        connection.execute("INSERT INTO users VALUES (?,?,?,?,?,?,?)",
                           (user_id, username, body.display_name.strip() or username,
                            auth.hash_password(body.password), "admin", 1, db.now()))
    auth.create_session(response, user_id)
    return {"user": auth.public_user(db.one("SELECT * FROM users WHERE id=?", (user_id,)))}


@app.post("/api/auth/login")
def login(body: Login, response: Response):
    user = db.one("SELECT * FROM users WHERE username=?", (body.username.strip(),))
    if not user or not auth.verify_password(body.password, user["password_hash"]):
        raise HTTPException(401, "账号或密码不正确")
    if not user["is_active"]:
        raise HTTPException(403, "账号已停用，请联系管理员")
    auth.create_session(response, user["id"])
    return {"user": auth.public_user(user)}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(auth.COOKIE)
    if token:
        db.execute("DELETE FROM sessions WHERE token_hash=?", (auth.token_hash(token),))
    response.delete_cookie(auth.COOKIE, path="/")
    return {"ok": True}


def _mode_model(mode):
    column = "is_default_tarot" if mode == "tarot" else "is_default_astrology"
    model = db.one(f"SELECT * FROM models WHERE {column}=1 AND mode_scope IN ('both',?) ORDER BY created_at DESC LIMIT 1", (mode,))
    if model:
        return model
    model = db.one("SELECT * FROM models WHERE is_default=1 AND mode_scope IN ('both',?) LIMIT 1", (mode,))
    if model:
        return model
    return db.one("SELECT * FROM models WHERE mode_scope IN ('both',?) ORDER BY created_at DESC LIMIT 1", (mode,))


@app.get("/api/config")
def config(user=Depends(auth.current_user)):
    tarot_model = _mode_model("tarot")
    astrology_model = _mode_model("astrology")
    models = db.all_rows("SELECT supports_images FROM models WHERE mode_scope='both'")
    return {
        "app_name": "秘域 · Mysterious Realm",
        "model_ready": tarot_model is not None or astrology_model is not None,
        "tarot_model_ready": tarot_model is not None,
        "astrology_model_ready": astrology_model is not None,
        "supports_images": bool(models) and any(model["supports_images"] for model in models),
        "tarot_supports_images": bool(tarot_model and tarot_model["supports_images"]),
        "astrology_supports_images": bool(astrology_model and astrology_model["supports_images"]),
        "max_upload_mb": 10,
    }


@app.post("/api/uploads")
async def upload(file: UploadFile, user=Depends(auth.current_user)):
    model = db.one("SELECT supports_images FROM models WHERE supports_images=1 LIMIT 1")
    if not model:
        raise HTTPException(400, "当前服务暂不支持图片")
    try:
        data = await file.read(MAX_UPLOAD_BYTES + 1)
    finally:
        await file.close()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "每张图片最多 10 MB")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as source:
                if source.format not in ("JPEG", "PNG", "WEBP"):
                    raise HTTPException(415, "请选择 PNG、JPEG 或 WebP 图片")
                source.load()
                image = ImageOps.exif_transpose(source).convert("RGB")
                image.thumbnail((2048, 2048))
                output = io.BytesIO()
                image.save(output, format="JPEG", quality=90)
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise HTTPException(415, "图片无法读取或尺寸过大，请换一张图片") from exc
    image_id = db.uid()
    filename = f"{image_id}.jpg"
    original_name = Path((file.filename or "图片").replace("\\", "/")).name[:200]
    destination = UPLOAD_DIR / filename
    destination.write_bytes(output.getvalue())
    try:
        db.execute("INSERT INTO uploads VALUES (?,?,?,?,?,?)", (image_id, user["id"], filename, original_name, "image/jpeg", db.now()))
    except sqlite3.Error:
        destination.unlink(missing_ok=True)
        raise
    return {"id": image_id, "url": f"/api/uploads/{image_id}", "original_name": original_name}


@app.get("/api/uploads/{image_id}")
def uploaded_image(image_id: str, user=Depends(auth.current_user)):
    image = db.one("SELECT * FROM uploads WHERE id=? AND user_id=?", (image_id, user["id"]))
    if not image or not (UPLOAD_DIR / image["filename"]).is_file():
        raise HTTPException(404, "图片不存在")
    return FileResponse(UPLOAD_DIR / image["filename"], media_type=image["mime_type"])


if CARD_DIR.is_dir():
    app.mount("/cards", StaticFiles(directory=CARD_DIR), name="cards")


@app.get("/{path:path}")
def frontend(path: str):
    if path == "api" or path.startswith("api/"):
        raise HTTPException(404, "接口不存在")
    candidate = (WEB_DIR / path).resolve()
    if candidate.is_relative_to(WEB_DIR.resolve()) and candidate.is_file():
        return FileResponse(candidate)
    index = WEB_DIR / "index.html"
    if not index.is_file():
        return JSONResponse(status_code=503, content={"detail": "前端尚未构建。开发模式请访问 Vite 地址；本地部署先在 web 目录执行 npm install 和 npm run build。"})
    if Path(path).suffix:
        raise HTTPException(404, "资源不存在")
    return FileResponse(index)
