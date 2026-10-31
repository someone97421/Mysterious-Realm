"""由应用管理设置构造的单次调用配置。"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


@dataclass
class Config:
    provider: str
    allow_credit_spend: bool
    allow_unknown_cost: bool
    max_credits: Optional[int]
    timeout: float
    cache_enabled: bool
    cache_dir: Path
    api_key: str = field(default="", repr=False)
    service_name: str = field(default="", repr=False)
    cache_ttl: Optional[int] = None
    user_agent: str = "StarveilAstrology/1.0"
    log_level: str = "WARNING"
    mock_fixture: Optional[Path] = None
    offline: bool = False
    refresh: bool = False
    no_cache: bool = False
