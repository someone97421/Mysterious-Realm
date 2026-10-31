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
