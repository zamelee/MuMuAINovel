"""LLM 通信日志 — 发送/接收双向记录

像万用表探针一样，只"测量"不"干预"。
- log_prompt()  → backend/logs/llm_send.log
- log_response() → backend/logs/llm_recv.log
"""

import logging
from logging.handlers import RotatingFileHandler
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
MAX_BYTES = 2 * 1024 * 1024  # 2 MB
BACKUP_COUNT = 5
TRUNCATE_LENGTH = 8000

# 中国时区
CST = timezone(timedelta(hours=8))

# ── 发送日志 ──
_send_logger: Optional[logging.Logger] = None


def _get_send_logger() -> logging.Logger:
    global _send_logger
    if _send_logger is not None:
        return _send_logger

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    _send_logger = logging.getLogger("llm_send")
    _send_logger.setLevel(logging.INFO)
    _send_logger.propagate = False

    handler = RotatingFileHandler(
        filename=LOG_DIR / "llm_send.log",
        maxBytes=MAX_BYTES,
        backupCount=BACKUP_COUNT,
        encoding="utf-8",
    )
    handler.setFormatter(logging.Formatter("%(message)s"))
    _send_logger.addHandler(handler)
    return _send_logger


# ── 接收日志 ──
_recv_logger: Optional[logging.Logger] = None


def _get_recv_logger() -> logging.Logger:
    global _recv_logger
    if _recv_logger is not None:
        return _recv_logger

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    _recv_logger = logging.getLogger("llm_recv")
    _recv_logger.setLevel(logging.INFO)
    _recv_logger.propagate = False

    handler = RotatingFileHandler(
        filename=LOG_DIR / "llm_recv.log",
        maxBytes=MAX_BYTES,
        backupCount=BACKUP_COUNT,
        encoding="utf-8",
    )
    handler.setFormatter(logging.Formatter("%(message)s"))
    _recv_logger.addHandler(handler)
    return _recv_logger


def _truncate(text: str, max_len: int = TRUNCATE_LENGTH) -> str:
    """超长截断，标注原长度"""
    if len(text) <= max_len:
        return text
    return f"{text[:max_len]}\n[已截断，原长度: {len(text)}]"


def _now() -> str:
    return datetime.now(CST).strftime("%Y-%m-%d %H:%M:%S")


def log_prompt(context: str, system_prompt: Optional[str], user_prompt: str) -> None:
    """记录发送给 LLM 的完整 prompt"""
    parts = [f"═══════ {_now()} [{context}] ═══════"]

    if system_prompt:
        parts.append(f"System: {_truncate(system_prompt)}")
        parts.append("─" * 40)

    parts.append(f"User: {_truncate(user_prompt)}")
    parts.append("═" * 42)
    parts.append("")  # 空行分隔

    _get_send_logger().info("\n".join(parts))


def log_response(
    context: str,
    content: str,
    finish_reason: Optional[str],
    prompt_tokens: Optional[int],
    completion_tokens: Optional[int],
    total_tokens: Optional[int],
) -> None:
    """记录 LLM 返回的完整响应"""
    token_info = (
        f"prompt={prompt_tokens or '?'} "
        f"completion={completion_tokens or '?'} "
        f"total={total_tokens or '?'}"
    )

    parts = [
        f"═══════ {_now()} [{context}] ═══════",
        f"内容: {_truncate(content)}",
        "─" * 40,
        f"结束原因: {finish_reason or '未知'} | Token: {token_info}",
        "═" * 42,
        "",
    ]

    _get_recv_logger().info("\n".join(parts))
