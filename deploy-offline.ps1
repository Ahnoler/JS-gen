param([string]$ProjectRoot = "C:\atp-gen")

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

Write-Host "================================" -ForegroundColor Cyan
Write-Host "  Offline Deploy" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# 0. Check VC++ Redistributable（解决 DLL load failed）
try {
    $vcReg = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" -ErrorAction Stop
    Write-Host "[OK] VC++ Redistributable found (v$($vcReg.Bld))" -ForegroundColor Green
} catch {
    $vcExe = Join-Path $ScriptDir "VC_redist.x64.exe"
    if (Test-Path $vcExe) {
        Write-Host "[WARN] VC++ Redistributable not found. Installing..." -ForegroundColor Yellow
        Start-Process -FilePath $vcExe -ArgumentList "/install", "/quiet", "/norestart" -Wait
        Write-Host "  [OK] VC++ installed (reboot may be required later)" -ForegroundColor Green
    } else {
        Write-Host "[WARN] VC++ Redistributable not found. Download VC_redist.x64.exe and install manually if you see DLL errors." -ForegroundColor Yellow
    }
}

# 1. Extract project source
if (-not (Test-Path $ProjectRoot)) {
    New-Item -ItemType Directory -Path $ProjectRoot -Force | Out-Null
    Expand-Archive -Path (Join-Path $ScriptDir "project-source.zip") -DestinationPath $ProjectRoot -Force
    Write-Host "[OK] Project source extracted to $ProjectRoot" -ForegroundColor Green
} else { Write-Host "[SKIP] Project source exists at $ProjectRoot" -ForegroundColor Gray }

# 2. Extract node_modules
$nmPath = Join-Path $ProjectRoot "node_modules"
if (-not (Test-Path $nmPath)) {
    Expand-Archive -Path (Join-Path $ScriptDir "node_modules.zip") -DestinationPath $ProjectRoot -Force
    Write-Host "[OK] Node dependencies extracted" -ForegroundColor Green
} else { Write-Host "[SKIP] node_modules exists" -ForegroundColor Gray }

# 3. Extract Playwright browsers (Node.js)
$pwPath = "$env:USERPROFILE\AppData\Local\ms-playwright"
$pwNodeZip = Join-Path $ScriptDir "ms-playwright-node.zip"
if (Test-Path $pwNodeZip) {
    New-Item -ItemType Directory -Path (Split-Path $pwPath -Parent) -Force | Out-Null
    Expand-Archive -Path $pwNodeZip -DestinationPath (Split-Path $pwPath -Parent) -Force
    Write-Host "[OK] Node.js Playwright browsers extracted" -ForegroundColor Green
} else { Write-Host "[SKIP] No Node.js Playwright browsers found" -ForegroundColor Gray }

# 4. Extract Playwright browsers (Python)
$pwPyZip = Join-Path $ScriptDir "ms-playwright-python.zip"
if (Test-Path $pwPyZip) {
    New-Item -ItemType Directory -Path (Split-Path $pwPath -Parent) -Force | Out-Null
    Expand-Archive -Path $pwPyZip -DestinationPath (Split-Path $pwPath -Parent) -Force
    Write-Host "[OK] Python Playwright browsers extracted" -ForegroundColor Green
} else { Write-Host "[SKIP] No Python Playwright browsers found" -ForegroundColor Gray }

# 5. Install Python packages (跳过下载浏览器，使用已解压的)
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1"
$pipDir = Join-Path $ScriptDir "pip-cache"
$reqPath = Join-Path $ProjectRoot "web-ui\requirements.txt"
if ((Test-Path $pipDir) -and (Test-Path $reqPath)) {
    pip install --no-index --find-links $pipDir -r $reqPath
    Write-Host "[OK] Python dependencies installed" -ForegroundColor Green
} else { Write-Host "[SKIP] pip install skipped (no pip-cache or requirements.txt)" -ForegroundColor Gray }

Write-Host "================================" -ForegroundColor Cyan
Write-Host "  Deploy complete!" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. cd $ProjectRoot" -ForegroundColor Gray
Write-Host "  2. Edit start.ps1 - update LLM_API_KEY and PYTHON_EXE" -ForegroundColor Gray
Write-Host "  3. .\start.ps1" -ForegroundColor Gray
Write-Host "  4. Open http://localhost:4097/api/test" -ForegroundColor Gray
Write-Host ""
Write-Host "Troubleshooting:" -ForegroundColor Yellow
Write-Host "  - DLL load failed: Install VC_redist.x64.exe and reboot" -ForegroundColor Gray
Write-Host "  - Browser not found: Check pwPath above is correct" -ForegroundColor Gray
Write-Host "  - Python not found: Ensure Python is in PATH" -ForegroundColor Gray
