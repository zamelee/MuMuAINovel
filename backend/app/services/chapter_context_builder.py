# -*- coding: utf-8 -*-
"""
ChapterContextBuilder - Batch 4 (Z.2) P2 全局数据统筹

替代 backend/app/api/chapters.py 散落的 4-5 处 SQL/append, 统一管理
prompt 拼装时的所有上一章相关上下文注入. 按 P0/P1/P2 优先级排序,
硬约束在前, 参考在后.
"""
import asyncio
import logging
from typing import List, Optional, Any, Dict, Tuple
import time

logger = logging.getLogger(__name__)


class ChapterContextBuilder:
    """Batch 4 (Z.2) P2 全局数据统筹 - 统一 builder"""
    PRIORITY_P0 = "P0"
    PRIORITY_P1 = "P1"
    PRIORITY_P2 = "P2"
    DEFAULT_ENABLED = {
        "scene_state": True,
        "outline_pruning_warning": True,
        "foreshadow_logger_only": True,
        "prev_content_tail": True,
        "prev_end_anchor": True,
        "prev_summary": True,
        "recent_chapters": True,
    }
    # Z.5: 完整字段集 (含未来扩展位, 当前 API 只暴露 DEFAULT_ENABLED 的 key)
    # 未来 emotion_curve / character_state 接入时, 把 key 移到 DEFAULT_ENABLED + 在这里登记即可
    ALL_KNOWN_KEYS: Tuple[str, ...] = (
        "scene_state",
        "outline_pruning_warning",
        "foreshadow_logger_only",
        "prev_content_tail",
        "prev_end_anchor",
        "prev_summary",
        "recent_chapters",
    )
    # Z.5: 缓存 TTL (秒) —— 避免每章都查 DB
    _ENABLED_CACHE_TTL = 60
    # Z.5: 模块级缓存  {user_id: (enabled_dict, cached_at)}
    _enabled_cache: Dict[str, Tuple[Dict[str, bool], float]] = {}

    async def _resolve_enabled(self, db, user_id: Optional[str]) -> Dict[str, bool]:
        """Z.5: 解析当前 chapter context 启用的字段, 带 60s 缓存.

        优先级:
          1) settings.preferences["chapter_context_enabled"] (如果存在)
          2) DEFAULT_ENABLED
        未在 user 设置中出现的 key, 走 DEFAULT_ENABLED 默认值.
        """
        if not user_id:
            return dict(self.DEFAULT_ENABLED)
        now = time.time()
        cached = self._enabled_cache.get(user_id)
        if cached and (now - cached[1]) < self._ENABLED_CACHE_TTL:
            return dict(cached[0])
        enabled = await self._load_enabled_from_settings(db, user_id)
        self._enabled_cache[user_id] = (dict(enabled), now)
        return dict(enabled)

    async def _load_enabled_from_settings(self, db, user_id: str) -> Dict[str, bool]:
        """Z.5: 从 settings.preferences 读取 chapter_context_enabled, 缺失 key 补默认."""
        out: Dict[str, bool] = dict(self.DEFAULT_ENABLED)
        try:
            from app.models.settings import Settings
            from sqlalchemy import select
            result = await db.execute(select(Settings).where(Settings.user_id == user_id))
            settings_obj = result.scalar_one_or_none()
            if settings_obj is None or not settings_obj.preferences:
                return out
            import json
            prefs = json.loads(settings_obj.preferences or '{}')
            stored = prefs.get("chapter_context_enabled")
            if isinstance(stored, dict):
                for k in self.ALL_KNOWN_KEYS:
                    if k in stored and isinstance(stored[k], bool):
                        out[k] = stored[k]
        except Exception as e:
            logger.warning("[builder] load_enabled_from_settings failed, fallback to DEFAULT: " + str(e))
        return out

    def invalidate_enabled_cache(self, user_id: Optional[str] = None) -> None:
        """Z.5: 失效缓存. user_id=None 清空全部. 由 settings API 在 PUT 时调用."""
        if user_id is None:
            self._enabled_cache.clear()
        else:
            self._enabled_cache.pop(user_id, None)

    async def build_previous_context(self, chapter, db, memory_service, user_id: Optional[str] = None):
        parts = []
        prev_chapter = await self._get_previous_chapter(db, chapter)
        if not prev_chapter:
            return parts
        # Z.5: 一次性解析 enabled dict, 透传到 P0/P1
        enabled = await self._resolve_enabled(db, user_id)
        parts.extend(await self._build_p0(db, chapter, prev_chapter, enabled))
        parts.extend(await self._build_p1(db, chapter, prev_chapter, memory_service, enabled))
        return parts

    async def _get_previous_chapter(self, db, chapter):
        from sqlalchemy import select
        from app.models.chapter import Chapter
        if not (chapter.chapter_number and chapter.chapter_number > 1):
            return None
        try:
            prev_q = await db.execute(
                select(Chapter)
                .where(Chapter.project_id == chapter.project_id)
                .where(Chapter.chapter_number == chapter.chapter_number - 1)
                .order_by(Chapter.created_at.desc())
                .limit(1)
            )
            return prev_q.scalar_one_or_none()
        except Exception as e:
            logger.warning("[builder] get_previous_chapter failed: " + str(e))
            return None

    async def _build_p0(self, db, chapter, prev_chapter, enabled: Dict[str, bool]):
        parts = []
        prev_state = None
        if enabled["scene_state"]:
            try:
                from app.services.scene_state_extractor import (
                    get_previous_scene_state, format_scene_state_block,
                )
                prev_state = await get_previous_scene_state(db, prev_chapter.id)
                if prev_state:
                    block = format_scene_state_block(prev_state)
                    if block:
                        parts.append(block)
                        logger.info("[builder] P0 scene_state injected: loc=" + str(prev_state.get("location")))
            except Exception as e:
                logger.warning("[builder] P0 scene_state failed: " + str(e))
        if enabled["outline_pruning_warning"] and prev_state:
            try:
                from sqlalchemy import select
                from app.models.outline import Outline
                from app.services.outline_pruning_agent import outline_pruning_agent
                outline_q = await db.execute(
                    select(Outline).where(Outline.chapter_id == chapter.id)
                )
                outline = outline_q.scalar_one_or_none()
                if outline:
                    outline_dict = {
                        "title": getattr(outline, "title", "") or "",
                        "content": getattr(outline, "content", "") or "",
                        "character_focus": getattr(outline, "character_focus", None),
                        "structure": getattr(outline, "structure", None),
                    }
                    pruning = outline_pruning_agent.detect_conflicts(outline_dict, prev_state)
                    if pruning.get("has_conflicts"):
                        warning_text = pruning.get("warning_text", "")
                        if warning_text:
                            parts.append("[Batch 3 大纲冲突预警]\\n" + warning_text)
                        logger.info("[builder] P0 outline conflicts: count=" + str(pruning.get("conflict_count")))
            except Exception as e:
                logger.warning("[builder] P0 outline_pruning failed: " + str(e))
        if enabled["foreshadow_logger_only"]:
            try:
                from app.services.foreshadow_service import foreshadow_service
                if chapter.chapter_number and chapter.chapter_number >= 1:
                    fs_result = await foreshadow_service.auto_resolve_overdue(
                        db=db,
                        project_id=chapter.project_id,
                        current_chapter=chapter.chapter_number,
                        abandoned_threshold=3,
                        dry_run=True,
                    )
                    suggested = fs_result.get("suggested_resolve", []) or []
                    abandoned = fs_result.get("auto_abandoned", []) or []
                    if suggested or abandoned:
                        logger.info("[builder] P0 foreshadow: " + str(len(suggested)) + " suggested, " + str(len(abandoned)) + " auto-abandoned (dry_run)")
            except Exception as e:
                logger.warning("[builder] P0 foreshadow failed: " + str(e))
        return parts

    async def _build_p1(self, db, chapter, prev_chapter, memory_service, enabled: Dict[str, bool]):
        parts = []
        if enabled["prev_content_tail"]:
            try:
                prev_content = prev_chapter.content or ""
                if prev_content:
                    tail = prev_content[-500:] if len(prev_content) > 500 else prev_content
                    parts.append("上一章最后 500 字:\\n" + tail)
            except Exception as e:
                logger.warning("[builder] P1 prev_content tail failed: " + str(e))
        if enabled["prev_end_anchor"]:
            try:
                prev_end_anchor = getattr(prev_chapter, "end_anchor", None)
                if prev_end_anchor:
                    parts.append("上一章结束锚点:\\n" + prev_end_anchor)
            except Exception as e:
                logger.warning("[builder] P1 prev_end_anchor failed: " + str(e))
        if enabled["prev_summary"]:
            try:
                from sqlalchemy import select
                from app.models.memory import StoryMemory
                sum_q = await db.execute(
                    select(StoryMemory.content)
                    .where(StoryMemory.chapter_id == prev_chapter.id, StoryMemory.memory_type == "chapter_summary")
                    .order_by(StoryMemory.created_at.desc())
                    .limit(1)
                )
                prev_summary = sum_q.scalar_one_or_none()
                if prev_summary:
                    parts.append("上一章摘要:\\n" + prev_summary)
            except Exception as e:
                logger.warning("[builder] P1 prev_summary failed: " + str(e))
        if enabled["recent_chapters"]:
            try:
                from app.services.chapter_context_service import OneToManyContextBuilder
                recent_builder = OneToManyContextBuilder(memory_service=memory_service)
                recent_ctx = await recent_builder._build_recent_chapters_context(
                    chapter=chapter, project_id=chapter.project_id, db=db,
                )
                if recent_ctx:
                    parts.append(recent_ctx)
            except Exception as e:
                logger.warning("[builder] P1 recent_chapters failed: " + str(e))
        return parts


chapter_context_builder = ChapterContextBuilder()


async def _self_test_mock_empty():
    from unittest.mock import AsyncMock, MagicMock
    chapter = MagicMock()
    chapter.id = 100
    chapter.project_id = "proj-1"
    chapter.chapter_number = 1
    db = MagicMock()
    db.execute = AsyncMock()
    parts = await chapter_context_builder.build_previous_context(chapter=chapter, db=db, memory_service=MagicMock())
    assert parts == [], "chapter 1 should return empty list, got: " + str(parts)
    print("  [PASS] chapter 1 no prev -> empty list")
    return True


async def _self_test_mock_chapter2():
    from unittest.mock import AsyncMock, MagicMock
    chapter = MagicMock()
    chapter.id = 100
    chapter.project_id = "proj-1"
    chapter.chapter_number = 2
    db = MagicMock()
    r = MagicMock()
    s = MagicMock()
    s.all.return_value = []
    r.scalars.return_value = s
    r.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=r)
    parts = await chapter_context_builder.build_previous_context(chapter=chapter, db=db, memory_service=MagicMock())
    assert isinstance(parts, list), "must return list"
    print("  [PASS] chapter 2 empty prev -> list, len=" + str(len(parts)))
    return True


async def _self_test_no_db():
    from unittest.mock import AsyncMock, MagicMock
    chapter = MagicMock()
    chapter.id = 100
    chapter.project_id = "proj-1"
    chapter.chapter_number = 2
    db = MagicMock()
    db.execute = AsyncMock(side_effect=Exception("mock db down"))
    parts = await chapter_context_builder.build_previous_context(chapter=chapter, db=db, memory_service=MagicMock())
    assert isinstance(parts, list)
    print("  [PASS] db down -> no crash, list len=" + str(len(parts)))
    return True


async def _self_test_z5_default_no_user():
    """Z.5: 无 user_id 时走 DEFAULT_ENABLED"""
    from unittest.mock import MagicMock
    chapter_context_builder.invalidate_enabled_cache()
    enabled = await chapter_context_builder._resolve_enabled(db=MagicMock(), user_id=None)
    assert enabled == chapter_context_builder.DEFAULT_ENABLED,         "expected DEFAULT_ENABLED copy, got: " + str(enabled)
    assert enabled is not chapter_context_builder.DEFAULT_ENABLED,         "must return a copy, not the original dict"
    print("  [PASS] z5 no user_id -> DEFAULT_ENABLED copy")
    return True


async def _self_test_z5_load_from_settings():
    """Z.5: 从 settings.preferences["chapter_context_enabled"] 读取"""
    from unittest.mock import AsyncMock, MagicMock
    import json

    # 模拟: settings.preferences = JSON 包含 user 自定义的 3 个 key
    prefs_json = json.dumps({
        "chapter_context_enabled": {
            "scene_state": False,           # 关闭
            "outline_pruning_warning": True,  # 开
            "foreshadow_logger_only": True,
            "prev_content_tail": True,
            "prev_end_anchor": False,        # 关闭
            "prev_summary": True,
            "recent_chapters": True,
            "unknown_key": True,             # 未知 key 应被忽略
        }
    }, ensure_ascii=False)

    mock_settings = MagicMock()
    mock_settings.preferences = prefs_json

    r = MagicMock()
    r.scalar_one_or_none.return_value = mock_settings
    db = MagicMock()
    db.execute = AsyncMock(return_value=r)

    chapter_context_builder.invalidate_enabled_cache()
    enabled = await chapter_context_builder._resolve_enabled(db=db, user_id="u-test-1")

    assert enabled["scene_state"] is False, "scene_state 应被关闭, got: " + str(enabled["scene_state"])
    assert enabled["prev_end_anchor"] is False, "prev_end_anchor 应被关闭"
    assert enabled["outline_pruning_warning"] is True, "outline_pruning_warning 应保持 True"
    assert "unknown_key" not in enabled, "未知 key 应被忽略"

    # 第二次调用应走缓存, 不会再次调 db.execute
    db.execute.reset_mock()
    enabled2 = await chapter_context_builder._resolve_enabled(db=db, user_id="u-test-1")
    assert enabled2 == enabled, "cached enabled must equal first call"
    db.execute.assert_not_called()
    print("  [PASS] z5 load from settings + cache hit")
    return True


async def _self_test_z5_invalidate_cache():
    """Z.5: invalidate_enabled_cache 清除缓存"""
    chapter_context_builder._enabled_cache["u-x"] = ({"scene_state": False}, 0.0)
    assert "u-x" in chapter_context_builder._enabled_cache

    chapter_context_builder.invalidate_enabled_cache(user_id="u-x")
    assert "u-x" not in chapter_context_builder._enabled_cache, "user_id 缓存应被清除"

    chapter_context_builder._enabled_cache["u-a"] = ({"a": True}, 0.0)
    chapter_context_builder._enabled_cache["u-b"] = ({"b": True}, 0.0)
    chapter_context_builder.invalidate_enabled_cache()  # 清空全部
    assert len(chapter_context_builder._enabled_cache) == 0, "清空全部应清空所有 user"
    print("  [PASS] z5 invalidate cache (per-user + all)")
    return True


def run_self_tests():
    # HANDOFF v1 兜底: 触发 app.models 完整初始化, 解决循环 import
    try:
        import app.database  # noqa
        import app.models  # noqa
    except Exception:
        pass
    print("[chapter_context_builder] self_tests:")
    print()
    passed = 0
    failed = 0
    tests = [
        ("empty_prev", _self_test_mock_empty),
        ("chapter2_empty", _self_test_mock_chapter2),
        ("no_db", _self_test_no_db),
        ("z5_default_no_user", _self_test_z5_default_no_user),
        ("z5_load_from_settings", _self_test_z5_load_from_settings),
        ("z5_invalidate_cache", _self_test_z5_invalidate_cache),
    ]
    for name, coro_fn in tests:
        try:
            ok = asyncio.run(coro_fn())
            if ok:
                passed += 1
            else:
                failed += 1
        except Exception as e:
            failed += 1
            print("  [FAIL] " + name + ": " + str(e))
    print()
    print("Total: " + str(passed + failed) + ", Passed: " + str(passed) + ", Failed: " + str(failed))
    return failed == 0


if __name__ == "__main__":
    import sys
    ok = run_self_tests()
    sys.exit(0 if ok else 1)
