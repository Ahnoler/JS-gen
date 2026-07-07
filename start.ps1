param(
    [int]$Port = 4097,
    [switch]$NoBrowser
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Smart Fill System Launcher" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Node.js — check embedded install first, then system PATH
$embeddedNode = Join-Path $PSScriptRoot "nodejs\node.exe"
if (Test-Path $embeddedNode) {
    $nodeCmd = $embeddedNode
    $npmCmd = Join-Path $PSScriptRoot "nodejs\npm.cmd"
    try { $nodeVer = & $nodeCmd --version 2>$null; Write-Host "[OK] Node.js $nodeVer (embedded)" -ForegroundColor Green } catch { Write-Host "[ERROR] Embedded Node.js broken" -ForegroundColor Red; exit 1 }
} else {
    try { $nodeVer = node --version 2>$null; $nodeCmd = "node"; Write-Host "[OK] Node.js $nodeVer (system)" -ForegroundColor Green } catch { Write-Host "[ERROR] Node.js not found" -ForegroundColor Red; exit 1 }
}

# Load .env
$envFile = Join-Path $PSScriptRoot "config\.env"
if (Test-Path $envFile) {
    Write-Host "[OK] Loading config from config\.env" -ForegroundColor Green
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
            $parts = $line.Split('=', 2)
            $k = $parts[0].Trim()
            $v = $parts[1].Trim().Trim('"').Trim("'")
            if ($v) { Set-Item "env:$k" $v }
        }
    }
}

# Python — check embedded install first, then system PATH
if (-not $env:PYTHON_EXE) {
    $embeddedPython = Join-Path $PSScriptRoot "python\python.exe"
    if (Test-Path $embeddedPython) {
        $env:PYTHON_EXE = $embeddedPython
    } else {
        try { $pyVer = python --version 2>$null; if ($pyVer) { $env:PYTHON_EXE = "python" } } catch {}
    }
}
if ($env:PYTHON_EXE) {
    try {
        $pyVer = & $env:PYTHON_EXE --version 2>&1 | ForEach-Object { $_ -replace '^Python ', '' }
        $label = if ($env:PYTHON_EXE -match 'python\\python\.exe$') { '(embedded)' } else { '(system)' }
        Write-Host "[OK] Python $pyVer $label" -ForegroundColor Green
    } catch {}
} else {
    Write-Host "[WARN] Python not found (checked embedded + PATH)" -ForegroundColor Yellow
}

$env:PORT = [string]$Port
$env:HOST = "0.0.0.0"
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $PSScriptRoot "browser"

Write-Host ""
Write-Host ("Starting server on http://localhost:" + $Port + "/api/test") -ForegroundColor White
Write-Host ""

if (-not $NoBrowser) {
    Start-Process ("http://localhost:" + $Port + "/api/test")
}

Set-Location -LiteralPath $PSScriptRoot
& $nodeCmd server.mjs
