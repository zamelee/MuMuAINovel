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
