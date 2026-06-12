# AGENTS.md — Codex 在本仓库的工作约定

## 文件编辑：禁止使用 Windows PowerShell 改编程文件

**为什么**：PowerShell 在 Windows 下改 UTF-8 编程文件会踩多个雷：
- `Set-Content` / `WriteAllText` 默认会把 LF 换成 CRLF（污染 diff，触发 `core.autocrlf` 警告）
- `Get-Content` 输出到命令行时，多行字符串里的三引号会被反复转义/截断，
  导致 Python heredoc 之类的嵌入脚本静默失败（看起来“成功”但实际嘛也没改）
- `[System.IO.File]::WriteAllText` 还会自动加 BOM，导致 Python 报 `SyntaxError: U+FEFF`
- 复杂字符串替换经常 `exit 1` 但**没有任何输出**，难以排查

**结论**：本仓库任何编程文件（.ts / .tsx / .js / .py / .css / .json / .md 等）的
**读、改、写**，**全部走 Python**。PowerShell 只用来 `Get-ChildItem` / `git status` /
`rg` / `npm` / `pnpm` / `docker` 之类的只读 / 外部命令。

## 推荐的文件编辑流程

### 1. 读：用 Python 读 UTF-8 字符串
```python
with open(path, 'r', encoding='utf-8') as fh:
    c = fh.read()
```

### 2. 改：纯 Python 字符串替换（必要时多次 .replace）

### 3. 写：**显式 UTF-8 无 BOM + LF 换行**
```python
with open(path, 'w', encoding='utf-8', newline='') as fh:
    fh.write(c)
```
`newline=''` 关键 —— 避免 Python 二次把 LF 改 CRLF。

### 4. 复杂多步改：写 `.py` 临时文仴再 `python tmp.py`
不要在 PowerShell 行内命令里塞大段 Python heredoc，经常被引号吃字符。

### 5. 改完必校验
- `git diff -- <file>` 看是否符合预期
- 二次 `rg` 确认目标字符串已被替换、无残留
- 受影响文件跑一次 `tsc --noEmit` / `python -c "import ..."` / `pytest` 之类的快速 smoke

## PowerShell 仍然可用的场景

- `Get-ChildItem` / `Get-Content -TotalCount 5`（只读查看）
- `Select-String` / `Get-Content ... | Select-String`（只读搜）
- `git` / `npm` / `pnpm` / `docker` / `npx` 等外部命令
- `node` / `python` 直接调（不嵌 heredoc）
- 启动后台进程

## 其它通用约定

- **跑测试前先确认 tsc 通过**：`cd frontend && ./node_modules/.bin/tsc --noEmit -p tsconfig.app.json`
- **改 Python 后端**用 `.venv\Scripts\python.exe -c "import importlib; importlib.import_module('app.xxx')"` 跑 import smoke
- **commit 之前**`git diff --stat` 检查范围，描述用 Conventional Commits 风格
- **不要 PowerShell 写文件**这条覆盖了 .gitignore / .md / .yml / .json 等所有文本文件

---

## v2 补充 (Batch 1 后追加)

### 1. PowerShell 的 `Move-Item /tmp/...` 跟 Git Bash 行为不同

PowerShell 把 `/tmp/...` 解释成当前驱动器根下的 `tmp` 目录（不会自动创建），而 Git Bash 会映射到环境变量 TMP。
如果用 `Move-Item /tmp/foo.py C:..bar.py` 之类的命令做"先备份再恢复"，PowerShell 可能：

- 默默把源文件移动到不存在的位置（导致源文件消失但没报错）
- 或把目标路径拼接成诡异的双前缀（`backend/backend/app/...`）

**结论**：**不要用 `/tmp` 类绝对路径**。要么用 workdir 内的相对路径（`backups/_swap/foo.py`），要么用 Windows 原生 `%TEMP%` 环境变量。

### 2. 项目存在循环 import 风险：`app.models` <-> `app.database`

- `app/database.py` 在文件 **底部** 反向 `from app.models import (...)`，把 Project / Chapter / ... 拉一遍
- `app/models/__init__.py` 第一个 import 又是 `from app.models.project import Project`，而 `project.py` 第一行就 `from app.database import Base`
- 结果：单独 `importlib.import_module('app.models')` 或 `importlib.import_module('app.services.chapter_context_service')` 都会挂在 "circular import" 错误

**正确 smoke 验证姿势**：先 `importlib.import_module('app.main')`（它内部走了完整初始化路径），再 import 目标子模块：

```python
import sys; sys.path.insert(0, '.')
import importlib
importlib.import_module('app.main')  # 兜底
m = importlib.import_module('app.services.chapter_context_service')  # 即可正常
```

**绝对不要**用 `python -c "from app.models.chapter import Chapter"` 之类做 import smoke 验证。

### 3. PowerShell 行内命令写大段 Python heredoc 极不稳定

行内命令（`python -c @'...'@` 或 `python << PYEOF ... PYEOF`）在以下情况会丢字符：

- 包含 `\\` 反斜杠
- 包含中文标点（" " " "）
- 包含三层以上引号嵌套
- 包含 `$variable` 之类 PS 变量替换（PS 会贪婪替换）

**结论**：**所有多步/多行 Python 改动都写 .py 临时文件再 `python xxx.py`**：

```powershell
# -*- coding: utf-8 -*- 的源码写到 .py 文件
@'
# -*- coding: utf-8 -*-
# 改文件代码
'@ | Out-File -Encoding utf8 _step.py
python _step.py
Remove-Item _step.py
```

### 4. 文件改动后一定要二次校验

哪怕 `_t.py` 退出码 0 也不能信。PowerShell 的 Move-Item / 写入偶尔会静默失败（特别是路径含中文或空格时）。

**最小校验三件套**：

```python
import os
p = 'target/file.py'
content = open(p, 'r', encoding='utf-8').read()
print('size:', len(content))
print('has expected marker:', 'expected_string' in content)
```

或者直接用 rg：

```powershell
rg -n 'expected_string' target/file.py
```
