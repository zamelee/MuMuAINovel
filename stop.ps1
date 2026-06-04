# MuMuAINovel 停止脚本
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "正在停止 MuMuAINovel 服务..." -ForegroundColor Yellow

# Stop backend (uvicorn/python)
Get-Process python -ErrorAction SilentlyContinue | Where-Object { 
    $_.MainWindowTitle -match 'uvicorn' -or $_.CommandLine -match 'uvicorn' 
} | Stop-Process -Force -ErrorAction SilentlyContinue

# Stop frontend (node/vite)
Get-Process node -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -match 'vite'
} | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "已停止。" -ForegroundColor Green