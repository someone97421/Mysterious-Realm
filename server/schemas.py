import re
from datetime import datetime
from typing import Literal
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


ASTRO_TOOLS = (
    "geocode", "natal-chart", "synastry", "composite-chart", "transits",
    "transit-calendar", "solar-return", "secondary-progressions", "sky-events",
    "sky-event-kinds", "horoscope", "astro-content", "electional-day",
    "horary-chart", "horary-diagnostics",
)


class Input(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


class Login(Input):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)

    @field_validator("password", mode="before")
    @classmethod
    def keep_password(cls, value):
        return value

    model_config = ConfigDict(extra="ignore")


class Setup(Login):
    display_name: str = Field(default="观星者", min_length=1, max_length=64)


class UserCreate(Setup):
    role: Literal["admin", "user"] = "user"
    is_active: bool = True


class UserPatch(BaseModel):
    username: str | None = Field(default=None, min_length=1, max_length=64)
    display_name: str | None = Field(default=None, min_length=1, max_length=64)
    password: str | None = Field(default=None, max_length=256)
    role: Literal["admin", "user"] | None = None
    is_active: bool | None = None


class ModelConfig(Input):
    name: str = Field(min_length=1, max_length=120)
    provider: str = Field(default="custom", max_length=80)
    base_url: str = Field(min_length=1, max_length=2048)
    model_id: str = Field(min_length=1, max_length=200)
    api_key: str = Field(default="", max_length=8192)
    schema_type: Literal["chat_completions", "responses", "anthropic"] = "chat_completions"
    reasoning_effort: str = Field(default="none", min_length=1, max_length=32)
    reasoning_field: str = Field(default="", max_length=128)
    supports_images: bool = False
    context_window: int = Field(default=128000, ge=4096, le=10000000)
    compression_threshold: float = Field(default=0.75, ge=0.3, le=0.95)
    max_output_tokens: int = Field(default=8192, ge=256, le=200000)
    is_default: bool = False
    mode_scope: Literal["both", "tarot", "astrology"] = "both"
    is_default_tarot: bool = False
    is_default_astrology: bool = False

    @field_validator("reasoning_field")
    @classmethod
    def valid_reasoning_field(cls, value):
        if not value:
            return value
        parts = value.split(".")
        reserved = {"model", "messages", "input", "system", "instructions", "stream", "stream_options", "store", "max_tokens", "max_completion_tokens", "max_output_tokens"}
        if parts[0] in reserved or any(not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", part) for part in parts):
            raise ValueError("思考字段需为合法点分路径，不能覆盖模型、消息或输出预算字段")
        return value

    @model_validator(mode="after")
    def custom_reasoning_field(self):
        if self.schema_type == "anthropic" and self.reasoning_effort not in {"none", "low", "medium", "high", "xhigh", "max"} and not self.reasoning_field:
            raise ValueError("Anthropic 自定义推理强度需要填写思考字段路径")
        if self.mode_scope == "tarot" and self.is_default_astrology:
            raise ValueError("仅绑定塔罗的模型不能设为占星默认模型")
        if self.mode_scope == "astrology" and self.is_default_tarot:
            raise ValueError("仅绑定占星的模型不能设为塔罗默认模型")
        return self

    @field_validator("base_url")
    @classmethod
    def valid_url(cls, value):
        parsed = urlparse(value)
        if parsed.scheme not in ("https", "http") or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("接入点需为 http(s) URL，不含账号、查询参数或片段")
        return value.rstrip("/")

    @model_validator(mode="after")
    def token_budget(self):
        if self.max_output_tokens > self.context_window // 2:
            raise ValueError("最大输出长度不能超过上下文窗口的一半")
        if self.schema_type == "anthropic" and self.reasoning_effort != "none" and not self.reasoning_field and self.max_output_tokens < 2048:
            raise ValueError("Anthropic 思考模式需要至少 2048 个输出 Token")
        return self


class ResponseOptions(Input):
    length_mode: Literal["concise", "detailed"] = "detailed"


class ConversationCreate(Input):
    mode: Literal["tarot", "astrology"] = "tarot"


class SendMessage(ResponseOptions):
    content: str = Field(default="", max_length=50000)
    profile_ids: list[str] = Field(default_factory=list, max_length=16)
    image_ids: list[str] = Field(default_factory=list, max_length=4)

    @field_validator("profile_ids", "image_ids")
    @classmethod
    def valid_ids(cls, values):
        if any(not isinstance(value, str) or not value.strip() for value in values):
            raise ValueError("资料或图片 ID 无效")
        if len(set(values)) != len(values):
            raise ValueError("资料或图片 ID 不能重复")
        return values

    @model_validator(mode="after")
    def nonempty(self):
        if not self.content and not self.image_ids:
            raise ValueError("请写下内容，或添加图片")
        return self


class Rename(Input):
    title: str = Field(min_length=1, max_length=120)


class Plan(Input):
    mode: Literal["chat", "draw"]
    opening: str = Field(default="", max_length=2000)
    question: str = Field(default="", max_length=4000)
    spread_name: str = Field(default="", max_length=120)
    positions: list[str] = Field(default_factory=list, max_length=78)
    upright_only: bool = False

    @model_validator(mode="after")
    def draw_fields(self):
        if self.mode == "draw" and (not self.positions or not self.opening or not self.spread_name or not self.question):
            raise ValueError("牌阵缺少必要信息")
        if any(not position.strip() or len(position) > 160 for position in self.positions):
            raise ValueError("牌位描述无效")
        return self


class CardReading(Input):
    card_id: str
    imagery: str = Field(min_length=1)
    symbolism: str = Field(min_length=1)
    interpretation: str = Field(min_length=1)
    advice: str = Field(min_length=1)


class ReadingOverview(Input):
    synthesis: str = Field(min_length=1)
    actions: list[str] = Field(min_length=1, max_length=12)
    closing: str = Field(min_length=1)


class Reading(ReadingOverview):
    cards: list[CardReading] = Field(min_length=1, max_length=78)


class ProfileInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=80)
    avatar: str = Field(default="", max_length=32)
    color: str = Field(default="#9B8AFB")
    birth_date: str | None = Field(default=None)
    birth_time: str | None = Field(default=None)
    time_accuracy: Literal["exact", "approximate", "range", "unknown"] = "unknown"
    time_end: str | None = Field(default=None)
    location_name: str | None = Field(default=None, max_length=160)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    timezone: str | None = Field(default=None, max_length=64)
    notes: str = Field(default="", max_length=5000)

    @field_validator("name")
    @classmethod
    def valid_name(cls, value):
        if not value.strip():
            raise ValueError("姓名不能为空")
        return value

    @field_validator("avatar")
    @classmethod
    def valid_avatar(cls, value):
        if "\n" in value or "\r" in value:
            raise ValueError("头像文本不能包含换行")
        return value

    @field_validator("color")
    @classmethod
    def valid_color(cls, value):
        if not re.fullmatch(r"#[0-9A-Fa-f]{6}", value):
            raise ValueError("颜色必须是 #RRGGBB")
        return value.upper()

    @field_validator("birth_date")
    @classmethod
    def valid_date(cls, value):
        if value is None or value == "":
            return None
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError("出生日期必须是 YYYY-MM-DD")
        try:
            datetime.strptime(value, "%Y-%m-%d")
        except ValueError as exc:
            raise ValueError("出生日期不是有效日期") from exc
        return value

    @field_validator("birth_time", "time_end")
    @classmethod
    def valid_time(cls, value):
        if value is None or value == "":
            return None
        if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
            raise ValueError("时间必须是 HH:MM")
        return value

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value):
        if value is None or value == "":
            return None
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("时区必须是有效的 IANA timezone") from exc
        return value

    @model_validator(mode="after")
    def coherent(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("纬度和经度必须同时填写或同时留空")
        if self.time_accuracy != "unknown" and not self.birth_time:
            raise ValueError("请填写出生时间，或将时间精度设为未知")
        if self.time_accuracy == "range" and not self.time_end:
            raise ValueError("时间范围需要填写开始和结束时间")
        if self.time_accuracy == "unknown" and (self.birth_time or self.time_end):
            raise ValueError("时间未知时不能填写出生时间或结束时间")
        if self.time_accuracy != "range" and self.time_end:
            raise ValueError("结束时间仅适用于 range")
        if self.time_accuracy == "range" and self.birth_time and self.time_end and self.time_end < self.birth_time:
            raise ValueError("结束时间不能早于开始时间")
        return self


class ProfilePatch(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=80)
    avatar: str | None = Field(default=None, max_length=32)
    color: str | None = None
    birth_date: str | None = None
    birth_time: str | None = None
    time_accuracy: Literal["exact", "approximate", "range", "unknown"] | None = None
    time_end: str | None = None
    location_name: str | None = Field(default=None, max_length=160)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    timezone: str | None = Field(default=None, max_length=64)
    notes: str | None = Field(default=None, max_length=5000)

    @field_validator("name")
    @classmethod
    def valid_name(cls, value):
        if value is not None and not value.strip():
            raise ValueError("姓名不能为空")
        return value

    @field_validator("avatar")
    @classmethod
    def valid_avatar(cls, value):
        if value is not None and ("\n" in value or "\r" in value):
            raise ValueError("头像文本不能包含换行")
        return value

    @field_validator("color")
    @classmethod
    def valid_color(cls, value):
        if value is not None and not re.fullmatch(r"#[0-9A-Fa-f]{6}", value):
            raise ValueError("颜色必须是 #RRGGBB")
        return value.upper() if value else value

    @field_validator("birth_date")
    @classmethod
    def valid_date(cls, value):
        if value is None or value == "":
            return None
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError("出生日期必须是 YYYY-MM-DD")
        try:
            datetime.strptime(value, "%Y-%m-%d")
        except ValueError as exc:
            raise ValueError("出生日期不是有效日期") from exc
        return value

    @field_validator("birth_time", "time_end")
    @classmethod
    def valid_time(cls, value):
        if value is None or value == "":
            return None
        if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
            raise ValueError("时间必须是 HH:MM")
        return value

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value):
        if value is None or value == "":
            return None
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("时区必须是有效的 IANA timezone") from exc
        return value


ProfileCreate = ProfileInput
ProfileUpdate = ProfilePatch


class AstrologyServiceInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=120)
    provider: Literal["cosmyday", "astroway"]
    enabled: bool = True
    priority: int = Field(default=100, ge=0, le=1000000)
    api_key: str | None = Field(default=None, max_length=8192)
    clear_api_key: bool = False

    @field_validator("name")
    @classmethod
    def valid_service_name(cls, value):
        if not value.strip():
            raise ValueError("服务名称不能为空")
        return value


class AstrologySettingsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    provider: Literal["auto", "cosmyday", "astroway"] | None = None
    allow_credit_spend: bool = False
    allow_unknown_cost: bool = False
    max_credits: int | None = Field(default=100, ge=0, le=1000000)
    timeout: float = Field(default=30, gt=0, le=3600)
    cache_enabled: bool = True
    enabled_tools: list[str] = Field(default_factory=lambda: list(ASTRO_TOOLS), max_length=len(ASTRO_TOOLS))
    api_key: str | None = Field(default=None, max_length=8192)
    clear_api_key: bool = False

    @field_validator("enabled_tools")
    @classmethod
    def valid_tools(cls, values):
        unknown = sorted(set(values) - set(ASTRO_TOOLS))
        if unknown:
            raise ValueError("enabled_tools 包含不支持的工具")
        if len(set(values)) != len(values):
            raise ValueError("enabled_tools 不能重复")
        return values
