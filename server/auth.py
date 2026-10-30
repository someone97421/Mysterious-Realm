import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone

from cryptography.fernet import Fernet
from fastapi import Depends, HTTPException, Request, Response

from . import db
from .config import COOKIE_SECURE, DATA_DIR, SESSION_DAYS

COOKIE = "starveil_session"
_cipher = None


def initialize_cipher():
    global _cipher
    key_path = DATA_DIR / "secret.key"
    if not key_path.exists():
        with key_path.open("xb") as file:
            file.write(Fernet.generate_key())
        try:
            os.chmod(key_path, 0o600)
        except OSError:
            pass
    _cipher = Fernet(key_path.read_bytes().strip())


def encrypt_key(value):
    return _cipher.encrypt(value.encode()).decode() if value else ""


def decrypt_key(value):
    return _cipher.decrypt(value.encode()).decode() if value else ""


def hash_password(password):
    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)
    return f"{salt.hex()}:{derived.hex()}"


def verify_password(password, stored):
    salt, expected = stored.split(":")
    derived = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1)
    return hmac.compare_digest(derived.hex(), expected)


def public_user(user):
    return {**{k: user[k] for k in ("id", "username", "display_name", "role", "created_at")},
            "is_active": bool(user["is_active"])}


def token_hash(value):
    return hashlib.sha256(value.encode()).hexdigest()


def create_session(response: Response, user_id):
    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)).isoformat()
    db.execute("DELETE FROM sessions WHERE expires_at < ?", (db.now(),))
    db.execute("INSERT INTO sessions VALUES (?,?,?)", (token_hash(token), user_id, expires))
    response.set_cookie(COOKIE, token, max_age=SESSION_DAYS * 86400,
                        httponly=True, secure=COOKIE_SECURE, samesite="lax", path="/")


def optional_user(request: Request):
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    return db.one("""SELECT u.* FROM users u JOIN sessions s ON u.id=s.user_id
                     WHERE s.token_hash=? AND s.expires_at>? AND u.is_active=1""",
                  (token_hash(token), db.now()))


def current_user(request: Request):
    user = optional_user(request)
    if not user:
        raise HTTPException(401, "请先登录")
    return user


def administrator(user=Depends(current_user)):
    if user["role"] != "admin":
        raise HTTPException(403, "此入口仅管理员可访问")
    return user
