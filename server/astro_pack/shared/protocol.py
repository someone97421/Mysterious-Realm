"""统一 JSON 包络与本地只读资源。"""

import copy
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import SCHEMA_VERSION
from .errors import ToolError


PACK_ROOT = Path(__file__).resolve().parent.parent


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def tool_catalog() -> Dict[str, Any]:
    return load_json(PACK_ROOT / "shared" / "tool-catalog.json")["tools"]


def input_schemas() -> Dict[str, Any]:
    return load_json(PACK_ROOT / "shared" / "schemas" / "inputs.json")


def issue(code: str, message: str, fields: Optional[List[str]] = None) -> Dict[str, Any]:
    result = {"code": code, "message": message}
    if fields:
        result["fields"] = fields
    return result


def empty_meta(provider: Optional[str] = None) -> Dict[str, Any]:
    return {
        "provider": provider,
        "source": {},
        "calculation": {},
        "cache": {"enabled": False, "hit": False, "stale": False},
        "request_id": None,
        "credits": None,
        "rate_limit": None,
        "sandbox": False,
        "degraded": False,
        "is_mock": False,
    }


def success_envelope(
    tool: str,
    data: Any,
    meta: Dict[str, Any],
    warnings: Optional[List[Dict[str, Any]]] = None,
    uncertainty: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "tool": tool,
        "status": "ok",
        "data": data,
        "meta": meta,
        "warnings": warnings or [],
        "uncertainty": uncertainty or [],
        "error": None,
    }


def error_envelope(
    tool: str,
    error: ToolError,
    provider: Optional[str] = None,
    warnings: Optional[List[Dict[str, Any]]] = None,
    uncertainty: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "tool": tool,
        "status": "error",
        "data": None,
        "meta": empty_meta(provider),
        "warnings": warnings or [],
        "uncertainty": uncertainty or [],
        "error": error.as_dict(),
    }


def cached_copy(envelope: Dict[str, Any], stale: bool, expires_at: float) -> Dict[str, Any]:
    result = copy.deepcopy(envelope)
    cache = result["meta"].setdefault("cache", {})
    cache.update({"hit": True, "stale": stale, "expires_at": expires_at})
    if stale:
        result["meta"]["degraded"] = True
        result["warnings"].append(issue(
            "STALE_CACHE",
            "实时请求不可用，本次返回过期缓存；数据可能不是最新状态。",
        ))
        result["uncertainty"].append(issue(
            "STALE_DATA",
            "解释前应考虑过缓存造成的时间与数据不确定性。",
        ))
    return result
