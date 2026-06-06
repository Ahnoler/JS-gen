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
    $pyVer = & "D:\anaconda3\envs\browser_use\python.exe" --version 2>$null
    Write-Host "[OK] Python $pyVer (browser_use env)" -ForegroundColor Green
} catch {
    Write-Host "[WARN] Python browser_use env not found at D:\anaconda3\envs\browser_use\python.exe" -ForegroundColor Yellow
}

# Set environment
$env:PORT = $Port
$env:HOST = "0.0.0.0"
$env:STANDALONE_LLM = "true"
$env:LLM_BASE_URL = "http://218.77.58.156:3000/v1"
$env:LLM_API_KEY = "sk-doztyto0q15adCFi17IVjN4oQ1j6p31fLYVWkqCHgteJkDcP"
$env:PYTHON_EXE = "D:\anaconda3\envs\browser_use\python.exe"

Write-Host ""
Write-Host "Starting server on http://localhost:$Port ..." -ForegroundColor White
Write-Host ""

# Open browser
if (-not $NoBrowser) {
    Start-Process "http://localhost:$Port/api/test"
}

Set-Location -LiteralPath $PSScriptRoot
node server.mjs
