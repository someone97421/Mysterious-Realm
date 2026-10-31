"""面向用户的错误反馈与不含参数、密钥的诊断记录。"""

import logging
import sqlite3
import traceback
from pathlib import Path

from pydantic import ValidationError


class AgentFailure(Exception):
    def __init__(self, message, code="ACTION_ERROR", retryable=True):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


def describe_error(error):
    if isinstance(error, AgentFailure):
        return error.code, str(error)
    if isinstance(error, ValidationError):
        return "RESULT_FORMAT", "解读的结构还不完整，需要重新整理。"
    if isinstance(error, sqlite3.Error):
        return "STORAGE_ERROR", "资料保存暂时失败，正在重新连接存储。"
    return "INTERNAL_ERROR", "整理星象时遇到处理错误，正在尝试恢复。"


def diagnostic(error, stage):
    frames = traceback.extract_tb(error.__traceback__)
    location = " > ".join(f"{Path(frame.filename).name}:{frame.lineno}:{frame.name}" for frame in frames[-5:])
    logging.getLogger("starveil.agent").warning("stage=%s type=%s location=%s", stage, type(error).__name__, location)
