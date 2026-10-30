import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

from .config import DATA_DIR, DB_PATH, UPLOAD_DIR


def now():
    return datetime.now(timezone.utc).isoformat()


def uid():
    return uuid.uuid4().hex


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


@contextmanager
def connect():
    db = sqlite3.connect(DB_PATH, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    try:
        yield db
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


def one(sql, args=()):
    with connect() as db:
        row = db.execute(sql, args).fetchone()
        return dict(row) if row else None


def all_rows(sql, args=()):
    with connect() as db:
        return [dict(row) for row in db.execute(sql, args).fetchall()]


def execute(sql, args=()):
    with connect() as db:
        return db.execute(sql, args).rowcount


def initialize():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    with connect() as db:
        db.execute("PRAGMA journal_mode = WAL")
        db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
            display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('admin','user')),
            is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS models (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL,
            base_url TEXT NOT NULL, model_id TEXT NOT NULL, api_key TEXT NOT NULL,
            schema_type TEXT NOT NULL, reasoning_effort TEXT NOT NULL DEFAULT 'none',
            supports_images INTEGER NOT NULL DEFAULT 0, context_window INTEGER NOT NULL,
            compression_threshold REAL NOT NULL, max_output_tokens INTEGER NOT NULL,
            is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS one_default_model ON models(is_default) WHERE is_default=1;
        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', summary_through INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS draws (
            id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'proposed', question TEXT NOT NULL, opening TEXT NOT NULL,
            spread_name TEXT NOT NULL, positions TEXT NOT NULL, upright_only INTEGER NOT NULL DEFAULT 0,
            cards TEXT NOT NULL DEFAULT '[]', reading TEXT, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
            seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            role TEXT NOT NULL, content TEXT NOT NULL, images TEXT NOT NULL DEFAULT '[]',
            draw_id TEXT REFERENCES draws(id) ON DELETE SET NULL,
            kind TEXT NOT NULL DEFAULT 'chat', created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS message_conversation ON messages(conversation_id,seq);
        CREATE INDEX IF NOT EXISTS conversation_user ON conversations(user_id,updated_at);
        CREATE TABLE IF NOT EXISTS uploads (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            filename TEXT NOT NULL, original_name TEXT NOT NULL, mime_type TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS usage (
            id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
            model_id TEXT REFERENCES models(id) ON DELETE SET NULL,
            username TEXT NOT NULL, model_name TEXT NOT NULL, purpose TEXT NOT NULL,
            input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
            cached_tokens INTEGER, estimated INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS usage_created ON usage(created_at);
        """)
