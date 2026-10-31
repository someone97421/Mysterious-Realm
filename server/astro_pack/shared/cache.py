"""仅标准库的原子文件缓存。"""

import hashlib
import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from .protocol import cached_copy


class FileCache:
    def __init__(self, root: Path) -> None:
        self.root = root

    @staticmethod
    def make_key(tool: str, provider: str, payload: Dict[str, Any]) -> str:
        canonical = json.dumps(
            {"schema": "1.0.0", "tool": tool, "provider": provider, "input": payload},
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return hashlib.sha256(canonical).hexdigest()

    def _path(self, key: str) -> Path:
        return self.root / key[:2] / (key + ".json")

    def get(self, key: str, allow_stale: bool = False) -> Optional[Tuple[Dict[str, Any], bool]]:
        path = self._path(key)
        try:
            with path.open("r", encoding="utf-8") as handle:
                record = json.load(handle)
            envelope = record["response"]
            expires_at = float(record["expires_at"])
            if not isinstance(envelope, dict) or envelope.get("status") != "ok":
                return None
        except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
            return None
        now = time.time()
        if now < expires_at:
            return cached_copy(envelope, False, expires_at), False
        if allow_stale:
            return cached_copy(envelope, True, expires_at), True
        return None

    def set(self, key: str, envelope: Dict[str, Any], ttl_seconds: int) -> Optional[float]:
        if ttl_seconds <= 0 or envelope.get("status") != "ok":
            return None
        path = self._path(key)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            try:
                os.chmod(path.parent, 0o700)
            except OSError:
                pass
            expires_at = time.time() + ttl_seconds
            record = {"version": 1, "expires_at": expires_at, "response": envelope}
            descriptor, temporary = tempfile.mkstemp(prefix=key[:12] + "-", suffix=".tmp", dir=str(path.parent))
            try:
                with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                    json.dump(record, handle, ensure_ascii=False, separators=(",", ":"))
                    handle.flush()
                    os.fsync(handle.fileno())
                try:
                    os.chmod(temporary, 0o600)
                except OSError:
                    pass
                os.replace(temporary, path)
            except Exception:
                try:
                    os.unlink(temporary)
                except OSError:
                    pass
                raise
            return expires_at
        except OSError:
            return None
