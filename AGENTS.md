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
