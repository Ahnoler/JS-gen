param(
    [switch]$UseMirror    # Use China mirror for faster downloads
)

$scriptRoot = $PSScriptRoot

if ($UseMirror) {
    Write-Host "[INFO] Using China mirror" -ForegroundColor Yellow
    $env:PLAYWRIGHT_DOWNLOAD_HOST = "https://npmmirror.com/mirrors/playwright"
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Build - bundle all deps into project" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# === 1. Node.js portable -> ./nodejs/ ===
Write-Host "[1/5] Node.js portable -> .\nodejs\" -ForegroundColor Yellow
$nodejsDir = Join-Path $scriptRoot "nodejs"
$nodeZip = Join-Path $env:TEMP "node-v22.14.0-win-x64.zip"

if (-not (Test-Path $nodejsDir)) {
    if (-not (Test-Path $nodeZip)) {
        $nodeUrl = "https://nodejs.org/dist/v22.14.0/node-v22.14.0-win-x64.zip"
        Write-Host "  Downloading Node.js 22 portable ..." -ForegroundColor Gray
        Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeZip
    }
    Write-Host "  Extracting ..." -ForegroundColor Gray
    Expand-Archive -Path $nodeZip -DestinationPath $nodejsDir -Force
    # Node zip extracts to a subdirectory; flatten it
    $inner = Get-ChildItem $nodejsDir -Directory | Select-Object -First 1
    if ($inner) {
        Get-ChildItem $inner.FullName | Move-Item -Destination $nodejsDir -Force
        Remove-Item $inner.FullName -Recurse -Force
    }
    Write-Host "  [OK] Node.js ready at .\nodejs\" -ForegroundColor Green
} else {
    Write-Host "  [SKIP] .\nodejs\ exists" -ForegroundColor Gray
}

# === 2. Embedded Python 3.12 -> ./python/ ===
Write-Host "[2/5] Embedded Python 3.12 -> .\python\" -ForegroundColor Yellow
$pythonDir = Join-Path $scriptRoot "python"
$pythonZip = Join-Path $env:TEMP "python-3.12.10-embed-amd64.zip"

if (-not (Test-Path $pythonDir)) {
    if (-not (Test-Path $pythonZip)) {
        Write-Host "  Downloading python-3.12.10-embed-amd64.zip ..." -ForegroundColor Gray
        Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip" -OutFile $pythonZip
    }
    Expand-Archive -Path $pythonZip -DestinationPath $pythonDir -Force
    # Enable site-packages (embedded Python disables it by default)
    $pthFile = Join-Path $pythonDir "python312._pth"
    if (Test-Path $pthFile) {
        $pthContent = Get-Content $pthFile
        $pthContent = $pthContent -replace '#import site', 'import site'
        $pthContent | Set-Content $pthFile
    }
    Write-Host "  [OK] Python ready at .\python\" -ForegroundColor Green
} else {
    Write-Host "  [SKIP] .\python\ exists" -ForegroundColor Gray
}

# === 3. npm dependencies -> ./node_modules/ ===
Write-Host "[3/5] npm dependencies -> .\node_modules\" -ForegroundColor Yellow
$nodeExe = Join-Path $nodejsDir "node.exe"
$npmCmd = Join-Path $nodejsDir "npm.cmd"

if (-not (Test-Path (Join-Path $scriptRoot "node_modules"))) {
    Push-Location $scriptRoot
    if (Test-Path $npmCmd) {
        & $npmCmd install 2>&1 | Out-Null
    } else {
        npm install 2>&1 | Out-Null
    }
    Pop-Location
    Write-Host "  [OK] node_modules installed" -ForegroundColor Green
} else {
    Write-Host "  [SKIP] node_modules exists" -ForegroundColor Gray
}

# === 4. Python deps: bootstrap pip + cache wheels + install ===
Write-Host "[4/5] Python deps -> .\python\ (pip + packages)" -ForegroundColor Yellow
$getPip = Join-Path $scriptRoot "get-pip.py"
$pipDir = Join-Path $scriptRoot "pip-cache"
$reqPath = Join-Path $scriptRoot "scripts\requirements.txt"
$pyExe = Join-Path $pythonDir "python.exe"

# 4a. Download get-pip.py
if (-not (Test-Path $getPip)) {
    Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $getPip
    Write-Host "  [OK] get-pip.py" -ForegroundColor Green
} else {
    Write-Host "  [SKIP] get-pip.py exists" -ForegroundColor Gray
}

# 4b. Bootstrap pip into embedded Python
Write-Host "  Bootstrapping pip ..." -ForegroundColor Gray
& $pyExe $getPip --no-warn-script-location 2>&1 | Out-Null
Write-Host "  [OK] pip ready" -ForegroundColor Green

# 4c. Download wheels to pip-cache
if (Test-Path $reqPath) {
    if (-not (Test-Path (Join-Path $pipDir "*.whl"))) {
        Write-Host "  Downloading wheels to pip-cache ..." -ForegroundColor Gray
        & $pyExe -m pip download -r $reqPath -d $pipDir 2>&1 | Out-Null
        Write-Host "  [OK] pip-cache ($((Get-ChildItem $pipDir -Filter *.whl | Measure-Object).Count) wheels)" -ForegroundColor Green
    } else {
        Write-Host "  [SKIP] pip-cache exists ($((Get-ChildItem $pipDir -Filter *.whl | Measure-Object).Count) wheels)" -ForegroundColor Gray
    }

    # 4d. Install packages into embedded Python
    Write-Host "  Installing packages into .\python\ ..." -ForegroundColor Gray
    & $pyExe -m pip install --no-index --find-links $pipDir -r $reqPath --no-warn-script-location 2>&1 | Out-Null
    Write-Host "  [OK] Python packages installed" -ForegroundColor Green
} else {
    Write-Host "  [WARN] scripts\requirements.txt not found" -ForegroundColor Yellow
}

# === 5. Playwright Chromium -> ./browser/ ===
Write-Host "[5/5] Playwright Chromium -> .\browser\" -ForegroundColor Yellow
$browserDir = Join-Path $scriptRoot "browser"
$env:PLAYWRIGHT_BROWSERS_PATH = $browserDir

if (-not (Test-Path $browserDir)) {
    Write-Host "  Installing Playwright Chromium ... (~350 MB, may take a while)" -ForegroundColor Gray
    Push-Location $scriptRoot
    if (Test-Path $nodeExe) {
        & $nodeExe node_modules\playwright\cli.js install chromium 2>&1 | Out-Null
    } else {
        npx playwright install chromium 2>&1 | Out-Null
    }
    Pop-Location
    if (Test-Path $browserDir) {
        Write-Host "  [OK] .\browser\ ready" -ForegroundColor Green
    } else {
        Write-Host "  [WARN] Playwright install failed (check network)" -ForegroundColor Yellow
    }
} else {
    Write-Host "  [SKIP] .\browser\ exists" -ForegroundColor Gray
}

# === Summary ===
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  All dependencies bundled into project" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Runtime deps:" -ForegroundColor White
$dirs = @(
    @{Path=".\nodejs\";      Desc="Node.js portable"},
    @{Path=".\python\";      Desc="Embedded Python 3.12"},
    @{Path=".\node_modules\";Desc="npm packages"},
    @{Path=".\pip-cache\";   Desc="pip offline wheels"},
    @{Path=".\browser\";     Desc="Playwright Chromium"},
    @{Path=".\get-pip.py";   Desc="pip bootstrapper"}
)
foreach ($d in $dirs) {
    $full = Join-Path $scriptRoot $d.Path
    if (Test-Path $full) {
        $size = if ((Get-Item $full) -is [System.IO.DirectoryInfo]) {
            $total = (Get-ChildItem $full -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
            if ($total -gt 1MB) { "$([math]::Round($total/1MB,1)) MB" } else { "$([math]::Round($total/1KB,0)) KB" }
        } else {
            if ((Get-Item $full).Length -gt 1MB) { "$([math]::Round((Get-Item $full).Length/1MB,1)) MB" } else { "$([math]::Round((Get-Item $full).Length/1KB,0)) KB" }
        }
        Write-Host "  $($d.Path.PadRight(18)) $size  $($d.Desc)" -ForegroundColor Gray
    } else {
        Write-Host "  $($d.Path.PadRight(18)) (missing)  $($d.Desc)" -ForegroundColor Yellow
    }
}
Write-Host ""
Write-Host "The project is self-contained - no external installs needed." -ForegroundColor Green
Write-Host "Next: run NSIS compiler to produce .exe installer" -ForegroundColor Yellow
