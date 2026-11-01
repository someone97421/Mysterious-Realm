"""请求明细分页及独立于明细保留期限的用量账本。"""

from datetime import datetime, timedelta, timezone

from . import db
from .config import LOG_MAX_ROWS, LOG_RETENTION_DAYS


METRICS = """
    COALESCE(SUM(input_tokens),0) AS input_tokens,
    COALESCE(SUM(output_tokens),0) AS output_tokens,
    COALESCE(SUM(cached_tokens),0) AS cached_tokens,
    CASE WHEN SUM(cache_input_tokens)>0
        THEN 1.0*SUM(cache_known_tokens)/SUM(cache_input_tokens) END AS cache_hit_rate,
    COALESCE(SUM(requests),0) AS requests,
    COALESCE(SUM(estimated_requests),0) AS estimated_requests
"""


def initialize(connection):
    connection.executescript("""
        CREATE TABLE IF NOT EXISTS maintenance_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS usage_daily (
            day TEXT NOT NULL, user_key TEXT NOT NULL, model_key TEXT NOT NULL,
            username TEXT NOT NULL, model_name TEXT NOT NULL,
            input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
            cached_tokens INTEGER NOT NULL, cache_input_tokens INTEGER NOT NULL,
            cache_known_tokens INTEGER NOT NULL, requests INTEGER NOT NULL,
            estimated_requests INTEGER NOT NULL,
            PRIMARY KEY(day,user_key,model_key)
        );
        CREATE INDEX IF NOT EXISTS usage_daily_user_day ON usage_daily(user_key,day);
        CREATE INDEX IF NOT EXISTS usage_daily_model_day ON usage_daily(model_key,day);
        CREATE INDEX IF NOT EXISTS usage_listing ON usage(created_at DESC,id DESC);
        CREATE INDEX IF NOT EXISTS usage_user_listing ON usage(user_id,created_at DESC,id DESC);
        CREATE INDEX IF NOT EXISTS usage_model_listing ON usage(model_id,created_at DESC,id DESC);
        CREATE INDEX IF NOT EXISTS tool_runs_listing ON tool_runs(created_at DESC,id DESC);
        CREATE INDEX IF NOT EXISTS tool_runs_conversation ON tool_runs(conversation_id,created_at DESC,id DESC);
        CREATE TABLE IF NOT EXISTS tool_usage_totals (
            id INTEGER PRIMARY KEY CHECK(id=1), calls INTEGER NOT NULL DEFAULT 0,
            known_credits REAL NOT NULL DEFAULT 0, unknown_calls INTEGER NOT NULL DEFAULT 0,
            cache_hits INTEGER NOT NULL DEFAULT 0
        );
        INSERT OR IGNORE INTO tool_usage_totals(id) VALUES (1);
        CREATE TABLE IF NOT EXISTS tool_results (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            tool TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS tool_results_conversation ON tool_results(conversation_id,created_at DESC,id DESC);
        CREATE INDEX IF NOT EXISTS progress_listing ON progress(created_at,id) WHERE state!='running';
        CREATE TRIGGER IF NOT EXISTS usage_daily_insert AFTER INSERT ON usage BEGIN
            INSERT INTO usage_daily VALUES (
                substr(NEW.created_at,1,10), COALESCE(NEW.user_id,'user:'||NEW.username),
                COALESCE(NEW.model_id,'model:'||NEW.model_name), NEW.username, NEW.model_name,
                NEW.input_tokens, NEW.output_tokens, COALESCE(NEW.cached_tokens,0),
                CASE WHEN NEW.cached_tokens IS NOT NULL AND NEW.estimated=0 THEN NEW.input_tokens ELSE 0 END,
                CASE WHEN NEW.cached_tokens IS NOT NULL AND NEW.estimated=0 THEN NEW.cached_tokens ELSE 0 END,
                1, NEW.estimated
            ) ON CONFLICT(day,user_key,model_key) DO UPDATE SET
                username=excluded.username, model_name=excluded.model_name,
                input_tokens=input_tokens+excluded.input_tokens,
                output_tokens=output_tokens+excluded.output_tokens,
                cached_tokens=cached_tokens+excluded.cached_tokens,
                cache_input_tokens=cache_input_tokens+excluded.cache_input_tokens,
                cache_known_tokens=cache_known_tokens+excluded.cache_known_tokens,
                requests=requests+1, estimated_requests=estimated_requests+excluded.estimated_requests;
        END;
        CREATE TRIGGER IF NOT EXISTS tool_usage_insert AFTER INSERT ON tool_runs BEGIN
            UPDATE tool_usage_totals SET calls=calls+1,
                known_credits=known_credits+COALESCE(NEW.credits,0),
                unknown_calls=unknown_calls+CASE WHEN NEW.credits IS NULL THEN 1 ELSE 0 END,
                cache_hits=cache_hits+NEW.cache_hit WHERE id=1;
        END;
    """)
    if not connection.execute("SELECT 1 FROM maintenance_state WHERE key='usage_ledger_v1'").fetchone():
        connection.execute("""
            INSERT INTO usage_daily
            SELECT substr(created_at,1,10), COALESCE(user_id,'user:'||username),
                   COALESCE(model_id,'model:'||model_name),
                   COALESCE((SELECT username FROM users WHERE id=usage.user_id), MAX(username)),
                   COALESCE((SELECT name FROM models WHERE id=usage.model_id), MAX(model_name)),
                   SUM(input_tokens), SUM(output_tokens), SUM(COALESCE(cached_tokens,0)),
                   SUM(CASE WHEN cached_tokens IS NOT NULL AND estimated=0 THEN input_tokens ELSE 0 END),
                   SUM(CASE WHEN cached_tokens IS NOT NULL AND estimated=0 THEN cached_tokens ELSE 0 END),
                   COUNT(*), SUM(estimated)
            FROM usage GROUP BY substr(created_at,1,10), COALESCE(user_id,'user:'||username),
                               COALESCE(model_id,'model:'||model_name)
        """)
        connection.execute("""
            UPDATE tool_usage_totals SET
                calls=(SELECT COUNT(*) FROM tool_runs),
                known_credits=(SELECT COALESCE(SUM(credits),0) FROM tool_runs),
                unknown_calls=(SELECT COUNT(*) FROM tool_runs WHERE credits IS NULL),
                cache_hits=(SELECT COALESCE(SUM(cache_hit),0) FROM tool_runs) WHERE id=1
        """)
        connection.execute("INSERT INTO maintenance_state VALUES ('usage_ledger_v1','ready')")


def retention():
    return {"days": LOG_RETENTION_DAYS, "max_rows": LOG_MAX_ROWS}


def paginated(connection, table, columns, conditions, args, page, page_size):
    where = " AND ".join(conditions) if conditions else "1=1"
    total = connection.execute(f"SELECT COUNT(*) FROM {table} WHERE {where}", args).fetchone()[0]
    total_pages = max(1, (total + page_size - 1) // page_size)
    page = min(page, total_pages)
    rows = connection.execute(
        f"SELECT {columns} FROM {table} WHERE {where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",
        [*args, page_size, (page - 1) * page_size],
    ).fetchall()
    return [dict(row) for row in rows], {"page": page, "page_size": page_size, "total": total, "total_pages": total_pages}


def stats(days, user_id, model_id, page, page_size):
    since = (datetime.now(timezone.utc).date() - timedelta(days=days - 1)).isoformat()
    conditions, args = ["day>=?"], [since]
    recent_conditions, recent_args = ["created_at>=?"], [since]
    if user_id:
        conditions.append("user_key=?")
        recent_conditions.append("user_id=?")
        args.append(user_id)
        recent_args.append(user_id)
    if model_id:
        conditions.append("model_key=?")
        recent_conditions.append("model_id=?")
        args.append(model_id)
        recent_args.append(model_id)
    where = " AND ".join(conditions)
    with db.connect() as connection:
        connection.execute("BEGIN")
        totals = dict(connection.execute(f"SELECT {METRICS} FROM usage_daily WHERE {where}", args).fetchone())
        by_user = [dict(row) for row in connection.execute(
            f"""SELECT COALESCE((SELECT username FROM users WHERE id=usage_daily.user_key),
                (SELECT username FROM usage_daily latest WHERE latest.user_key=usage_daily.user_key
                 ORDER BY latest.day DESC,latest.model_key DESC LIMIT 1)) AS label,{METRICS}
                FROM usage_daily WHERE {where} GROUP BY user_key
                ORDER BY SUM(input_tokens)+SUM(output_tokens) DESC,user_key""", args)]
        by_model = [dict(row) for row in connection.execute(
            f"""SELECT COALESCE((SELECT name FROM models WHERE id=usage_daily.model_key),
                (SELECT model_name FROM usage_daily latest WHERE latest.model_key=usage_daily.model_key
                 ORDER BY latest.day DESC,latest.user_key DESC LIMIT 1)) AS label,{METRICS}
                FROM usage_daily WHERE {where} GROUP BY model_key
                ORDER BY SUM(input_tokens)+SUM(output_tokens) DESC,model_key""", args)]
        daily = [dict(row) for row in connection.execute(
            f"SELECT day AS label,{METRICS} FROM usage_daily WHERE {where} GROUP BY day ORDER BY day", args)]
        recent, pagination = paginated(connection, "usage", "*", recent_conditions, recent_args, page, page_size)
    return {"totals": totals, "by_user": by_user, "by_model": by_model, "daily": daily,
            "recent": [{**row, "estimated": bool(row["estimated"])} for row in recent],
            "pagination": pagination, "retention": retention()}


def tool_usage(page, page_size):
    with db.connect() as connection:
        connection.execute("BEGIN")
        totals = dict(connection.execute("SELECT calls,known_credits,unknown_calls,cache_hits FROM tool_usage_totals WHERE id=1").fetchone())
        rows, pagination = paginated(connection, "tool_runs",
            "id,tool,provider,service_name,attempt,status,credits,cache_hit,created_at,error_code", [], [], page, page_size)
    totals["credits"] = None if totals["unknown_calls"] else totals["known_credits"]
    return {"recent": [{**row, "cache_hit": bool(row["cache_hit"])} for row in rows],
            "totals": totals, "pagination": pagination, "retention": retention()}
