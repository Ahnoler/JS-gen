param(
    [int]$Port = 4097,
    [switch]$NoBrowser
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  OpenCode Agent API Launcher" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Check Node.js
try {
    $nodeVer = node --version 2>$null
    Write-Host "[OK] Node.js $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Node.js not found. Please install Node.js >= 18" -ForegroundColor Red
    exit 1
}

# Check Python
try {
    $pyVer = & "C:\Program Files\Python312\python.exe" --version 2>$null
    Write-Host "[OK] Python $pyVer (browser_use env)" -ForegroundColor Green
} catch {
    Write-Host "[WARN] Python browser_use env not found at C:\Program Files\Python312\python.exe" -ForegroundColor Yellow
}

# Set environment
$env:PORT = $Port
$env:HOST = "0.0.0.0"
$env:STANDALONE_LLM = "true"
$env:LLM_BASE_URL = "https://api.deepseek.com"
# $env:LLM_API_KEY = "sk-6d59343057ea48b3ac7621705514dca0"
$env:LLM_API_KEY = "sk-1e639c69f0df40e39ba66a8f4786551c"
$env:PYTHON_EXE = "C:\Program Files\Python312\python.exe"

Write-Host ""
Write-Host "Starting server on http://localhost:$Port ..." -ForegroundColor White
Write-Host ""

# Open browser
if (-not $NoBrowser) {
    Start-Process "http://localhost:$Port/api/test"
}

Set-Location -LiteralPath $PSScriptRoot
node server.mjs
