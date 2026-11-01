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
    database = sqlite3.connect(DB_PATH, timeout=15)
    database.row_factory = sqlite3.Row
    database.execute("PRAGMA foreign_keys = ON")
    try:
        yield database
        database.commit()
    except BaseException:
        database.rollback()
        raise
    finally:
        database.close()


def one(sql, args=()):
    with connect() as database:
        row = database.execute(sql, args).fetchone()
        return dict(row) if row else None


def all_rows(sql, args=()):
    with connect() as database:
        return [dict(row) for row in database.execute(sql, args).fetchall()]


def execute(sql, args=()):
    with connect() as database:
        return database.execute(sql, args).rowcount


def _columns(connection, table):
    return {row["name"] for row in connection.execute(f"PRAGMA table_info({table})").fetchall()}


def _add_column(connection, table, column, definition):
    if column not in _columns(connection, table):
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def initialize():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    with connect() as database:
        database.execute("PRAGMA journal_mode = WAL")
        database.executescript("""
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
            reasoning_field TEXT NOT NULL DEFAULT '', supports_images INTEGER NOT NULL DEFAULT 0,
            context_window INTEGER NOT NULL,
            compression_threshold REAL NOT NULL, max_output_tokens INTEGER NOT NULL,
            is_default INTEGER NOT NULL DEFAULT 0,
            mode_scope TEXT NOT NULL DEFAULT 'both',
            is_default_tarot INTEGER NOT NULL DEFAULT 0,
            is_default_astrology INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS one_default_model ON models(is_default) WHERE is_default=1;
        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'tarot',
            summary TEXT NOT NULL DEFAULT '', summary_through INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS conversation_user ON conversations(user_id,updated_at);
        CREATE TABLE IF NOT EXISTS draws (
            id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'proposed', question TEXT NOT NULL, opening TEXT NOT NULL,
            spread_name TEXT NOT NULL, positions TEXT NOT NULL, upright_only INTEGER NOT NULL DEFAULT 0,
            cards TEXT NOT NULL DEFAULT '[]', reading TEXT, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS profiles (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL, avatar TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '#9B8AFB',
            birth_date TEXT, birth_time TEXT,
            time_accuracy TEXT NOT NULL DEFAULT 'unknown'
                CHECK(time_accuracy IN ('exact','approximate','range','unknown')),
            time_end TEXT, location_name TEXT, latitude REAL, longitude REAL, timezone TEXT,
            notes TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS profiles_user ON profiles(user_id, updated_at);
        CREATE TABLE IF NOT EXISTS messages (
            seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            role TEXT NOT NULL, content TEXT NOT NULL, images TEXT NOT NULL DEFAULT '[]',
            profiles TEXT NOT NULL DEFAULT '[]', reasoning TEXT NOT NULL DEFAULT '',
            draw_id TEXT REFERENCES draws(id) ON DELETE SET NULL,
            kind TEXT NOT NULL DEFAULT 'chat', reading TEXT, created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS message_conversation ON messages(conversation_id,seq);
        CREATE TABLE IF NOT EXISTS charts (
            id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS chart_conversation ON charts(conversation_id,created_at);
        CREATE TABLE IF NOT EXISTS progress (
            id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            text TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('running','complete','error')),
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS progress_conversation ON progress(conversation_id,created_at);
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
        CREATE TABLE IF NOT EXISTS tool_runs (
            id TEXT PRIMARY KEY,
            conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            tool TEXT NOT NULL, provider TEXT NOT NULL, service_name TEXT,
            attempt INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL,
            credits INTEGER, cache_hit INTEGER NOT NULL DEFAULT 0,
            input_hash TEXT NOT NULL DEFAULT '', result TEXT NOT NULL DEFAULT '{}',
            error_code TEXT, created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS tool_runs_created ON tool_runs(created_at);
        CREATE INDEX IF NOT EXISTS tool_runs_user ON tool_runs(user_id,created_at);
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY, value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS astrology_services (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL
                CHECK(provider IN ('cosmyday','astroway')),
            enabled INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 100,
            api_key TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS astrology_services_order ON astrology_services(enabled,priority,created_at);
        """)

        # 兼容塔罗开发版已有数据库，并把旧对话归入塔罗模式。
        _add_column(database, "models", "reasoning_field", "TEXT NOT NULL DEFAULT ''")
        _add_column(database, "models", "mode_scope", "TEXT NOT NULL DEFAULT 'both'")
        _add_column(database, "models", "is_default_tarot", "INTEGER NOT NULL DEFAULT 0")
        _add_column(database, "models", "is_default_astrology", "INTEGER NOT NULL DEFAULT 0")
        _add_column(database, "conversations", "mode", "TEXT NOT NULL DEFAULT 'tarot'")
        _add_column(database, "messages", "profiles", "TEXT NOT NULL DEFAULT '[]'")
        _add_column(database, "messages", "reasoning", "TEXT NOT NULL DEFAULT ''")
        database.execute("CREATE INDEX IF NOT EXISTS conversation_mode ON conversations(user_id,mode,updated_at)")
        _add_column(database, "messages", "draw_id", "TEXT REFERENCES draws(id) ON DELETE SET NULL")
        _add_column(database, "messages", "reading", "TEXT")
        database.execute("UPDATE conversations SET mode='tarot' WHERE mode IS NULL OR mode=''")
        database.execute("UPDATE models SET mode_scope='both' WHERE mode_scope IS NULL OR mode_scope=''")
        if not database.execute("SELECT 1 FROM models WHERE is_default_tarot=1").fetchone():
            database.execute("UPDATE models SET is_default_tarot=1 WHERE is_default=1 AND mode_scope IN ('both','tarot')")
        if not database.execute("SELECT 1 FROM models WHERE is_default_astrology=1").fetchone():
            database.execute("UPDATE models SET is_default_astrology=1 WHERE is_default=1 AND mode_scope IN ('both','astrology')")
        database.execute("UPDATE progress SET state='error', text='任务因服务重启中断' WHERE state='running'")
        from . import usage
        usage.initialize(database)


def tool_result(identity, conversation_id):
    return one("""
        SELECT result FROM tool_runs WHERE id=? AND conversation_id=?
        UNION ALL SELECT result FROM tool_results WHERE id=? AND conversation_id=? LIMIT 1
    """, (identity, conversation_id, identity, conversation_id))


def recent_tool_results(conversation_id):
    return all_rows("""
        SELECT id,tool,result,created_at FROM tool_runs WHERE conversation_id=?
        UNION ALL SELECT id,tool,result,created_at FROM tool_results WHERE conversation_id=?
        ORDER BY created_at DESC,id DESC LIMIT 40
    """, (conversation_id, conversation_id))
