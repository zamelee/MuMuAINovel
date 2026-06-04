# MuMuAINovel 一键启动脚本
# 双击运行或在终端执行: .\start.ps1
# 需要 PowerShell 7+ (pwsh.exe)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $ScriptDir 'backend'
$FrontendDir = Join-Path $ScriptDir 'frontend'

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  MuMuAINovel 启动中..." -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# 1. 启动后端 (后台窗口，显示日志)
Write-Host "[1/2] 启动后端 (FastAPI :8000)..." -ForegroundColor Yellow

$env:PYTHONIOENCODING = 'utf-8'
$backendPs = Join-Path $BackendDir '.venv\Scripts\python.exe'
$backendArgs = '-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', '8000', '--reload'

$backendProc = Start-Process -FilePath pwsh.exe `
    -ArgumentList @(
        '-NoExit',
        '-Command',
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; `$env:PYTHONIOENCODING='utf-8'; Set-Location '$BackendDir'; Write-Host '后端启动中...' -ForegroundColor Green; & '$backendPs' $($backendArgs -join ' ')"
    ) `
    -WindowStyle Normal `
    -PassThru

Write-Host "  后端 PID: $($backendProc.Id)" -ForegroundColor Gray
Start-Sleep -Seconds 2

# 2. 启动前端 (后台窗口，显示日志)
Write-Host "[2/2] 启动前端 (Vite :5173)..." -ForegroundColor Yellow

$frontendProc = Start-Process -FilePath pwsh.exe `
    -ArgumentList @(
        '-NoExit',
        '-Command',
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Set-Location '$FrontendDir'; Write-Host '前端启动中...' -ForegroundColor Green; npm run dev"
    ) `
    -WindowStyle Normal `
    -PassThru

Write-Host "  前端 PID: $($frontendProc.Id)" -ForegroundColor Gray

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  启动完成!" -ForegroundColor Green
Write-Host "  后端: http://localhost:8000" -ForegroundColor Cyan
Write-Host "  前端: http://localhost:5173" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Green
Write-Host "`n提示: 关闭本窗口不会影响服务运行。要停止服务，请关闭后端和前端窗口。" -ForegroundColor Gray
Write-Host "按任意键退出..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')