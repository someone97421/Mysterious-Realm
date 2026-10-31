"""结构化工具错误。"""

from typing import Any, Optional


EXIT_CODES = {
    "INVALID_INPUT": 2,
    "INVALID_JSON": 2,
    "UNKNOWN_TOOL": 2,
    "CONFIGURATION_ERROR": 3,
    "MISSING_API_KEY": 3,
    "CREDIT_SPEND_NOT_ALLOWED": 6,
    "COST_LIMIT_EXCEEDED": 6,
    "UNKNOWN_COST_NOT_ALLOWED": 6,
    "UNSUPPORTED_CAPABILITY": 5,
    "CACHE_MISS_OFFLINE": 7,
}


class ToolError(Exception):
    """可安全序列化为统一错误包络的异常。"""

    def __init__(
        self,
        code: str,
        message: str,
        retryable: bool = False,
        details: Optional[Any] = None,
        exit_code: Optional[int] = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.details = details
        self.exit_code = exit_code if exit_code is not None else EXIT_CODES.get(code, 4)

    def as_dict(self) -> dict:
        result = {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
        }
        if self.details is not None:
            result["details"] = self.details
        return result
