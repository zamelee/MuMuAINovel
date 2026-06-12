# End Anchor System (结束锚点系统)

防止 AI 写小说时 **剧情抢跑** (plot overrun)。每章设定一个 End Anchor —
最后一个镜头/画面的简短文字描述。生成时把锚点作为 **P0 硬约束** 注入提示词,
模型把镜头定格在该画面上,不越界到下一条大纲。

---

## 1. 概念

- **End Anchor** = 一段简短文字 (建议 30-200 字), 描述本章最后一个镜头/画面。
- **未设置** = 提示词中锚点变量替换为 `(未设定, 请自然收尾)`, 模型行为降级。

## 2. 数据库

`backend/app/models/chapter.py`
- `Chapter` 表新增字段 `end_anchor = Column(Text, nullable=True)`
- `backend/migrate_end_anchor.py` — 迁移脚本, 向后兼容 (旧行 NULL)

## 3. 后端 API

挂在 `backend/app/api/chapters.py` 路由下:

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/chapters/{id}/check-anchor` | 手动锚点合规检测 (本地算法, 0 token) |
| GET  | `/api/chapters/{id}/anchor-score` | 读取已持久化的合规分数 |
| POST | `/api/chapters/{id}/fill-anchor` | AI 自动补全/重新生成结束锚点 |
| POST | `/api/chapters/{id}/start-analysis` | 启动已创建的 pending 分析任务 (倒计时结束触发) |

`PUT /api/chapters/{id}` 也接受 `end_anchor` 字段用于手动编辑保存。

## 4. 提示词集成 (P0 硬约束)

`backend/app/services/prompt_service.py` 中 `build_chapter_regeneration_prompt` 增加:

1. **指令优先级声明表 (P0/P1/P2)**:
   - P0 硬约束: 结束锚点, 已发生事实, continuation_point, 角色存活状态
   - P1 必须遵守: 章节大纲, 关键事件, 角色信息, 写作风格
   - P2 建议改进: 分析建议, 用户自定义修改意见
   - 冲突时 P0 优先, P2 维度尽量小幅调整
2. **结束锚点硬约束块** (仅当 `project_context.end_anchor` 非空时渲染):
   - 本章最后一个镜头必须且只能定格在 `{end_anchor}`
   - 严禁写到该画面之后
   - 如果修改建议与该锚点冲突, 以锚点为准

## 5. 前端类型与 API

`frontend/src/types/index.ts`:
- `Chapter.end_anchor?: string | null`
- `ChapterPlanItem.end_anchor?: string | null`
- `AnalysisTask.status` 增加 `'cancelled'` (孤儿清理用)
- `ProjectHealth` 增加 `chapters_missing_anchor` / `chapters_missing_anchor_ids`
- 新增 `SystemSecuritySettings` / `SystemSecuritySettingsUpdate`

`frontend/src/services/api.ts`:
- `settingsApi.getSystemSecuritySettings()` / `updateSystemSecuritySettings(data)`
- `chapterApi.getAnchorScore` 修正 axios 泛型为 `<unknown, ResT>`

## 6. 章节重新生成上下文 (注入前置章节信息)

`backend/app/api/chapters.py` 的 `regenerate_chapter_stream` 在调提示词服务之前
构建 `previous_context` 字符串, 包含:

1. 上一章末尾 500 字 (仅 `chapter_number > 1`)
2. 上一章的 `end_anchor`
3. 上一章的 `chapter_summary` (从 `StoryMemory.memory_type='chapter_summary'` 取)
4. 最近 10 章脉络 (三段式回退: 分析摘要 → 大纲规划 → 字段摘要)

## 7. 最近章节上下文 (`chapter_context_service.py`)

`OneToManyContextBuilder._build_recent_chapters_context` 重写为 **三段式回退**:

1. 优先取 `StoryMemory.chapter_summary` (真实摘要)
2. 次取 `PlotAnalysis.plot_points` (分析情节点)
3. 兜底解析 `Chapter.expansion_plan` JSON (生成期规划)
4. 仍无 → 退回 `Chapter.summary` 字段

## 8. 孤儿分析任务清理

`backend/app/main.py`:

- 启动时拉起 `_orphan_cleanup_loop()`, 每 10 分钟跑一次
- `_cleanup_orphan_analysis_tasks()` 把 `pending` 超过 30 分钟的任务标记为 `cancelled`
- 写入 `error_message: "Orphan task: created >30min ago, auto cleaned up"`
- 解决: AI 创作完成时后端顺手创建 pending 任务, 但用户从不启动/创建后崩溃
  导致的 "分析永远 pending" 假象

## 9. UI 行为

### 9.1 章节列表 (`pages/Chapters.tsx`)

分析按钮 4 处 (移动端 2 + 桌面端 2) 状态机:

```
isCountingDown  = chapterCountdowns[id] > 0                  # 前端倒计时
isAnalyzing     = analysisTasksMap[id]?.status === 'running' # 后端真正在跑
hasContent      = item.content 存在且非空
```

| 状态 | tooltip | disabled | loading | icon | 文字 | 点击行为 |
|---|---|---|---|---|---|---|
| 倒计时中 | 点击取消自动分析 | false | false | 红色 × CloseCircle | **取消** | `cancelChapterCountdown` |
| 运行中 (running) | 分析进行中, 请稍候 | true | true | 旋转 Sync | 分析中 | (disabled) |
| 普通 | (无) | false | false | 图表 Fund | 分析 | `handleShowAnalysis` |
| 无内容 | 请先生成章节内容 | true | false | 图表 Fund | 分析 | (disabled) |

**关键设计**:

- `isAnalyzing` **不** 包括 `'pending'`. 前端在倒计时期间不在 `analysisTasksMap`
  写入 pending; 倒计时结束调 `startAnalysis` 真正启动后, 轮询 1-3 秒拉到
  `running` 才计入。
- 这样按钮在倒计时期间不会被误 disable, 倒计时期间用户可点 "取消"。

### 9.2 阅读面板 (`components/ChapterReader.tsx`)

结束锚点 InfoBlock 三态:

```
editingAnchor: boolean     # 编辑态
localEndAnchor: string     # 本地展示值 (覆盖 prop)
anchorDraft: string        # textarea 草稿
refillingAnchor: boolean   # AI 重新生成中
savingAnchor: boolean      # 保存中
```

| 状态 | 显示 | 右侧按钮 | API |
|---|---|---|---|
| 编辑中 | textarea (max 500, showCount) | 保存 / 取消 | `PUT /api/chapters/{id}` |
| 已设置 | 蓝色文字锚点 (保留换行) | 重新生成 / 编辑 | `POST /fill-anchor` / 进编辑 |
| 未设置 | 灰色提示 | AI 生成 | `POST /fill-anchor` |

`InfoBlock` 公共组件加 `actions?: React.ReactNode` 可选 prop,
title 行用 Space-between, title 在左, actions 在右。已有调用点不受影响。

### 9.3 章节分析 Modal (`components/ChapterAnalysis.tsx`)

- 触发分析后 **留在 Modal 内**, 由本组件 `fetchAnalysisStatus` 接管进度展示
- 不再立刻 `onClose()`, 避免父组件状态管理与本组件轮询抢控制权
- 轮询停止条件: `'completed'` / `'failed'` / `'cancelled'` / `'none'` 都停

## 10. 本次会话修复的 bug / 改进

按 commit 时间顺序:

| commit | 类型 | 内容 |
|---|---|---|
| `bc45a80` | feat | 结束锚点系统初版 (DB 迁移, 合规检测, 检测面板) |
| `e4c1e9e` | fix(types) | 补 8 个文件 TypeScript 类型, tsc 错误 43 → 0 |
| `f8c6de5` | fix(chapters) | 倒计时按钮 disabled 修复 + 文字改 "取消" |
| `8781941` | feat | 结束锚点扩展: regenerate 注入前置上下文, 提示词 P0/P1/P2, 孤儿清理 |
| `2877197` | refactor | autoAnalysisEnabled 不再提前乐观写 task, 从根上避免 disabled |
| `70a3b94` | feat | 阅读面板结束锚点支持 AI 重新生成 + 手动编辑 |
| `840a0d3` | docs | 添加 AGENTS.md (PowerShell 改编程文件的全局禁令) |

### 10.1 倒计时按钮 disabled bug

**症状**: 自动分析模式下, 倒计时期间鼠标放上去 tooltip 显示 "点击取消自动分析",
但按钮点不动。

**根因** (两处):

1. `isAnalyzing` 把 `'pending'` 当作分析中 → 按钮 `disabled={!hasContent || isAnalyzing}` 永远为 true
2. AI 创作完成时 **乐观写入** `analysisTasksMap[id].status = 'pending'`, 倒计时期间一直存在

**最终修复** (`2877197`):

- **不在** `analysisTasksMap` 乐观写入 pending task
- `isAnalyzing` 改定义为 `task?.status === 'running'`
- 倒计时期间前端对 task 一无所知, 按钮永远可点, 文字 "取消", icon 红 ×
- 倒计时结束 `startAnalysis` 触发后, 轮询 1-3 秒拉到 `running` 才开始 loading

### 10.2 `tsc --noEmit` 43 → 0

上次 commit `bc45a80` 自带 43 条类型错误, vite 仍能跑 (无严格 tsc gate) 但 editor
标红/CI 报警。`e4c1e9e` 一次性补全:

- `AnalysisTask.status` 加 `'cancelled'`
- `ProjectHealth` 加 `chapters_missing_anchor` / `chapters_missing_anchor_ids`
- 新增 `SystemSecuritySettings` 接口 (补 `settingsApi` 的两个方法)
- `expansion_plans` 数组补 `end_anchor`
- 各种死代码 (Radio/InputNumber/Spin/3 个 icon/localStrategy/quickCheckResult) 清理
- `ChapterReader.tsx` `if(!chapter)` 块内访问 end_anchor 的死代码删
- SystemSettings 公告管理 Tab 补 key
- ChapterAnalysis `renderProgress` 早 return 收窄改宽松以保留 failed/cancelled 状态

## 11. 文件清单

### 后端

- `backend/app/models/chapter.py` — `Chapter.end_anchor` 字段
- `backend/migrate_end_anchor.py` — DB 迁移
- `backend/app/api/chapters.py` — 4 个新端点 + regenerate 注入 previous_context
- `backend/app/services/prompt_service.py` — P0/P1/P2 优先级 + 结束锚点硬约束块
- `backend/app/services/chapter_context_service.py` — 三段式回退最近章节上下文
- `backend/app/main.py` — 孤儿分析任务清理循环

### 前端

- `frontend/src/types/index.ts` — 类型补全 (结束锚点, cancelled, ProjectHealth, Security)
- `frontend/src/services/api.ts` — SystemSecurity API + getAnchorScore 泛型修复
- `frontend/src/pages/Chapters.tsx` — 4 处分析按钮状态机 + autoAnalysisEnabled 不乐观写入
- `frontend/src/pages/Outline.tsx` — expansion_plans 数组补 end_anchor
- `frontend/src/pages/SystemSettings.tsx` — 公告管理 Tab 补 key
- `frontend/src/components/ChapterAnalysis.tsx` — 触发分析后留在 Modal 接管进度
- `frontend/src/components/ChapterReader.tsx` — InfoBlock 加 actions prop + 结束锚点三态
- `frontend/src/store/hooks.ts` — 删除未用的 quickCheckResult
- `frontend/src/components/HealthBanner.tsx` — 删除未用 import + item 类型注解

### 文档与配置

- `AGENTS.md` — PowerShell 改编程文件的全局禁令 (新增)
- `docs/END_ANCHOR_SYSTEM.md` — 本文档 (新增)
- `docs/FORK_CHANGES.md` — 追加本会话修复记录
- `README.md` — 特性 + 使用指南各加一行结束锚点说明

---

**维护者备注**: 本次所有修改都通过了 `tsc --noEmit` 0 错误 + 后端 4 模块 import OK smoke。
AGENTS.md 要求后续修改文本文件一律走 Python (详见 AGENTS.md)。
