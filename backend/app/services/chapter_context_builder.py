# -*- coding: utf-8 -*-
"""
ChapterContextBuilder - Batch 4 (Z.2) P2 全局数据统筹

替代 backend/app/api/chapters.py 散落的 4-5 处 SQL/append, 统一管理
prompt 拼装时的所有上一章相关上下文注入. 按 P0/P1/P2 优先级排序,
硬约束在前, 参考在后.
"""
import asyncio
import logging
from typing import List, Optional, Any, Dict

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

    async def build_previous_context(self, chapter, db, memory_service):
        parts = []
        prev_chapter = await self._get_previous_chapter(db, chapter)
        if not prev_chapter:
            return parts
        parts.extend(await self._build_p0(db, chapter, prev_chapter))
        parts.extend(await self._build_p1(db, chapter, prev_chapter, memory_service))
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

    async def _build_p0(self, db, chapter, prev_chapter):
        parts = []
        prev_state = None
        if self.DEFAULT_ENABLED["scene_state"]:
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
        if self.DEFAULT_ENABLED["outline_pruning_warning"] and prev_state:
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
        if self.DEFAULT_ENABLED["foreshadow_logger_only"]:
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

    async def _build_p1(self, db, chapter, prev_chapter, memory_service):
        parts = []
        if self.DEFAULT_ENABLED["prev_content_tail"]:
            try:
                prev_content = prev_chapter.content or ""
                if prev_content:
                    tail = prev_content[-500:] if len(prev_content) > 500 else prev_content
                    parts.append("上一章最后 500 字:\\n" + tail)
            except Exception as e:
                logger.warning("[builder] P1 prev_content tail failed: " + str(e))
        if self.DEFAULT_ENABLED["prev_end_anchor"]:
            try:
                prev_end_anchor = getattr(prev_chapter, "end_anchor", None)
                if prev_end_anchor:
                    parts.append("上一章结束锚点:\\n" + prev_end_anchor)
            except Exception as e:
                logger.warning("[builder] P1 prev_end_anchor failed: " + str(e))
        if self.DEFAULT_ENABLED["prev_summary"]:
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
        if self.DEFAULT_ENABLED["recent_chapters"]:
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
