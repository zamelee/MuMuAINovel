# 端到端测试清单 (2026-06-13)

**配套 commits**: 802f26c (Phase 5c 倒计时修复) + 60e876b (Phase 3b hooks) + 059c9f5 (Phase 3a hooks) + 之前所有 Batch/Z 系列

**测试环境**:
- 后端: http://localhost:8000 (uvicorn, --reload)
- 前端: http://localhost:5173 (vite)
- 启动方式: 双击 MuMuAINovel.exe 或 start.ps1

---

## Test A: 倒计时取消按钮 (核心修复, commit 802f26c)

**目的**: 验证回归 bug 已修。倒计时期间, 4 个"分析"按钮 100% 可点。

**前置**:
- 默认配置 (autoAnalysisEnabled=true, 30s 倒计时)
- 至少有 1 个项目 + 1 个已生成内容的章节

**步骤**:
1. 打开 http://localhost:5173
2. 进任一项目 → "章节管理"页
3. 找到任一章节 (有内容), 点"AI 重新生成"或编辑器内"开始生成"
4. 选风格 + 字数 + 模型, 点提交
5. 等 AI 写完 (等 message.success "AI创作成功！30秒后自动开始分析")
6. 关键观察: 章节列表的"分析"按钮此时变成 "30s 取消" (秒数倒计时)
7. 关键测试: 鼠标悬停按钮 → tooltip 应显示 "点击取消自动分析 (Xs 后开始)"
8. 关键测试: 倒计时期间点按钮 → 应能点, 倒计时立即消失
9. 验证: 按钮文字变回 "分析", icon 变回 FundOutlined
10. 验证: 后端未创建 analysis_task (看章节列表的 task 状态, 应是"无")

**预期**: 步骤 8 倒计时能取消, 步骤 9 文字立即恢复, 步骤 10 章节无 task

**bug 失败标志**: 步骤 8 按钮无反应 / 步骤 10 仍然有 task 创建

---

## Test B: 倒计时自然完成 (回归测试, eb23bb9)

**目的**: 验证不取消时, 30s 后自动跑分析。

**步骤**:
1. 同 Test A 步骤 1-5
2. 不点取消, 等 30s
3. 观察: 倒计时归零后, 按钮变 "分析中" + loading 转圈 (SyncOutlined spin)
4. 观察: 后端开始处理, 几秒到几十秒后 task 完成
5. 验证: 按钮变回 "分析" (无 loading), 章节列表的 task 状态 = "已完成"

**预期**: 不点取消时, 30s 后自动转分析流程, 跑完

---

## Test C: 阅读界面 AI重新生成 / 手动编辑 (commit 053c02e + 70a3b94)

**目的**: 验证章节阅读器 + 结束锚点 + 两个新按钮。

**步骤**:
1. 章节管理页 → 任一已写完章节 → 点"阅读"按钮
2. 验证: 阅读器打开, 内容正常渲染
3. 滚动到章节末尾: 找到"结束锚点"区域
4. 验证: 锚点旁有 "AI 重新生成" 和 "手动编辑" 两个按钮
5. 测试 AI 重新生成: 点按钮 → 弹出确认 → 选风格 → 触发流式 API
   验证: 流式进度条显示, AI 续写内容追加到原内容后
6. 测试 手动编辑: 点按钮 → 出现可编辑的 TextArea
   验证: 改完后点保存, 内容更新, 后端 PATCH /chapters/{id}

**预期**: 两个按钮都正常, 锚点系统闭环

---

## Test D: Chapters.tsx 拆分后功能正常 (Phase 3a/3b)

**目的**: 验证 6 个 hook 抽离后, 所有功能没坏。

**核心验证** (因为 hooks 拆分是内部重构, 外部看是"功能没坏"):

入口 / 验证点:
- 章节列表加载 / 项目切换时, 列表/分页/搜索都正常 (useChapterList)
- 批量分析 / 顶部"批量分析"按钮可点, 选章节, 跑完
- AI 创作单章 / 编辑器打开, 流式进度, 完成后自动倒计时 (useGenerateChapter)
- AI 创作后台模式 / 点"后台创作"按钮, 关闭编辑器后进度仍跑
- 章节分析 / 单章节"分析"按钮 → 进度模态框, 任务列表, 钩子/伏笔/评分
- 手动新建章节 / 1-N 模式下, 顶部"新建章节"按钮 (useChapterCRUD)
- 章节删除 / 1-N 模式下, 每章"删除"按钮
- 阅读器 / 点"阅读"按钮 → ChapterReader 打开, 翻页正常 (useChapterReader)
- 局部重写 / 阅读器内选中文本, 弹出局部重写工具栏

**预期**: 全部正常工作, 无 console error (开 F12 验证)

---

## Test E: autoAnalysisEnabled 开关 (Settings Z.5)

**目的**: 验证 Settings 页能切自动分析开关, 切了后行为变。

**步骤**:
1. 顶部菜单 → Settings → "章节上下文注入" tab
2. 找到 autoAnalysisEnabled 开关, 关掉它
3. 保存
4. 章节管理页 → 任意章节 → AI 重新生成 → 写完
5. 验证: AI 写完不启动倒计时, 按钮直接是 "分析" (无倒计时)
6. 手动点"分析": 验证仍可手动触发
7. 回到 Settings → 重新打开 autoAnalysisEnabled
8. 再 AI 创作一次, 验证倒计时恢复

**预期**: 开关切换后, 行为立即变化

---

## Test F: 9 字段注入开关 (Z.2-Z.5 + 1-1/1-N)

**目的**: 验证 Settings 的 9 个注入开关都能 work。

**步骤**:
1. Settings → 章节上下文注入 → 看 9 个开关
2. 关掉任一字段 (例如 prev_summary)
3. 章节管理页 → AI 创作第 2 章
4. 看后端日志 (后端窗口): prompt 注入区应不包含 prev_summary 块
5. 重新打开开关 → 再创作 → 日志应包含 prev_summary

**预期**: 每个开关都能影响 prompt 注入

**9 个开关** (具体名以 UI 为准): prev_content_tail / prev_end_anchor / prev_summary / recent_chapters / scene_state / outline_pruning_warning / foreshadow_logger_only / emotion_curve / character_state

---

## Test G: 场景状态机防时空悖论 (Batch 2: 49e3062)

**目的**: 验证 Gemini 报的"陆宴悖论"修复 (SceneState 注入 + Outline Pruning)。

**前置**: 至少 2 章内容, 进入第 3 章创作。

**步骤**:
1. 章节管理 → 写完第 1 章 + 第 2 章
2. 进第 3 章 → AI 重新生成
3. 看后端日志: prompt 注入区应有
   - "当前场景状态"
   - Location: ...
   - Characters_Present: [宋知意]
   - Characters_Left: [陆宴]
4. 验证: 第 3 章生成时, 不会再"复活"陆宴 (陆宴在第 2 章结尾已离开)

**预期**: 后端日志有 scene_state 块, 第 3 章内容不矛盾

---

## Test H: 批量分析

**步骤**:
1. 章节管理页顶部 → 点"批量分析未分析章节"按钮
2. 验证: 出现确认弹窗, 列出会被分析的章节
3. 确认 → 验证: 后端开始批量处理, 章节列表里每章的"分析"按钮变 "分析中"
4. 等全部完成 → 验证: 任务状态都 = "已完成"

**预期**: 批量流程正常, 不会卡死或漏章节

---

## 测试辅助: 怎么观察后端行为

后端窗口 (启动后那个 powershell 窗口) 会实时打印日志. 你要找的关键词:
- PromptBuilder / chapter_context_service 注入的块
- scene_state / scene state 场景状态
- ForeshadowAutoResolver 伏笔解析
- OutlinePruningAgent 大纲修剪警告
- startChapterCountdown / cancelChapterCountdown 倒计时
- analysis_task 创建/完成

---

## 一键回归 checklist

按优先级, 至少跑这 3 个, 就能验证最近所有改动:
- Test A 倒计时取消按钮 (Phase 5c 核心, 你最早问的)
- Test B 倒计时自然完成
- Test D 章节管理 / 创作 / 分析 全流程没坏

跑完 3 个都过的话, Phase 5 全部 OK. 进一步验证:
- Test C 阅读器
- Test E Settings 开关
- Test F 9 字段注入
- Test G 场景状态机
- Test H 批量分析
