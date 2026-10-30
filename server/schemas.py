from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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
    reasoning_effort: Literal["none", "low", "medium", "high", "xhigh"] = "none"
    supports_images: bool = False
    context_window: int = Field(default=128000, ge=4096, le=10000000)
    compression_threshold: float = Field(default=0.75, ge=0.3, le=0.95)
    max_output_tokens: int = Field(default=8192, ge=256, le=200000)
    is_default: bool = False

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
        if self.schema_type == "anthropic" and self.reasoning_effort != "none" and self.max_output_tokens < 2048:
            raise ValueError("Anthropic 思考模式需要至少 2048 个输出 Token")
        return self


class SendMessage(Input):
    content: str = Field(default="", max_length=50000)
    image_ids: list[str] = Field(default_factory=list, max_length=4)

    @model_validator(mode="after")
    def nonempty(self):
        if not self.content and not self.image_ids:
            raise ValueError("请写下祈求，或添加图片")
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
