# -*- coding: utf-8 -*-
"""
SceneStateExtractor - 规则式章节场景状态提取器
输入: chapter.content (str) + 角色名列表
输出: dict { location, characters_present, characters_left, characters_entered,
                items, knowledge_states, confidence }
不调 LLM, 纯正则匹配中文叙述模式
"""

import re
from collections import Counter
from typing import List, Dict, Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.logger import get_logger

logger = get_logger(__name__)


# 角色离开的中文叙述模式 (raw string, 避免 \\s 警告)
EXIT_PATTERNS = [
    # 仅匹配明确含离开动词的"起身"动作, 避免 "宋知意没有起身" 这类中性词被误判
    r"{name}[\s\S]*?(?:起身离开|起身告辞|起身走了|起身辞别|缓?缓站起离开|缓?缓起身离开)",
    r"{name}[\s\S]*?(?:离开|走出|离去|告辞|辞别|退出|退场|转身离开|起身走了|起身告辞|推门离开)",
    r"{name}[\s\S]*?(?:拉开车门|关上门|关上车门|推门而出|头也不回)",
    r"(?:告别|道别|辞别)[\s\S]*?后?[\s\S]*?.{0,4}{name}[\s\S]*?(?:离开|走了|离去)",
    r"{name}[\s\S]*?(?:独自|一个人)?[\s\S]*?走[\s\S]*?了",
]

# 角色进入的中文叙述模式
ENTER_PATTERNS = [
    r"{name}[\s\S]*?(?:推门|推门而入|推门进来|推门进入|推门走进|推门而进)",
    r"{name}[\s\S]*?(?:走进|走进来|步入|踏入|进入|进来|到场|登场|出现在)",
    r"{name}[\s\S]*?(?:终于|终于)?[\s\S]*?到[\s\S]*?了",
    r"(?:门|包厢|房门)[\s\S]*?(?:被|由)?.{0,3}(?:推开|打开).{0,8}{name}",
    r"{name}[\s\S]*?(?:从|自|由).{0,8}(?:外|门外|门口|走廊|楼梯)[\s\S]*?(?:走进|进来|进入|出现)",
]

# 地点叙述模式
LOCATION_PATTERNS = [
    r"(?:场景|画面|故事)[\s\S]*?(?:在|发生于|发生|转?到|转到)[\s\S]*?([^,，。；;\n\r]{2,15})",
    # 地点前缀只取 0-6 字符, 避免 "宋知意安静地坐在 CBD 高档餐厅" 这类人名+动词污染
    r"([^,，。；;\n\r]{0,6})(?:包厢|咖啡厅|餐厅|办公室|会议室|酒店|公寓|房间|书房|客厅|卧室|阳台|走廊|楼梯|天台|公园|街道|酒吧|KTV|医院|学校|教室|图书馆|车内|车里|车后座)",
    # "会议室里" / "餐厅里" / "咖啡厅中" 之类在前的地点 (里/内/中 是后置方位词)
    r"(包厢|咖啡厅|餐厅|办公室|会议室|酒店|公寓|房间|书房|客厅|卧室|阳台|走廊|楼梯|天台|公园|街道|酒吧|KTV|医院|学校|教室|图书馆|车)(?:里|内|中|里面|之中)",
    # "在 地点 上/里/内/旁" -- 非贪婪匹配短地点
    r"在[\s\S]*?([^,，。；;\n\r]{2,8}?)(?:上|里|下|旁|内|中)[\s\S]*?[,，。；;]",
    # "在 地点 里/内" -- 备选
    r"在[\s\S]*?([^,，。；;\n\r]{2,15})[\s\S]*?(?:里|内|中|里面|之中)[\s\S]*?[,，。；;]",
    # 直接单关键词 + 后续边界, group(1) 包含关键词 + 0-4 字符前缀
    r"([^,，。；;\n\r]{0,4}(?:包厢|咖啡厅|餐厅|办公室|会议室|酒店|公寓|房间|书房|客厅|卧室|阳台|走廊|楼梯|天台|公园|街道|酒吧|KTV|医院|学校|教室|图书馆|车))(?=[，。；\s]|$)",
]

# 物品状态模式
ITEM_PATTERNS = [
    r"({item})[\s\S]*?(?:被|已经|已经)?[\s\S]*?(?:打碎|摔碎|破碎|毁了|烧了|丢失|不见了|消失)",
    r"({item})[\s\S]*?(?:完整|完好|还在|尚在|仍然|依然)",
]

CONFIDENCE_VERSION = "v1"


def _split_paragraphs(text: str) -> List[str]:
    """按段落切分 (按 \n)"""
    paragraphs = re.split(r"\n+", text)
    return [p.strip() for p in paragraphs if p.strip()]


def _find_all_matches(name: str, patterns: List[str], text: str) -> List[Dict[str, Any]]:
    """找 name + pattern 在 text 中所有匹配位置.
    关键修复: 每个段落单独 search, 避免 [\s\S]*? 跨段落匹配.
    用 str.replace 做占位符替换 (避开 str.format 把 {0,3} 当位置参数的坑)."""
    results = []
    paragraphs = _split_paragraphs(text)
    if not paragraphs:
        return results
    # 计算每段在原文中的起始 offset
    offsets = []
    pos = 0
    for para in text.split(chr(10)):
        stripped = para.strip()
        if stripped:
            offsets.append((pos, pos + len(para)))
        pos += len(para) + 1  # +1 for chr(10)
    for para_idx, (start, end) in enumerate(offsets):
        para_text = text[start:end]
        for p in patterns:
            final_pattern = p.replace(chr(123) + "name" + chr(125), re.escape(name))
            compiled = re.compile(final_pattern)
            for mm in compiled.finditer(para_text):
                abs_start = start + mm.start()
                abs_end = start + mm.end()
                results.append({"match": mm.group(0), "para_index": para_idx, "span": (abs_start, abs_end)})
    results.sort(key=lambda x: x["span"][0])
    return results


def extract_scene_state(
    chapter_content: str,
    character_names: List[str],
    project_items: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    主入口: 从章节正文提取场景状态.

    Args:
        chapter_content: 章节全文
        character_names: 项目所有角色名 (用于匹配)
        project_items: 项目关键物品列表 (可选)

    Returns:
        dict: { location, characters_present, characters_left, characters_entered,
                items, knowledge_states, confidence }
    """
    if not chapter_content or not chapter_content.strip():
        return _empty_state()

    total_paras = len(_split_paragraphs(chapter_content))
    if total_paras == 0:
        return _empty_state()

    # 1) 提取 location
    location = _extract_location(chapter_content)

    # 2) 每个角色的 enter / leave / last_seen
    char_enter = {}
    char_leave = {}
    char_last_seen = {}

    for name in character_names:
        if not name or len(name) < 2:
            continue
        if name in ("自己", "对方", "众人", "大家", "那人", "此人", "他", "她", "它"):
            continue

        enters = _find_all_matches(name, ENTER_PATTERNS, chapter_content)
        leaves = _find_all_matches(name, EXIT_PATTERNS, chapter_content)

        if enters:
            first = enters[0]
            char_enter[name] = {"para_index": first["para_index"], "method": first["match"][:30]}
        if leaves:
            last = leaves[-1]
            char_leave[name] = {"para_index": last["para_index"], "last_action": last["match"][:30]}

        # 最后一次出现段落
        all_occurrences = [m.start() for m in re.finditer(re.escape(name), chapter_content)]
        if all_occurrences:
            char_last_seen[name] = chapter_content[:all_occurrences[-1]].count(chr(10))

    # 3) 推导最终在场列表
    characters_present = []
    characters_left = []
    characters_entered = []

    for name in char_last_seen:
        if name in char_leave:
            leave = char_leave[name]
            characters_left.append({
                "name": name,
                "last_action": leave["last_action"],
                "last_seen_para": leave["para_index"],
            })
        else:
            characters_present.append({
                "name": name,
                "last_seen_para": char_last_seen[name],
            })
        if name in char_enter:
            enter = char_enter[name]
            if enter["para_index"] > 0:
                characters_entered.append({
                    "name": name,
                    "enter_method": enter["method"],
                    "first_seen_para": enter["para_index"],
                })

    # 4) 物品状态
    items = []
    if project_items:
        for item in project_items:
            if not item or len(item) < 2:
                continue
            for p in ITEM_PATTERNS:
                m = re.search(p.format(item=re.escape(item)), chapter_content)
                if m:
                    items.append({"name": item, "state": m.group(0)[:30]})
                    break

    # 5) 知识状态 (Batch 2 先不实现)
    knowledge_states = []

    # 6) confidence: 命中的角色数 / 总角色数
    matched = len(char_last_seen)
    total = max(1, len([n for n in character_names if n and len(n) >= 2]))
    confidence = round(min(1.0, matched / total * 0.8 + 0.2), 2)

    return {
        "location": location,
        "characters_present": characters_present,
        "characters_left": characters_left,
        "characters_entered": characters_entered,
        "items": items,
        "knowledge_states": knowledge_states,
        "confidence": confidence,
    }


def _extract_location(text: str) -> Optional[str]:
    """提取最可能的场景地点.
    优先级: 1) 含地点关键词(包厢/餐厅/...)的; 2) 否则取最短的.
    这样避免 "宋知意安静地坐在 CBD 高档餐厅" 这类长串被当作 location."""
    candidates = []
    for p in LOCATION_PATTERNS:
        for m in re.finditer(p, text):
            try:
                g = m.group(1)
            except IndexError:
                continue
            if g and 2 <= len(g) <= 30:
                candidates.append(g.strip())
    if not candidates:
        return None
    # 优先: 含地点关键词
    loc_keywords = [
        "包厢", "咖啡厅", "餐厅", "办公室", "会议室", "酒店", "公寓", "房间", "书房", "客厅",
        "卧室", "阳台", "走廊", "楼梯", "天台", "公园", "街道", "酒吧", "KTV", "医院",
        "学校", "教室", "图书馆", "车",
    ]
    # 排除: 家具/部位/无关名词 (避免 "在沙发上" 误判 location=沙发)
    exclude_keywords = [
        "沙发", "床", "椅子", "桌", "柜", "窗户", "门帘", "地毯", "垫子", "扶手",
        "小径", "道路", "地上", "天上", "墙上", "门上", "窗外", "楼上", "楼下",
        "玻璃", "门框", "门槛",
        # 动词/助词结尾 (避免 "李明走进" 误判)
        "走进", "走出", "看着", "坐着", "站着", "站在", "坐在", "回到", "去了", "来了",
        "来到", "到了", "进了", "上了", "下了",
        # 代词/常见主语
        "他", "她", "它", "我", "你", "我们", "他们", "她们",
    ]
    # 排除前缀以这些字符结尾的候选 (常见动词/介词/代词后缀)
    bad_endings = [
        "走", "看", "坐", "站", "回", "来", "去", "到", "进", "出", "上", "下",
        "的", "了", "着", "过", "和", "与", "或", "把", "被", "给", "让", "叫",
    ]
    def _trim(s: str) -> str:
        """去掉尾部常见的方位词 (里/内/中/里面/之中) 和空白"""
        for suffix in ["里面", "之中", "之内", "里", "内", "中"]:
            if s.endswith(suffix) and len(s) > len(suffix):
                s = s[:-len(suffix)]
                break
        return s.strip()
    # 评分函数: 含关键词 +1, 长度越短越好 (避免 "宋知意独自站在" 这类人名+动词污染)
    def _score(c: str) -> tuple:
        has_kw = any(k in c for k in loc_keywords)
        has_excl = any(k in c for k in exclude_keywords)
        bad_end = c[-1] in bad_endings if c else False
        # 长度偏好: 3-12 字符最像中文地点 (CBD 高档 = 4, 高档餐厅包厢 = 6, 包厢 = 2, 公园 = 2)
        L = len(c)
        if has_kw and not has_excl and not bad_end:
            if 2 <= L <= 12:
                return (0, L)
            else:
                return (1, L)
        elif has_kw and not has_excl and bad_end:
            return (2, L)
        elif has_kw and has_excl:
            return (3, L)
        else:
            return (4, L)
    # 过滤: 必须含 loc_keywords, 排除 exclude_keywords / bad_endings 结尾
    filtered = [
        c for c in candidates
        if any(k in c for k in loc_keywords)
        and not any(k in c for k in exclude_keywords)
        and (not c or c[-1] not in bad_endings)
    ]
    if not filtered:
        return None
    best = min(filtered, key=_score)
    return _trim(best) if best else None


def _empty_state() -> Dict[str, Any]:
    return {
        "location": None,
        "characters_present": [],
        "characters_left": [],
        "characters_entered": [],
        "items": [],
        "knowledge_states": [],
        "confidence": 0.0,
    }




# ====================================================================
# Batch 2 补充: 与 DB 交互 / Prompt 注入相关的辅助函数
# ====================================================================

async def save_scene_state(
    db: AsyncSession,
    chapter_id: str,
    project_id: str,
    chapter_number: int,
    chapter_content: str,
    character_names=None,
    project_items=None,
) -> dict:
    """
    在调用方提供的 db session 中保存/更新章节场景状态.

    设计要点:
    - 不抛错, 失败仅 logger.warning (避免阻塞生成主流程)
    - 如果未传 character_names, 内部自动从 Character 表查
    - upsert 语义: 同一 chapter_id 重复写只更新
    - 返回 state dict (供调用方日志/调试)
    """
    from app.models.memory import ChapterSceneState
    from app.models.character import Character

    try:
        if not character_names:
            try:
                cn_result = await db.execute(
                    select(Character.name).where(Character.project_id == project_id)
                )
                character_names = [r[0] for r in cn_result.all() if r and r[0]]
            except Exception as cn_e:
                logger.warning("scene_state: 查角色名失败, 用空列表: " + str(cn_e))
                character_names = []

        state = extract_scene_state(chapter_content, character_names, project_items)

        existing_result = await db.execute(
            select(ChapterSceneState).where(ChapterSceneState.chapter_id == chapter_id)
        )
        row = existing_result.scalar_one_or_none()

        if row is not None:
            row.location = state["location"]
            row.characters_present = state["characters_present"]
            row.characters_left = state["characters_left"]
            row.characters_entered = state["characters_entered"]
            row.items = state["items"]
            row.knowledge_states = state["knowledge_states"]
            row.confidence = state["confidence"]
            row.extractor_version = CONFIDENCE_VERSION
        else:
            row = ChapterSceneState(
                chapter_id=chapter_id,
                project_id=project_id,
                chapter_number=chapter_number,
                location=state["location"],
                characters_present=state["characters_present"],
                characters_left=state["characters_left"],
                characters_entered=state["characters_entered"],
                items=state["items"],
                knowledge_states=state["knowledge_states"],
                confidence=state["confidence"],
                extractor_version=CONFIDENCE_VERSION,
            )
            db.add(row)

        await db.commit()
        logger.info(
            "scene_state: ch=" + str(chapter_id) + "#ch" + str(chapter_number)
            + " loc=" + str(state["location"])
            + " present=" + str(len(state["characters_present"]))
            + " left=" + str(len(state["characters_left"]))
            + " confidence=" + str(state["confidence"])
        )
        return state
    except Exception as e:
        try:
            await db.rollback()
        except Exception:
            pass
        logger.warning("scene_state: 保存失败 ch=" + str(chapter_id) + ": " + str(e))
        return {
            "location": None,
            "characters_present": [],
            "characters_left": [],
            "characters_entered": [],
            "items": [],
            "knowledge_states": [],
            "confidence": 0.0,
        }


async def get_previous_scene_state(
    db: AsyncSession, chapter_id: str
):
    """按 chapter_id 取一条场景状态. 找不到返回 None."""
    from app.models.memory import ChapterSceneState
    try:
        result = await db.execute(
            select(ChapterSceneState).where(ChapterSceneState.chapter_id == chapter_id)
        )
        row = result.scalar_one_or_none()
        if not row:
            return None
        return {
            "location": row.location,
            "characters_present": row.characters_present or [],
            "characters_left": row.characters_left or [],
            "characters_entered": row.characters_entered or [],
            "items": row.items or [],
            "knowledge_states": row.knowledge_states or [],
            "confidence": row.confidence or 0.0,
            "chapter_number": row.chapter_number,
        }
    except Exception as e:
        logger.warning("get_previous_scene_state: 查询失败 ch=" + str(chapter_id) + ": " + str(e))
        return None


def format_scene_state_block(state) -> str:
    """
    把场景状态 dict 渲染成结构化文本块, 注入 prompt 用.

    返回空字符串 = 不注入 (graceful).
    """
    if not state:
        return ""
    lines = ["【上一章场景状态 - 必须严格遵循的物理事实】"]
    if state.get("location"):
        lines.append("  地点: " + str(state["location"]))
    present = state.get("characters_present") or []
    if present:
        names = [c.get("name", "?") for c in present if c]
        if names:
            lines.append("  在场角色: " + ", ".join(names))
    left = state.get("characters_left") or []
    if left:
        lines.append("  已离开角色 (本章不应出现在场):")
        for c in left:
            lines.append("    - " + str(c.get("name", "?")) + ": " + str(c.get("last_action", "?")))
    entered = state.get("characters_entered") or []
    if entered:
        lines.append("  中途进入:")
        for c in entered:
            lines.append("    - " + str(c.get("name", "?")) + ": " + str(c.get("enter_method", "?")))
    items = state.get("items") or []
    if items:
        lines.append("  物品状态:")
        for it in items:
            lines.append("    - " + str(it.get("name", "?")) + ": " + str(it.get("state", "?")))
    conf = state.get("confidence", 0.0)
    try:
        conf_str = ("{:.2f}").format(float(conf))
    except Exception:
        conf_str = "0.00"
    lines.append("  (提取可信度: " + conf_str + ")")
    return NL.join(lines) if False else chr(10).join(lines)



# ====================================================================
# 内嵌单元测试 (python -m app.services.scene_state_extractor)
# ====================================================================

_TEST_CASES = [
    # (label, text, character_names, project_items, expected_present_subset, expected_left_subset, expected_entered_subset, expected_loc_contains_or_None)
    (
        "bug_repro_lu_yuan_离开",
        "宋知意安静地坐在 CBD 高档餐厅包厢 里。\n陆宴抬起手腕看了看那只定制的百达翡丽，随后站起身。\n宋知意没有起身，目送着他拉开包厢沉重的木门。\n随着陆宴的离去，整个包厢瞬间陷入了一种近乎死寂的空旷之中。\n冰水杯依然完好地放在桌上。\n秦峥推门走进包厢。",
        ["宋知意", "陆宴", "秦峥"],
        ["冰水杯"],
        {"宋知意", "秦峥"},  # 陆宴已离开
        {"陆宴"},
        {"秦峥"},  # 秦峥中途进入
        "包厢",  # location 应含包厢
    ),
    (
        "empty_text",
        "",
        ["宋知意"],
        None,
        set(),
        set(),
        set(),
        None,
    ),
    (
        "single_char_stay",
        "王总在会议室里看着文件。",
        ["王总"],
        None,
        {"王总"},
        set(),
        set(),
        "会议室",
    ),
    (
        "char_explicit_leave",
        "李明站起身离开书房，留下空荡荡的房间。",
        ["李明"],
        None,
        set(),
        {"李明"},
        set(),
        "书房",
    ),
    (
        "char_did_not_leave",
        "宋知意没有起身，目送着他。",
        ["宋知意"],
        None,
        {"宋知意"},  # 关键: "没有起身" 不算离开
        set(),
        set(),
        None,
    ),
]


def run_self_tests() -> bool:
    """跑内嵌测试用例, 返回 True 全过 / False 有失败. 打印结果到 stdout."""
    passed = 0
    failed = 0
    for case in _TEST_CASES:
        label, text, chars, items, exp_present, exp_left, exp_entered, exp_loc = case
        state = extract_scene_state(text, chars, project_items=items)
        present = {c["name"] for c in state["characters_present"]}
        left = {c["name"] for c in state["characters_left"]}
        entered = {c["name"] for c in state["characters_entered"]}
        loc = state["location"]
        ok = True
        msgs = []
        if present != exp_present:
            ok = False
            msgs.append("present " + str(present) + " != " + str(exp_present))
        if left != exp_left:
            ok = False
            msgs.append("left " + str(left) + " != " + str(exp_left))
        if entered != exp_entered:
            ok = False
            msgs.append("entered " + str(entered) + " != " + str(exp_entered))
        if exp_loc is not None and (loc is None or exp_loc not in loc):
            ok = False
            msgs.append("loc " + str(loc) + " missing " + exp_loc)
        if ok:
            passed += 1
            print("  PASS  " + label)
        else:
            failed += 1
            print("  FAIL  " + label + ": " + "; ".join(msgs))
    print()
    print("Total: " + str(passed + failed) + ", Passed: " + str(passed) + ", Failed: " + str(failed))
    return failed == 0


if __name__ == "__main__":
    import sys
    ok = run_self_tests()
    sys.exit(0 if ok else 1)
