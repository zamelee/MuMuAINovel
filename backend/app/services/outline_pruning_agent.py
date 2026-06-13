# -*- coding: utf-8 -*-
"""
OutlinePruningAgent - Batch 3 大纲修剪代理 (纯规则版, 不调 LLM)

对比当前大纲 + 上一章 scene_state, 检测冲突:
1. character_already_left: 大纲 character_focus 包含 scene_state.characters_left 中的角色 (陆宴型时空悖论)
2. implicit_location_change: 大纲提到新地点 keywords, 但未明确从 prev_location 转场
3. empty_scene: 大纲要求对话/互动, 但 scene_state.characters_present 为空

返回: has_conflicts / conflict_count / conflicts / pruned_outline / warning_text
pruned_outline 已从 character_focus 中移除冲突角色 (留给主模型降权使用)

未来扩展: 可加 LLM agent 进一步优化, 当前是纯规则.
"""

from typing import Dict, List, Any, Optional


class OutlinePruningAgent:
    """Batch 3: 大纲修剪代理 (纯规则)"""

    def detect_conflicts(
        self,
        outline: Dict[str, Any],
        prev_scene_state: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """检测大纲冲突, 返回冲突列表 + 修剪后大纲."""
        pruned_focus: List[str] = list(self._extract_character_focus(outline))
        conflicts: List[Dict[str, Any]] = []

        if prev_scene_state:
            left = self._get_names(prev_scene_state.get("characters_left", []) or [])
            present = self._get_names(prev_scene_state.get("characters_present", []) or [])
            entered = self._get_names(prev_scene_state.get("characters_entered", []) or [])
            prev_location = (prev_scene_state.get("location") or "").strip()

            # 冲突 1: 角色已在上一章离开, 但被列入本章 character_focus
            for name in list(pruned_focus):
                if name in left:
                    conflicts.append({
                        "type": "character_already_left",
                        "severity": "high",
                        "character": name,
                        "description": name + " 已在上一章离开, 不应在本章直接出场或对话",
                        "suggestion": "可让 " + name + " 改在走廊/电话/回忆中登场, 或推迟到后续章节",
                    })
                    pruned_focus.remove(name)

            # 冲突 2: 隐式地点切换 (大纲提到新地点, 但未明确转场)
            if prev_location and self._mentions_location_change(outline, prev_location):
                conflicts.append({
                    "type": "implicit_location_change",
                    "severity": "medium",
                    "previous_location": prev_location,
                    "description": "大纲提到新地点, 但未明确从 " + prev_location + " 转场",
                    "suggestion": "在大纲开头添加转场描写 (如 '与此同时' / '三天后' / '镜头切换到')",
                })

            # 冲突 3: 空场 (要求互动, 但在场角色为空)
            if not present and not entered and left:
                if self._mentions_interaction(outline):
                    conflicts.append({
                        "type": "empty_scene",
                        "severity": "high",
                        "description": "大纲要求对话/互动, 但当前场景在场角色为空",
                        "suggestion": "让新角色进场, 或改为独白/旁白/回忆",
                    })

        pruned_outline = dict(outline)
        pruned_outline["character_focus"] = pruned_focus

        # 构造 warning_text
        warning_lines: List[str] = []
        if conflicts:
            warning_lines.append("⚠️ 检测到 " + str(len(conflicts)) + " 处大纲冲突 (Batch 3 OutlinePruningAgent):")
            for c in conflicts:
                ctype = c.get("type")
                if ctype == "character_already_left":
                    warning_lines.append("  - " + str(c.get("character", "?")) + ": 已在上一章离开, 已从 character_focus 移除")
                elif ctype == "implicit_location_change":
                    warning_lines.append("  - 地点转场缺失: " + str(c.get("previous_location", "?")) + " → 新地点未明确转场")
                elif ctype == "empty_scene":
                    warning_lines.append("  - 空场冲突: " + str(c.get("description", "")))
            warning_lines.append("建议人工确认或修改大纲后再生成本章正文。")
        warning_text = chr(10).join(warning_lines)

        return {
            "has_conflicts": len(conflicts) > 0,
            "conflict_count": len(conflicts),
            "conflicts": conflicts,
            "pruned_outline": pruned_outline,
            "warning_text": warning_text,
        }

    def _extract_character_focus(self, outline: Dict[str, Any]) -> List[str]:
        """从 outline 提取 character_focus, 兼容 list / structure.character_focus 两种来源"""
        focus = outline.get("character_focus")
        if isinstance(focus, list) and focus:
            return [str(x) for x in focus if x]
        structure = outline.get("structure")
        if isinstance(structure, str):
            import json as _json
            try:
                structure = _json.loads(structure)
            except Exception:
                structure = None
        if isinstance(structure, dict):
            f = structure.get("character_focus") or structure.get("characters")
            if isinstance(f, list):
                return [str(x) for x in f if x]
        return []

    def _get_names(self, items: List[Any]) -> List[str]:
        """从 [{"name": "X"}, "X"] 列表中提取 name 字符串"""
        names: List[str] = []
        for it in items or []:
            if isinstance(it, dict):
                n = it.get("name")
                if n:
                    names.append(str(n))
            elif isinstance(it, str):
                names.append(it)
        return names

    def _mentions_location_change(self, outline: Dict[str, Any], prev_location: str) -> bool:
        """检测大纲是否提到其他地点 keywords (隐式转场).

        规则: 如果 text 含 prev_location 任意 2-4 字 token, 视为同地点, 不算转场.
        """
        text = (outline.get("title", "") or "") + " " + (outline.get("content", "") or "")
        if prev_location:
            for n in range(2, min(5, len(prev_location) + 1)):
                for i in range(len(prev_location) - n + 1):
                    token = prev_location[i:i + n]
                    has_cjk = False
                    for ch in token:
                        code = ord(ch)
                        if 0x4e00 <= code <= 0x9fff:
                            has_cjk = True
                            break
                    if has_cjk and token in text:
                        return False
        loc_keywords = [
            "餐厅", "咖啡馆", "办公室", "会议室", "酒店", "酒吧",
            "家里", "公司", "学校", "医院", "公园", "街道",
            "包厦", "包间", "大厅", "走廊", "电梯", "车里",
            "门口", "楼下", "楼上", "房间", "卧室", "客厅",
        ]
        other_locs = [k for k in loc_keywords if k in text]
        return len(other_locs) > 0

    def _mentions_interaction(self, outline: Dict[str, Any]) -> bool:
        """检测大纲是否要求对话/互动"""
        text = (outline.get("title", "") or "") + " " + (outline.get("content", "") or "")
        interaction_keywords = [
            "对话", "说道", "开口", "问", "答", "回应", "回答", "交流", "交谈", "对质",
        ]
        return any(k in text for k in interaction_keywords)


outline_pruning_agent = OutlinePruningAgent()


# === 自测 ===
_TEST_CASES = [
    (
        "lu_yuan_timeline_paradox",
        {
            "title": "第三章",
            "content": "秦峥推门进入包厦, 向陆宴打招呼, 两人握手寒暄",
            "character_focus": ["秦峥", "宋知意", "陆宴"],
        },
        {
            "location": "CBD高档餐厅包厦",
            "characters_present": [{"name": "宋知意"}],
            "characters_left": [{"name": "陆宴"}],
            "characters_entered": [],
        },
        True,
        "character_already_left",
    ),
    (
        "no_conflict_normal",
        {
            "title": "第三章",
            "content": "秦峥与宋知意对话, 讨论工作安排",
            "character_focus": ["秦峥", "宋知意"],
        },
        {
            "location": "CBD高档餐厅包厦",
            "characters_present": [{"name": "宋知意"}],
            "characters_left": [{"name": "陆宴"}],
            "characters_entered": [],
        },
        False,
        None,
    ),
    (
        "no_prev_state",
        {
            "title": "第一章",
            "content": "宋知意独自走过CBD街道, 走入咖啡馆",
            "character_focus": ["宋知意"],
        },
        None,
        False,
        None,
    ),
]


def run_self_tests() -> bool:
    passed = 0
    failed = 0
    for case in _TEST_CASES:
        label, outline, prev_state, exp_has, exp_type = case
        result = outline_pruning_agent.detect_conflicts(outline, prev_state)
        ok = True
        msgs = []
        if result["has_conflicts"] != exp_has:
            ok = False
            msgs.append("has_conflicts " + str(result["has_conflicts"]) + " != " + str(exp_has))
        if exp_type:
            types = [c["type"] for c in result["conflicts"]]
            if exp_type not in types:
                ok = False
                msgs.append("expected type " + exp_type + " missing, got " + str(types))
        if label == "lu_yuan_timeline_paradox":
            pruned = result["pruned_outline"].get("character_focus", [])
            if "陆宴" in pruned:
                ok = False
                msgs.append("陆宴 should be removed from pruned_focus")
        if ok:
            passed += 1
            print("  PASS  " + label)
        else:
            failed += 1
            print("  FAIL  " + label + ": " + "; ".join(msgs))
    print("")
    print("Total: " + str(passed + failed) + ", Passed: " + str(passed) + ", Failed: " + str(failed))
    return failed == 0


if __name__ == "__main__":
    import sys
    ok = run_self_tests()
    sys.exit(0 if ok else 1)
