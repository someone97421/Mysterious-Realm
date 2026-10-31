"""按服务卡优先级选择 Provider，并执行受控故障转移。"""

from dataclasses import replace
from typing import Any, Dict, List, Optional

from .astroway import AstroWayProvider
from .base import BaseProvider
from .cosmyday import CosmyDayProvider
from .mock import MockProvider
from ..shared.cache import FileCache
from ..shared.config import Config
from ..shared.errors import ToolError
from ..shared.protocol import issue, tool_catalog


PROVIDER_CLASSES = {"cosmyday": CosmyDayProvider, "astroway": AstroWayProvider, "mock": MockProvider}
RETRYABLE_FAILURES = {
    "MISSING_API_KEY", "AUTHENTICATION_FAILED", "PAYMENT_REQUIRED", "CREDIT_SPEND_NOT_ALLOWED",
    "UNKNOWN_COST_NOT_ALLOWED", "COST_LIMIT_EXCEEDED", "CREDITS_EXHAUSTED", "SPEND_CAP_REACHED",
    "KEY_BUDGET_EXHAUSTED", "RATE_LIMIT", "NETWORK_ERROR", "PROVIDER_UNAVAILABLE", "PROVIDER_ERROR",
    "PROVIDER_RESPONSE_ERROR", "TIMEOUT", "CACHE_MISS_OFFLINE",
}


class ToolService:
    def __init__(self, config: Config, services: Optional[List[Dict[str, Any]]] = None) -> None:
        self.config = config
        self.catalog = tool_catalog()
        self.cache = FileCache(config.cache_dir)
        self.services = services
        self.providers: Dict[str, BaseProvider] = {}

    def _config_for(self, service: Dict[str, Any]) -> Config:
        return replace(self.config, provider=service["provider"], api_key=service.get("api_key", ""),
                       service_name=service.get("id") or service.get("name", ""))

    def provider(self, service: Dict[str, Any]) -> BaseProvider:
        identity = service.get("id") or service.get("name") or service["provider"]
        if identity not in self.providers:
            self.providers[identity] = PROVIDER_CLASSES[service["provider"]](self._config_for(service))
        return self.providers[identity]

    @staticmethod
    def cache_response(envelope, read_cache, write_cache, ttl, service):
        envelope["meta"].pop("attempts", None)
        envelope["meta"]["cache"].update({"enabled": read_cache, "write_enabled": write_cache, "ttl_seconds": ttl})
        envelope["meta"]["service_name"] = service.get("name")
        envelope["meta"]["service_id"] = service.get("id")
        return envelope

    def provider_names(self, tool: str) -> List[str]:
        supported = self.catalog[tool]["providers"]
        requested = self.config.provider
        if requested == "auto":
            return list(supported)
        if requested not in PROVIDER_CLASSES:
            raise ToolError("CONFIGURATION_ERROR", "占星服务配置无效。")
        if requested == "mock":
            return ["mock"]
        if requested not in supported:
            raise ToolError("UNSUPPORTED_CAPABILITY", "当前服务不支持这项星象计算。")
        return [requested]

    def _services_for(self, tool: str) -> List[Dict[str, Any]]:
        supported = set(self.catalog[tool]["providers"])
        services = self.services
        if services is None:
            services = [{"id": name, "name": name, "provider": name, "enabled": True,
                         "priority": index, "api_key": self.config.api_key}
                        for index, name in enumerate(self.provider_names(tool))]
        return sorted((item for item in services if item.get("enabled") and item.get("provider") in supported),
                      key=lambda item: (item.get("priority", 100), item.get("id", "")))

    def execute(self, tool: str, payload: Dict[str, Any], warnings=None, uncertainty=None, stop=None) -> Dict[str, Any]:
        warnings = warnings or []
        uncertainty = uncertainty or []
        if tool not in self.catalog:
            raise ToolError("UNKNOWN_TOOL", "当前星象工具不存在。")
        catalog_ttl = self.catalog[tool]["ttl_seconds"]
        ttl = self.config.cache_ttl if catalog_ttl > 0 and self.config.cache_ttl is not None else catalog_ttl
        read_cache = self.config.cache_enabled and not self.config.no_cache and catalog_ttl > 0
        write_cache = read_cache and ttl > 0
        services = self._services_for(tool)
        eligible = [service for service in services if self.provider(service).can_handle(tool, payload)]
        if not eligible:
            raise ToolError("UNSUPPORTED_CAPABILITY", "没有已启用的占星服务能完整满足这项计算的参数。")
        keys = {service["id"]: self.cache.make_key(tool, self.provider(service).cache_namespace(), payload) for service in eligible}
        if read_cache and not self.config.refresh:
            for service in eligible:
                cached = self.cache.get(keys[service["id"]])
                if cached is not None:
                    return self.cache_response(cached[0], read_cache, write_cache, ttl, service)

        attempts: List[Dict[str, Any]] = []
        for service in eligible[:3]:
            if stop is not None and stop.is_set():
                break
            if self.config.offline and service["provider"] != "mock":
                if read_cache:
                    stale = self.cache.get(keys[service["id"]], allow_stale=True)
                    if stale is not None:
                        return self.cache_response(stale[0], read_cache, write_cache, ttl, service)
                attempts.append({"service_name": service.get("name"), "provider": service["provider"],
                                 "code": "OFFLINE", "retryable": True, "credits": 0})
                continue
            provider = self.provider(service)
            try:
                envelope = provider.execute(tool, payload)
            except ToolError as error:
                attempts.append({"service_name": service.get("name"), "provider": service["provider"],
                                 "code": error.code, "retryable": error.code in RETRYABLE_FAILURES or error.retryable,
                                 "credits": None})
                if read_cache and error.retryable:
                    stale = self.cache.get(keys[service["id"]], allow_stale=True)
                    if stale is not None:
                        result = self.cache_response(stale[0], read_cache, write_cache, ttl, service)
                        result["meta"]["attempts"] = attempts
                        return result
                if error.code not in RETRYABLE_FAILURES and not error.retryable:
                    break
                continue
            except Exception as error:
                attempts.append({"service_name": service.get("name"), "provider": service["provider"],
                                 "code": "INTERNAL_ERROR", "retryable": False, "credits": None})
                raise ToolError("INTERNAL_ERROR", "占星服务执行出现内部错误。", retryable=False,
                                details={"attempts": attempts, "exhausted": True}) from error
            envelope["warnings"] = warnings + envelope.get("warnings", [])
            envelope["uncertainty"] = uncertainty + envelope.get("uncertainty", [])
            envelope["meta"]["cache"] = {"enabled": read_cache, "write_enabled": write_cache,
                                            "hit": False, "stale": False, "ttl_seconds": ttl}
            envelope["meta"]["service_name"] = service.get("name")
            envelope["meta"]["service_id"] = service.get("id")
            credits = (envelope["meta"].get("credits") or {}).get("used")
            attempts.append({"service_name": service.get("name"), "provider": service["provider"], "code": None,
                             "retryable": False, "credits": credits if isinstance(credits, (int, float)) else (0 if service["provider"] == "cosmyday" else None)})
            envelope["meta"]["attempts"] = attempts
            if write_cache:
                expires_at = self.cache.set(keys[service["id"]], envelope, ttl)
                if expires_at is None:
                    envelope["warnings"].append(issue("CACHE_WRITE_FAILED", "无法写入本地缓存，但计算结果已保留。"))
                else:
                    envelope["meta"]["cache"]["expires_at"] = expires_at
            if len(attempts) > 1:
                envelope["warnings"].append(issue("PROVIDER_FALLBACK", "前一占星服务不可用，本次已由备用服务完成。"))
                envelope["meta"]["degraded"] = True
            return envelope

        exhausted = len(attempts) >= min(3, len(eligible))
        last = attempts[-1] if attempts else {"code": "PROVIDER_UNAVAILABLE", "retryable": True}
        raise ToolError(last["code"], "占星服务暂时无法完成这项计算。", retryable=bool(last.get("retryable")),
                        details={"attempts": attempts, "exhausted": exhausted})
