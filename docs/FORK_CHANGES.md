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
