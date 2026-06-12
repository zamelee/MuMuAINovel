# Fork 后的改动说明

**分支**: `codex/fork-changes`  
**基准**: `728bc1d` (xiamuceer-j/main 最后一次同步点)  
**对比**: `e688172` (当前 HEAD)

---

## 一、新增文件

| 文件 | 用途 |
|------|------|
| `launcher.py` (513行) | TKinter 启动器，三栏面板（后端日志 / 前端输出 / LLM通信日志），支持 LLM 监视开关、行数限制、自动换行切换、孤儿进程清理、退出时自动杀服务 |
| `start.ps1` (56行) | 一键启动脚本，处理 venv 激活、端口占用检测、前后端并发启动 |
| `stop.ps1` (16行) | 一键停止脚本，清理所有残留进程 |
| `backend/app/utils/prompt_logger.py` (122行) | LLM 通信内容记录器，写入 `logs/llm_prompts.log`，供启动器 LLM 面板展示 |

## 二、核心改动

### 1. `backend/app/api/chapters.py` (+985/-218)

- 新增 `_calculate_generation_max_tokens()` 函数，统一 max_tokens 计算公式：
  ```
  max_tokens = 目标字数 × output_token_multiplier + 提示词长度 × prompt_char_token_ratio
  max_tokens 不能超过模型上限（settings.default_max_tokens / API 配置的 max_tokens）
  ```
- 章节生成、批量生成、局部重写 3 个调用点全部接入该公式
- 支持前端传入 `char_token_ratio`（字元比），后端兜底默认 1.5
- 安全钳位：`output_token_multiplier` 和 `prompt_char_token_ratio` 均 clamp 在 0.5-10.0

### 2. `backend/app/services/ai_service.py` (+32)

- 新增 `_strip_thinking()` 状态机过滤器，处理跨 chunk 的 `...` think 标签
- 流式和非流式路径均过滤 think 内容，解决 gemini/deepseek 等模型返回思考过程污染正文

### 3. `backend/app/services/prompt_service.py` (+9)

- 4 个章节生成模板中 `±200字` 收窄为 `±100字`
- 新增角色出场边界约束和剧情边界约束

### 4. `backend/app/logger.py` (+117)

- 日志文件输出、轮转配置（单文件 10MB，保留 30 个备份）
- 日志格式标准化

### 5. `backend/app/schemas/chapter.py` (+2)

- `ChapterGenerateRequest` 和 `BatchGenerateRequest` 新增 `char_token_ratio: Optional[float]` 字段（范围 1.0-5.0，默认 1.5）

### 6. `backend/app/config.py` (+10)

- 新增 `default_max_tokens` 配置项

## 三、前端改动

### `frontend/src/pages/Chapters.tsx` (+119)

- 新增"字元比" InputNumber 控件（1.0-5.0，步长 0.1，默认 1.5，localStorage 缓存）
- tooltip: "1个中文字符约等于几个token。越低 max_tokens 越紧，生成字数越接近目标"

### `frontend/src/pages/Settings.tsx` (+100)

- 新增 LLM 最大 token 数配置项（`default_max_tokens`），对应后端 `config.py`

## 四、设计意图

核心解决一个问题：**控制 AI 小说生成的字数准确度**。

原来的 max_tokens 写死为 `目标字数 × 2.5`（约 10558），模型经常超写（deepseek 写到 7518）或漏写（gemini-3.5-flash 只写 1757）。通过引入可调的"字元比"参数，用户可以收紧或放宽 token 预算，配合 prompt 模板的 ±100 字约束和角色/剧情边界规则，从"上限"和"内容边界"两个方向夹逼生成字数。

启动器（`launcher.py`）提供统一的运维入口，方便监控 LLM 通信内容、清理残留进程。

---

## 五、结束锚点（End Anchor）系统

**核心功能**：防止 AI 写小说时"剧情抢跑"（执行溢出）。每章设定一个【结束锚点】画面描述，生成时约束模型停在该画面上，不越界到下一条大纲。

### 5.1 数据库

\ackend/app/models/chapter.py\
- \Chapter\ 表新增 \nd_anchor = Column(Text, nullable=True)\ 字段
- \ackend/migrate_end_anchor.py\ — 迁移脚本，向后兼容（已有大纲该字段为 NULL）

### 5.2 后端 API

\ackend/app/api/chapters.py\
- \POST /{chapter_id}/check-anchor\ — 手动锚点合规检测（本地算法，0 token 消耗）
- \GET /{chapter_id}/anchor-score\ — 读取已持久化的锚点分数（不重新计算）
- \POST /{chapter_id}/fill-anchor\ — AI 补全章节锚点（调用 LLM 根据大纲生成）
- \POST /project/{project_id}/fill-anchors\ — 批量补全项目中所有缺失锚点

\ackend/app/api/outlines.py\
- 大纲批量补全锚点接口

### 5.3 锚点合规检测引擎

\ackend/app/services/plot_analyzer.py\
- \alidate_end_anchor()\ — 本地初步检测，支持三种策略：
  - **A**: jieba 中文分词关键词匹配（快速，解决修饰词插入）
  - **B**: MiniLM embedding 语义相似度（智能，解决同义词替换）
  - **A+B**: jieba 优先，低分时 embedding 兜底（默认，推荐）
- \outline_boundary_check()\ — 大纲越界检测，防止正文写到下一条大纲内容
- 评分范围 1-10，≥7 为绿灯，4-6 为黄灯，<4 为红灯

### 5.4 前端改动

\rontend/src/pages/Outline.tsx\
- 大纲展开预览中每章 Tab 显示锚点 Card
- 锚点为空时显示提醒符号，支持手动编辑和 AI 补全

\rontend/src/pages/Chapters.tsx\
- 编辑章节内容底部新增**初步检测**面板：
  - 横向三块布局：当前字数 | 初步检测（A/B/A+B 策略 + 阈值 + 锤子按钮 + 分数 Tag）| 取消/保存
  - 编辑打开时自动从 DB 读取已有锚点分数
  - 策略和阈值持久化在 localStorage

\rontend/src/components/ChapterReader.tsx\
- 左侧改为"前后章节预览"，显示上一章/下一章的关键事件
- 本章验收区域显示锚点内容（未设置时提示可 AI 提取或手动编辑）
- 右侧纲要区域保持紧凑，不折叠

\rontend/src/components/ChapterAnalysis.tsx\
- 评分维度新增**锚点合规**（anchor_compliance，0-10 分）
- 锚点合规右侧新增"重新锚点评分"按钮（手动触发本地检测）
- 修复 cancelled 状态处理：显示"分析已取消"错误提示 + 重新分析按钮

### 5.5 PlotAnalysis 持久化

\ackend/app/models/memory.py\
- \PlotAnalysis\ 表新增 \nchor_compliance_score = Column(Float, nullable=True)\
- \check-anchor\ 端点和完整分析均写入同一字段，编辑页和章节分析页读取同一数据源

## 六、章节生成后自动分析优化

\rontend/src/pages/Chapters.tsx\
- 修复自动分析开关逻辑：
  - ✅ 勾选"启用章节生成后自动分析"→ 生成完成后启动倒计时 → 到期调 startAnalysis → LLM 分析
  - ❌ 取消勾选 → 生成完成后仅运行本地初步检测（0 token），不触发 LLM 分析
- 倒计时显示在章节管理页面，默认 30 秒，可调范围 10-120 秒
- 倒计时过程中点击按钮可取消
- 修复 Checkbox 取消勾选时立即清除所有倒计时定时器

## 七、字元比（Char-Token Ratio）弹性控制

\ackend/app/api/chapters.py\
- \_calculate_generation_max_tokens()\ 公式：
  \\\
  max_tokens = 目标字数 × output_token_multiplier + 提示词长度 × prompt_char_token_ratio
  max_tokens 不能超过模型上限（API 配置的 max_tokens）
  \\\
- \output_token_multiplier\（输出侧，默认 2.5，1 个中文字 ≈ 几个 token）
- \prompt_char_token_ratio\（输入侧，默认 0.5，1 个提示词字符 ≈ 几个 token）
- 前端"包络系数"控件（1.0-5.0，步长 0.1，默认 1.5），两个变量同时受其影响
- 安全钳位：所有参数 clamp 在合理范围内，非法值不崩后端

## 八、Analysis Polling 修复

\rontend/src/pages/Chapters.tsx\ + \rontend/src/components/ChapterAnalysis.tsx\
- 轮询停止条件新增 \cancelled\ 状态，防止 stuck pending 任务导致无限轮询
- 后端清理超过 30 分钟的 pending 任务（自动标记为 cancelled）
- 前端 ChapterAnalysis 完整处理 cancelled 状态生命周期

## 九、其他优化

\ackend/app/services/prompt_service.py\
- 章节生成模板新增结束锚点变量 \{end_anchor}\，未设置时替换为"(未设定，请自然收尾)"
- 角色出场边界约束和剧情边界约束增强

\ackend/app/services/ai_service.py\
- 新增 think-tag 状态机过滤器，处理跨 chunk 的 \\...\\ 内容

---

## 十、本次会话修复与功能扩展 (commits 8781941..70a3b94)

本节补充会话期间针对结束锚点系统做的进一步修复、状态机简化、UI 改进。

### 10.1 端到端功能扩展 (`8781941`)

#### 后端

- `backend/app/api/chapters.py` — `regenerate_chapter_stream` 注入前置章节上下文:
  - 上一章末尾 500 字 (仅 `chapter_number > 1`)
  - 上一章的 `end_anchor`
  - 上一章的 `chapter_summary` (从 `StoryMemory.memory_type='chapter_summary'` 取)
  - 最近 10 章脉络 (三段式回退)
- `backend/app/services/prompt_service.py` — `build_chapter_regeneration_prompt` 增加:
  - 指令优先级声明表 (P0/P1/P2), 冲突时 P0 优先
  - 结束锚点硬约束块 (仅 `project_context.end_anchor` 非空时渲染)
- `backend/app/services/chapter_context_service.py` — `OneToManyContextBuilder._build_recent_chapters_context` 重写为三段式回退:
  1. 真实摘要 `StoryMemory.chapter_summary`
  2. 分析情节点 `PlotAnalysis.plot_points`
  3. 规划期 JSON `Chapter.expansion_plan`
  4. 仍无 → `Chapter.summary` 字段
- `backend/app/main.py` — 启动 `_orphan_cleanup_loop()` 每 10 分钟跑一次, 把 `pending` 超过 30 分钟的分析任务标记为 `cancelled`

#### 前端

- `frontend/src/components/ChapterAnalysis.tsx` — 触发分析后 **留在 Modal 内**, 由本组件 `fetchAnalysisStatus` 接管进度展示, 不再立刻 `onClose()`

### 10.2 TypeScript 类型补全, tsc 43 → 0 (`e4c1e9e`)

上次 commit 自带 43 条类型错误, vite 仍能跑但 editor 标红。一次性补全:

- `frontend/src/types/index.ts`:
  - `AnalysisTask.status` 加 `'cancelled'`
  - `ProjectHealth` 加 `chapters_missing_anchor` / `chapters_missing_anchor_ids`
  - 新增 `SystemSecuritySettings` / `SystemSecuritySettingsUpdate`
- `frontend/src/services/api.ts`:
  - 补 `settingsApi.getSystemSecuritySettings` / `updateSystemSecuritySettings`
  - `chapterApi.getAnchorScore` 修正 axios 泛型为 `<unknown, ResT>`
- `frontend/src/pages/Outline.tsx` — `expansion_plans` 数组补 `end_anchor`
- `frontend/src/pages/SystemSettings.tsx` — 公告管理 Tab 补 key
- 死代码清理: `Radio`/`InputNumber`/`Spin`/3 个 icon/`localStrategy`/`quickCheckResult`
- `frontend/src/components/ChapterReader.tsx` — 删 `if(!chapter)` 块内访问 `end_anchor` 的死代码
- `frontend/src/components/ChapterAnalysis.tsx` — `renderProgress` 早 return 收窄改宽松以保留 `failed`/`cancelled`

### 10.3 倒计时按钮 disabled bug 修复 (`f8c6de5`)

**症状**: 自动分析模式, 倒计时期间鼠标放上去 tooltip 显示 "点击取消自动分析", 但按钮点不动。

**根因**:

1. `isAnalyzing` 把 `'pending'` 当作分析中 → `disabled={!hasContent || isAnalyzing}` 永远 true
2. AI 创作完成时乐观写入 `analysisTasksMap[id].status = 'pending'`, 倒计时期间一直存在

**修复**: 4 处按钮统一改 `disabled` / `loading` / `icon` / 文字。倒计时时: 文字 "取消", icon 红色 ×, 可点。

### 10.4 根因修复 + 简化 (`2877197`)

承接 10.3 的修复, 这次从设计上根除: **不在** `analysisTasksMap` 乐观写入 pending task, `isAnalyzing` 改定义为 `task?.status === 'running'`。倒计时期间前端对 task 一无所知, 按钮永远可点。

`cancelChapterCountdown` 同步清理本地 pending task 的代码随之删除 (因为根本没写)。

### 10.5 阅读面板结束锚点编辑 (`70a3b94`)

`ChapterReader.tsx` PlanPanel 内部增加结束锚点编辑能力:

- `InfoBlock` 公共组件加 `actions?: React.ReactNode` 可选 prop (title 行 Space-between)
- PlanPanel 内部 state: `localEndAnchor` / `editingAnchor` / `anchorDraft` / `refillingAnchor` / `savingAnchor`
- 三态 UI: 编辑中 (textarea + 保存/取消) / 已设置 (文本 + 重新生成/编辑 icon) / 未设置 (灰色提示 + AI 生成)
- API: `POST /fill-anchor` / `PUT /api/chapters/{id}` (body `{end_anchor: next || null}`)

### 10.6 全局规则 (`840a0d3`)

新增 `AGENTS.md` — **PowerShell 改编程文件的全局禁令**。详见 `AGENTS.md`。

### 10.7 验证状态

- `tsc --noEmit`: 0 错误
- 后端 4 个修改模块 `importlib` smoke 全部 OK
- Git working tree 干净
- 共 7 个 commit 在 origin/main 之前 (待 push)

详见 `docs/END_ANCHOR_SYSTEM.md` (本会话完整系统说明)。
