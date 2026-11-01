"""日志写入后合并触发分批清理，空闲时只等待事件。"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from threading import Lock
from time import monotonic

from . import db
from .config import LOG_CLEANUP_COOLDOWN, LOG_CLEANUP_WRITES, LOG_MAX_ROWS, LOG_RETENTION_DAYS

BATCH_SIZE = 500
BATCHES_PER_PASS = 20
TABLES = ("usage", "tool_runs", "progress")
logger = logging.getLogger(__name__)
_current = None


def prune_batch(table):
    if table not in TABLES:
        raise ValueError("不支持的日志表")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=LOG_RETENTION_DAYS)).isoformat()
    condition = "state!='running'" if table == "progress" else "1=1"
    with db.connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        count = connection.execute(f"SELECT COUNT(*) FROM {table} WHERE {condition}").fetchone()[0]
        excess = max(0, count - LOG_MAX_ROWS)
        rows = connection.execute(
            f"SELECT id,created_at FROM {table} WHERE {condition} ORDER BY created_at,id LIMIT ?", (BATCH_SIZE,)
        ).fetchall()
        identities = [row["id"] for index, row in enumerate(rows) if index < excess or row["created_at"] < cutoff]
        if not identities:
            return 0
        placeholders = ",".join("?" for _ in identities)
        if table == "tool_runs":
            connection.execute(f"""
                INSERT OR IGNORE INTO tool_results(id,conversation_id,user_id,tool,result,created_at)
                SELECT id,conversation_id,user_id,tool,result,created_at FROM tool_runs
                WHERE id IN ({placeholders}) AND conversation_id IS NOT NULL
            """, identities)
        connection.execute(f"DELETE FROM {table} WHERE id IN ({placeholders})", identities)
        return len(identities)


class LogMaintenance:
    def __init__(self):
        self._loop = asyncio.get_running_loop()
        self._wake = asyncio.Event()
        self._lock = Lock()
        self._closed = False
        self._pending = set()
        self._wake_scheduled = False
        self._writes = {table: 0 for table in TABLES}
        self._last_checked = {}
        self._task = asyncio.create_task(self._run())

    def notify(self, table, count):
        with self._lock:
            if self._closed:
                return
            self._writes[table] += count
            last = self._last_checked.get(table)
            due = last is None or self._writes[table] >= LOG_CLEANUP_WRITES or monotonic() - last >= LOG_CLEANUP_COOLDOWN
            if due:
                self._pending.add(table)
                if not self._wake_scheduled:
                    self._wake_scheduled = True
                    self._loop.call_soon_threadsafe(self._wake.set)

    async def _run(self):
        while True:
            await self._wake.wait()
            self._wake.clear()
            with self._lock:
                if self._closed:
                    return
                tables = [table for table in TABLES if table in self._pending]
                self._pending.clear()
                self._wake_scheduled = False
                for table in tables:
                    self._writes[table] = 0
                    self._last_checked[table] = monotonic()
            for table in tables:
                for _ in range(BATCHES_PER_PASS):
                    with self._lock:
                        if self._closed:
                            return
                    try:
                        count = await asyncio.to_thread(prune_batch, table)
                    except Exception:
                        with self._lock:
                            self._last_checked.pop(table, None)
                        logger.exception("日志维护暂未完成，将在后续写入时重试：%s", table)
                        break
                    if count < BATCH_SIZE:
                        break
                    await asyncio.sleep(0)
                else:
                    with self._lock:
                        self._last_checked.pop(table, None)

    async def shutdown(self):
        global _current
        with self._lock:
            self._closed = True
        if _current is self:
            _current = None
        self._wake.set()
        await self._task


def start():
    global _current
    _current = LogMaintenance()
    return _current


def notify(table, count=1):
    worker = _current
    if worker is not None:
        worker.notify(table, count)
