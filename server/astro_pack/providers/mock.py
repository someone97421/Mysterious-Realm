"""显式选择的离线 fixture Provider；自动路由永不选择 Mock。"""

import json
from typing import Any, Dict

from .base import BaseProvider
from ..shared.errors import ToolError
from ..shared.protocol import empty_meta, success_envelope, utc_now


class MockProvider(BaseProvider):
    name = "mock"
    documentation = "tests/fixtures"

    def can_handle(self, tool: str, payload: Dict[str, Any]) -> bool:
        return True

    def cache_namespace(self) -> str:
        path = self.config.mock_fixture
        if path is None:
            return "mock:no-fixture"
        resolved = path.expanduser().resolve()
        try:
            modified = resolved.stat().st_mtime_ns
        except OSError:
            modified = 0
        return "mock:%s:%d" % (resolved, modified)

    def execute(self, tool: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        path = self.config.mock_fixture
        if path is None:
            raise ToolError("CONFIGURATION_ERROR", "Mock 模式需要 --fixture 或 ASTRO_MOCK_FIXTURE。")
        try:
            with path.open("r", encoding="utf-8") as handle:
                fixtures = json.load(handle)
        except OSError as error:
            raise ToolError("CONFIGURATION_ERROR", "无法读取 Mock fixture：%s" % str(error))
        except json.JSONDecodeError:
            raise ToolError("CONFIGURATION_ERROR", "Mock fixture 不是有效 JSON。")
        if tool not in fixtures:
            raise ToolError("UNSUPPORTED_CAPABILITY", "Mock fixture 未定义工具：%s" % tool)
        fixture = fixtures[tool]
        if not isinstance(fixture, dict):
            raise ToolError("CONFIGURATION_ERROR", "Mock fixture 的 %s 必须是对象。" % tool)
        if "error" in fixture and fixture["error"] is not None:
            error = fixture["error"]
            raise ToolError(
                str(error.get("code", "MOCK_FAILURE")),
                str(error.get("message", "Mock failure")),
                retryable=bool(error.get("retryable", False)),
                details=error.get("details"),
            )
        meta = empty_meta(self.name)
        meta.update(fixture.get("meta") or {})
        meta["provider"] = self.name
        meta["is_mock"] = True
        meta["source"] = {
            "name": self.name,
            "endpoint": "fixture",
            "documentation": self.documentation,
            "retrieved_at": utc_now(),
            "data_kind": "mock",
            "fixture": path.name,
        }
        return success_envelope(
            tool,
            fixture.get("data"),
            meta,
            warnings=fixture.get("warnings"),
            uncertainty=fixture.get("uncertainty"),
        )
