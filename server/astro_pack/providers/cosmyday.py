"""CosmyDay 免费公开 API 适配器。"""

from typing import Any, Dict, Tuple
from urllib.parse import quote

from .base import BaseProvider, calculation_parameters
from ..shared.normalize import cosmyday_chart, object_data
from ..shared.protocol import success_envelope, tool_catalog


class CosmyDayProvider(BaseProvider):
    name = "cosmyday"
    base_url = "https://api.cosmyday.com"
    documentation = "https://cosmyday.com/api-docs"

    def can_handle(self, tool: str, payload: Dict[str, Any]) -> bool:
        if tool not in tool_catalog() or self.name not in tool_catalog()[tool]["providers"]:
            return False
        if tool != "natal-chart":
            return True
        year = int(payload["date"][:4])
        seconds = payload.get("time", "00:00:00")
        minute_precision = len(seconds) == 5 or seconds.endswith(":00")
        return (
            1900 <= year <= 2100
            and not payload.get("time_unknown", False)
            and payload.get("house_system", "P") == "P"
            and payload.get("zodiac_type", "tropical") == "tropical"
            and payload.get("ayanamsa") is None
            and "timezone_offset" not in payload
            and "timezone" not in payload
            and minute_precision
        )

    def execute(self, tool: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not self.can_handle(tool, payload):
            raise_unsupported(tool)
        specification = tool_catalog()[tool]
        kind = specification["data_kind"]
        calculation = calculation_parameters(payload)
        if tool == "geocode":
            response = self.request("GET", "/search-location", query={"q": payload["query"]})
            data = object_data(response.payload)
            endpoint = "/search-location"
        elif tool == "natal-chart":
            body = natal_request(payload)
            response = self.request("POST", "/natal", body=body)
            if not isinstance(response.payload, dict):
                from ..shared.errors import ToolError
                raise ToolError("PROVIDER_RESPONSE_ERROR", "CosmyDay 本命盘响应不是对象。", retryable=True)
            data = cosmyday_chart(response.payload)
            calculation["house_system"] = data["houses"]["system"]
            calculation["zodiac_type"] = "tropical"
            calculation["timezone_mode"] = "coordinates_auto"
            endpoint = "/natal"
        elif tool == "sky-events":
            response = self.request("GET", "/events/upcoming", query=payload)
            data = object_data(response.payload)
            calculation["event_time_basis"] = "US Eastern Time (provider documentation)"
            endpoint = "/events/upcoming"
        elif tool == "sky-event-kinds":
            response = self.request("GET", "/events/kinds")
            data = object_data(response.payload)
            endpoint = "/events/kinds"
        elif tool == "horoscope":
            period = payload["period"]
            sign = payload.get("sign")
            if "month" in payload:
                endpoint = "/content/monthly-archive/%s/%s" % (quote(sign, safe=""), quote(payload["month"], safe=""))
            else:
                endpoint = "/content/" + period
                if sign:
                    endpoint += "/" + quote(sign, safe="")
            response = self.request("GET", endpoint)
            data = object_data(response.payload)
            calculation = {"period": period, "content_scope": "sign" if sign else "all_signs"}
        elif tool == "astro-content":
            endpoint = "/content/" + payload["topic"]
            response = self.request("GET", endpoint)
            data = object_data(response.payload)
            calculation = {"topic": payload["topic"]}
        else:
            raise_unsupported(tool)
        meta = self.meta(endpoint, kind, calculation, response.headers)
        return success_envelope(tool, data, meta)


def natal_request(payload: Dict[str, Any]) -> Dict[str, Any]:
    year, month, day = (int(part) for part in payload["date"].split("-"))
    time_parts = [int(part) for part in payload["time"].split(":")]
    return {
        "year": year,
        "month": month,
        "day": day,
        "hour": time_parts[0],
        "minute": time_parts[1],
        "lat": payload["latitude"],
        "lon": payload["longitude"],
    }


def raise_unsupported(tool: str) -> None:
    from ..shared.errors import ToolError
    raise ToolError(
        "UNSUPPORTED_CAPABILITY",
        "CosmyDay 无法在不丢失参数的情况下执行 %s；请使用 auto 或 astroway。" % tool,
    )
