import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("XINGWEI_DATA_DIR", os.environ.get("TAROT_DATA_DIR", ROOT / "data"))).resolve()
DB_PATH = DATA_DIR / "tarot.sqlite3"
UPLOAD_DIR = DATA_DIR / "uploads"
WEB_DIR = ROOT / "web" / "dist"
CARD_DIR = ROOT / "web" / "public" / "cards"
COOKIE_SECURE = os.environ.get("XINGWEI_COOKIE_SECURE", os.environ.get("TAROT_COOKIE_SECURE", "false")).lower() == "true"
SESSION_DAYS = 30
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


def positive_env(name, default):
    value = int(os.environ.get(name, default))
    if value < 1:
        raise ValueError(f"{name} 必须是正整数")
    return value


LOG_RETENTION_DAYS = positive_env("XINGWEI_LOG_RETENTION_DAYS", 90)
LOG_MAX_ROWS = positive_env("XINGWEI_LOG_MAX_ROWS", 20000)
LOG_CLEANUP_WRITES = positive_env("XINGWEI_LOG_CLEANUP_WRITES", 100)
LOG_CLEANUP_COOLDOWN = positive_env("XINGWEI_LOG_CLEANUP_COOLDOWN", 300)
