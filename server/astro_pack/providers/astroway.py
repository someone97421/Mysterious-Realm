"""AstroWay API v1 适配器与额度控制。"""

from typing import Any, Dict, Optional, Tuple

from .base import BaseProvider, HttpResponse, calculation_parameters
from ..shared.errors import ToolError
from ..shared.normalize import astroway_chart, horary, object_data, synastry
from ..shared.protocol import issue, success_envelope, tool_catalog


class AstroWayProvider(BaseProvider):
    name = "astroway"
    base_url = "https://api.astroway.info/v1"
    documentation = "https://api.astroway.info/en/getting-started/"

    def can_handle(self, tool: str, payload: Dict[str, Any]) -> bool:
        return tool in tool_catalog() and self.name in tool_catalog()[tool]["providers"]

    def cache_namespace(self) -> str:
        key = self.config.api_key
        scope = "sandbox" if key.startswith("aw_test_") else "live"
        return "astroway:%s:%s" % (scope, self.config.service_name or "default")

    def execute(self, tool: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not self.can_handle(tool, payload):
            raise ToolError("UNSUPPORTED_CAPABILITY", "AstroWay 不支持工具：%s" % tool)
        key = self.config.api_key.strip()
        if not key:
            raise ToolError("MISSING_API_KEY", "占星服务尚未配置。")
        sandbox = key.startswith("aw_test_")
        estimated = tool_catalog()[tool]["credits"].get(self.name)
        self.check_cost(tool, estimated, sandbox)
        response, endpoint = self.dispatch(tool, payload, key)
        raw = provider_data(response.payload)
        data = normalize_response(tool, raw)
        calculation = calculation_parameters(payload)
        if tool == "render-chart":
            calculation["render_kind"] = payload["kind"]
        elif tool == "secondary-progressions":
            calculation["converse"] = payload["converse"]
        meta = self.meta(
            endpoint,
            tool_catalog()[tool]["data_kind"],
            calculation,
            response.headers,
            sandbox=sandbox,
            estimated_credits=estimated,
        )
        warnings = []
        uncertainty = []
        if sandbox:
            warnings.append(issue(
                "ASTROWAY_SANDBOX",
                "当前为 AstroWay 沙箱结果；文档说明其可能是桩数据或最小真实计算，不得冒充生产计算。",
            ))
            uncertainty.append(issue("SANDBOX_DATA", "沙箱响应的生产准确性与完整性未得到保证。"))
        if estimated is None:
            warnings.append(issue("UNKNOWN_CREDIT_COST", "官方静态价格表未确认该端点成本；实际消耗以响应头为准。"))
        return success_envelope(tool, data, meta, warnings=warnings, uncertainty=uncertainty)

    def check_cost(self, tool: str, estimated: Optional[int], sandbox: bool) -> None:
        if sandbox or tool == "provider-usage":
            return
        if not self.config.allow_credit_spend:
            raise ToolError(
                "CREDIT_SPEND_NOT_ALLOWED",
                "live AstroWay 请求可能消耗 credits；需用户授权后用 --allow-credit-spend 或 ASTRO_ALLOW_CREDIT_SPEND=true。",
            )
        if estimated is None and not self.config.allow_unknown_cost:
            raise ToolError(
                "UNKNOWN_COST_NOT_ALLOWED",
                "该端点成本未确认；需明确接受未知成本后用 --allow-unknown-cost 或 ASTRO_ALLOW_UNKNOWN_COST=true。",
            )
        if estimated is not None and self.config.max_credits is not None and estimated > self.config.max_credits:
            raise ToolError(
                "COST_LIMIT_EXCEEDED",
                "预计 %d credits 超过本次上限 %d。" % (estimated, self.config.max_credits),
                details={"estimated_credits": estimated, "max_credits": self.config.max_credits},
            )

    def dispatch(self, tool: str, payload: Dict[str, Any], key: str) -> Tuple[HttpResponse, str]:
        headers = {"X-Api-Key": key}
        if tool == "provider-usage":
            return self.request("GET", "/keys/usage", headers=headers), "/keys/usage"
        body, endpoint = request_body(tool, payload)
        return self.request("POST", endpoint, body=body, headers=headers), endpoint


def chart_request(payload: Dict[str, Any]) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "date": payload["date"],
        "latitude": payload["latitude"],
        "longitude": payload["longitude"],
        "houseSystem": payload.get("house_system", "P"),
        "zodiacType": payload.get("zodiac_type", "tropical"),
    }
    if payload.get("time_unknown"):
        result["timeUnknown"] = True
    else:
        result["time"] = payload["time"]
    if "timezone" in payload:
        result["timezone"] = payload["timezone"]
    if "timezone_offset" in payload:
        result["timezoneOffset"] = payload["timezone_offset"]
    if "timezone" not in payload and "timezone_offset" not in payload:
        result["timezone"] = "auto"
    for source, target in (("name", "name"), ("city", "city"), ("ayanamsa", "ayanamsa")):
        if source in payload and payload[source] is not None:
            result[target] = payload[source]
    return result


def render_options(payload: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    source = payload or {}
    result: Dict[str, Any] = {"format": "json"}
    for snake, camel in (
        ("size", "size"),
        ("theme", "theme"),
        ("show_aspects", "showAspects"),
        ("show_retrograde", "showRetrograde"),
        ("title", "title"),
        ("bodies", "bodies"),
        ("outer_label", "outerLabel"),
        ("cross_aspects", "crossAspects"),
    ):
        if snake in source:
            result[camel] = source[snake]
    return result


def request_body(tool: str, payload: Dict[str, Any]) -> Tuple[Dict[str, Any], str]:
    if tool == "natal-chart":
        return chart_request(payload), "/chart"
    if tool in {"synastry", "composite-chart"}:
        body = {"chart1": chart_request(payload["chart1"]), "chart2": chart_request(payload["chart2"])}
        return body, "/synastry" if tool == "synastry" else "/composite"
    if tool == "transits":
        body = chart_request(payload["natal"])
        body.update({
            "transitDate": payload["transit"]["date"],
            "transitTime": payload["transit"]["time"],
            "transitTzOffset": payload["transit"]["timezone_offset"],
        })
        return body, "/transits"
    if tool == "transit-calendar":
        body: Dict[str, Any] = {
            "natal": chart_request(payload["natal"]),
            "startDate": payload["start_date"],
            "endDate": payload["end_date"],
        }
        for source, target in (("max_orb", "maxOrb"), ("aspect_angles", "aspectAngles"), ("transit_planet_ids", "transitPlanetIds")):
            if source in payload:
                body[target] = payload[source]
        return body, "/transit-calendar"
    if tool == "secondary-progressions":
        body = chart_request(payload["natal"])
        body.update({
            "targetDate": payload["target"]["date"],
            "targetTime": payload["target"]["time"],
            "targetTzOffset": payload["target"]["timezone_offset"],
            "converse": payload["converse"],
        })
        return body, "/progressions"
    if tool == "solar-return":
        body = chart_request(payload["natal"])
        location = payload.get("location", payload["natal"])
        body.update({
            "year": payload["year"],
            "locationLat": location["latitude"],
            "locationLng": location["longitude"],
        })
        return body, "/solar-return"
    if tool == "electional-day":
        return chart_request(payload), "/business/electional-day"
    if tool == "horary-chart":
        return chart_request(payload), "/horary"
    if tool == "horary-diagnostics":
        return chart_request(payload), "/horary/diagnostics"
    if tool == "render-chart":
        kind = payload["kind"]
        if kind == "western":
            body = chart_request(payload["chart"])
            body["options"] = render_options(payload.get("options"))
            return body, "/render/wheel-western"
        if kind == "bi-wheel":
            return {
                "natal": chart_request(payload["natal"]),
                "outer": chart_request(payload["outer"]),
                "options": render_options(payload.get("options")),
            }, "/render/bi-wheel"
        return {
            "chart1": chart_request(payload["chart1"]),
            "chart2": chart_request(payload["chart2"]),
            "options": render_options(payload.get("options")),
        }, "/render/composite"
    raise ToolError("UNSUPPORTED_CAPABILITY", "AstroWay 未实现工具：%s" % tool)


def provider_data(payload: Any) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        raise ToolError("PROVIDER_RESPONSE_ERROR", "AstroWay 响应不是 JSON 对象。", retryable=True)
    if payload.get("ok") is not True:
        error = payload.get("error") if isinstance(payload.get("error"), dict) else {}
        code = str(error.get("code", "PROVIDER_ERROR"))
        retryable = code in {"RATE_LIMIT", "PROVIDER_UNAVAILABLE", "TIMEOUT"}
        raise ToolError(
            code,
            str(error.get("message", "AstroWay 返回失败状态。"))[:500],
            retryable=retryable,
            details=error.get("details"),
        )
    data = payload.get("data")
    if not isinstance(data, dict):
        raise ToolError("PROVIDER_RESPONSE_ERROR", "AstroWay 成功响应缺少对象 data。", retryable=True)
    return data


def normalize_response(tool: str, raw: Dict[str, Any]) -> Dict[str, Any]:
    if tool == "natal-chart":
        return astroway_chart(raw, "natal")
    if tool == "synastry":
        return synastry(raw)
    if tool == "composite-chart":
        return astroway_chart(raw, "composite")
    if tool == "transits":
        return astroway_chart(raw, "transits")
    if tool == "secondary-progressions":
        return astroway_chart(raw, "secondary-progressions")
    if tool == "solar-return":
        return astroway_chart(raw, "solar-return")
    if tool == "horary-chart":
        return horary(raw)
    return object_data(raw)
