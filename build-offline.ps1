param(
    [string]$OutputDir = "D:\offline-deploy",
    [switch]$UseMirror    # 中国内地使用镜像加速下载
)

$OutputDir = New-Item -ItemType Directory -Path $OutputDir -Force | Select-Object -ExpandProperty FullName
$scriptRoot = $PSScriptRoot

# 国内镜像（解决下载超时/断连问题）
if ($UseMirror) {
    Write-Host "[INFO] Using China mirror for Playwright downloads" -ForegroundColor Yellow
    $env:PLAYWRIGHT_DOWNLOAD_HOST = "https://npmmirror.com/mirrors/playwright"
}

Write-Host "================================" -ForegroundColor Cyan
Write-Host "  Build Offline Deploy Package" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# 1. Node.js MSI
$nodeMsi = Join-Path $OutputDir "node-v22.msi"
if (-not (Test-Path $nodeMsi)) {
    Write-Host "[1/7] Downloading Node.js 22 MSI ..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi" -OutFile $nodeMsi
    Write-Host "  [OK]" -ForegroundColor Green
} else { Write-Host "  [SKIP] exists" -ForegroundColor Gray }

# 2. Python 3.12
$pythonExe = Join-Path $OutputDir "python-3.12.10-amd64.exe"
if (-not (Test-Path $pythonExe)) {
    Write-Host "[2/7] Downloading Python 3.12.10 ..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe" -OutFile $pythonExe
    Write-Host "  [OK]" -ForegroundColor Green
} else { Write-Host "  [SKIP] exists" -ForegroundColor Gray }

# 3. VC++ Redistributable（解决 DLL load failed 问题）
$vcRedist = Join-Path $OutputDir "VC_redist.x64.exe"
if (-not (Test-Path $vcRedist)) {
    Write-Host "[3/7] Downloading VC++ Redistributable 2022 ..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://aka.ms/vs/17/release/vc_redist.x64.exe" -OutFile $vcRedist
    Write-Host "  [OK]" -ForegroundColor Green
} else { Write-Host "  [SKIP] exists" -ForegroundColor Gray }

# 4. npm dependencies
$nodeZip = Join-Path $OutputDir "node_modules.zip"
if (-not (Test-Path $nodeZip)) {
    Write-Host "[4/7] npm ci + packaging node_modules ..." -ForegroundColor Yellow
    Push-Location $scriptRoot
    npm ci
    if (Test-Path "node_modules") { Compress-Archive -Path "node_modules" -DestinationPath $nodeZip -Force }
    Pop-Location
    Write-Host "  [OK]" -ForegroundColor Green
} else { Write-Host "  [SKIP] exists" -ForegroundColor Gray }

# 5. pip cache
$pipDir = Join-Path $OutputDir "pip-cache"
$reqPath = Join-Path $scriptRoot "web-ui\requirements.txt"
if ((Test-Path $reqPath) -and -not (Test-Path (Join-Path $pipDir "*.whl"))) {
    Write-Host "[5/7] Downloading pip packages ..." -ForegroundColor Yellow
    pip download -r $reqPath -d $pipDir
    Write-Host "  [OK]" -ForegroundColor Green
} elseif (-not (Test-Path $reqPath)) {
    Write-Host "  [SKIP] no requirements.txt" -ForegroundColor Gray
} else { Write-Host "  [SKIP] exists" -ForegroundColor Gray }

# 6. Playwright browsers (Node.js)
$pwNodeZip = Join-Path $OutputDir "ms-playwright-node.zip"
$pwDir = "$env:USERPROFILE\AppData\Local\ms-playwright"
if (-not (Test-Path $pwNodeZip)) {
    Write-Host "[6/7] Installing Playwright Chromium (Node.js) ..." -ForegroundColor Yellow
    Push-Location $scriptRoot
    npx playwright install chromium 2>&1 | Out-Null
    Pop-Location
    if (Test-Path $pwDir) {
        Compress-Archive -Path $pwDir -DestinationPath $pwNodeZip -Force
        Write-Host "  [OK] Node.js browsers packaged" -ForegroundColor Green
    } else {
        Write-Host "  [WARN] Node.js Playwright install failed" -ForegroundColor Yellow
    }
} else { Write-Host "  [SKIP] exists" -ForegroundColor Gray }

# 7. Playwright browsers (Python)
$pwPyZip = Join-Path $OutputDir "ms-playwright-python.zip"
if (-not (Test-Path $pwPyZip)) {
    Write-Host "[7/7] Installing Playwright Chromium (Python) ..." -ForegroundColor Yellow
    # 安装 Python Playwright CLI（如果尚未安装）
    python -m playwright install chromium 2>&1 | Out-Null
    if (Test-Path $pwDir) {
        Compress-Archive -Path $pwDir -DestinationPath $pwPyZip -Force
        Write-Host "  [OK] Python browsers packaged" -ForegroundColor Green
    } else {
        Write-Host "  [WARN] Python Playwright install failed" -ForegroundColor Yellow
    }
} else { Write-Host "  [SKIP] exists" -ForegroundColor Gray }

# Project source
$srcZip = Join-Path $OutputDir "project-source.zip"
if (-not (Test-Path $srcZip)) {
    Write-Host "[*] Packaging project source ..." -ForegroundColor Yellow
    $items = Get-ChildItem -Path $scriptRoot -Exclude @('node_modules', '.git', '.idea', '__pycache__', '*.log', '.ruff_cache')
    Compress-Archive -Path $items.FullName -DestinationPath $srcZip -Force
    Write-Host "  [OK]" -ForegroundColor Green
}

# Copy deploy script
Copy-Item (Join-Path $scriptRoot "deploy-offline.ps1") (Join-Path $OutputDir "deploy-offline.ps1") -Force

Write-Host "================================" -ForegroundColor Cyan
Write-Host "  Done! Offline package at: $OutputDir" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Green
Write-Host ""
Write-Host "Contents:" -ForegroundColor White
Get-ChildItem $OutputDir | ForEach-Object {
    if ($_.PSIsContainer) {
        $totalSize = (Get-ChildItem $_.FullName -Recurse | Measure-Object -Property Length -Sum).Sum
        $size = if ($totalSize -gt 1MB) { "$([math]::Round($totalSize/1MB,1)) MB" } else { "$([math]::Round($totalSize/1KB,0)) KB" }
    } else {
        $size = if ($_.Length -gt 1MB) { "$([math]::Round($_.Length/1MB,1)) MB" } else { "$([math]::Round($_.Length/1KB,0)) KB" }
    }
    Write-Host "  - $($_.Name) (${size})" -ForegroundColor Gray
}
