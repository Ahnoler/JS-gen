# start.ps1 — One-click launcher for opencode Agent API
# Starts the Node.js server, opens browser to Dashboard

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

# Check opencode CLI
$ocVer = opencode --version 2>$null
if (-not $ocVer) {
    Write-Host "[WARN] opencode CLI not found. The server may fail to start." -ForegroundColor Yellow
    Write-Host "       Install from: https://opencode.ai" -ForegroundColor Yellow
} else {
    Write-Host "[OK] opencode CLI $ocVer" -ForegroundColor Green
}

# Set environment
$env:PORT = $Port
$env:HOST = "0.0.0.0"

Write-Host ""
Write-Host "Starting server on http://localhost:$Port ..." -ForegroundColor White
Write-Host ""

# Open browser after a short delay
if (-not $NoBrowser) {
    Start-Process -FilePath "http://localhost:$Port" -WindowStyle Hidden
}

# Start Node.js server
Set-Location -LiteralPath $PSScriptRoot
node server.mjs
