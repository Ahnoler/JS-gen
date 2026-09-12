# 同事引擎（tansun_ui_engine）本地开发态启动 —— 与 JS-gen 推送链联调用
#
# 与同事仓 scripts/start-windows.ps1 的区别：那个是离线部署包路径（要求 wheelhouse /
# requirements.lock / playwright-browsers），开发态用仓内 .venv + python -m ui_execute。
#
# 用法：
#   powershell -File config\start-tansun-engine.ps1 start        # 后台启动（默认）
#   powershell -File config\start-tansun-engine.ps1 foreground   # 前台启动（看实时日志）
#   powershell -File config\start-tansun-engine.ps1 status
#   powershell -File config\start-tansun-engine.ps1 stop
#   或直接双击 config\start-tansun-engine.cmd
#
# 日志：D:\dev\tansun_ui_engine\logs\local-dev.out.log / local-dev.err.log
# PID ：D:\dev\JS-gen\config\.tansun-engine.pid

param(
    [Parameter(Position = 0)]
    [ValidateSet("start", "stop", "restart", "status", "foreground")]
    [string]$Action = "start"
)

$ErrorActionPreference = "Stop"

$EngineDir = "D:\dev\tansun_ui_engine"
$Python = Join-Path $EngineDir ".venv\Scripts\python.exe"
$PidFile = Join-Path $PSScriptRoot ".tansun-engine.pid"
$LogDir = Join-Path $EngineDir "logs"
$OutLog = Join-Path $LogDir "local-dev.out.log"
$ErrLog = Join-Path $LogDir "local-dev.err.log"

$EngineHost = "127.0.0.1"
$EnginePort = 8000

# 本机对 ATP（172.19.87.169）的出口 IP；换网络环境需同步改这里
$ExecuteIp = "2.0.1.8"

function Get-EnginePid {
    if (-not (Test-Path $PidFile)) { return $null }
    $value = Get-Content $PidFile -ErrorAction SilentlyContinue
    $procId = 0
    if (-not [int]::TryParse($value, [ref]$procId)) { return $null }
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($null -ne $proc) { return $procId }
    Remove-Item $PidFile -ErrorAction SilentlyContinue
    return $null
}

function Set-EngineEnv {
    # 引擎 HTTP 监听：只绑本机，避免同网段其他机器误连
    $env:SERVER_HOST = $EngineHost
    $env:SERVER_PORT = "$EnginePort"
    # 有头浏览器：联调时肉眼可核对执行过程
    $env:BROWSER_HEADLESS = "false"
    # ATP 调度注册：注册 + 心跳开；自动 Pull 关（防止抢占 ATP 上他人排队的任务）
    # 需要联调「自动拉取」时把 SCHEDULER_PULL_LOOP_ENABLED 改成 true，
    # 或改用 POST /api/scheduler/manual-pull 走调试槽位单次拉取。
    $env:SCHEDULER_ENABLED = "true"
    $env:SCHEDULER_BASE_URL = "http://test.atp.tansun.com.cn/"
    $env:SCHEDULER_EXECUTE_IP = $ExecuteIp
    $env:SCHEDULER_PULL_LOOP_ENABLED = "false"
    # SCHEDULER_API_KEY 不在此设置：沿用引擎仓 config.py 的默认值，避免密钥落到本仓
    $env:ENGINE_LOG_DIR = Join-Path $EngineDir "logs"
}

function Wait-ForHttp {
    for ($i = 0; $i -lt 30; $i++) {
        try {
            Invoke-WebRequest -Uri "http://$EngineHost`:$EnginePort/health" -UseBasicParsing -TimeoutSec 2 | Out-Null
            return $true
        } catch {
            if (-not (Get-EnginePid)) { return $false }
            Start-Sleep -Seconds 1
        }
    }
    return $false
}

function Start-Engine {
    $existing = Get-EnginePid
    if ($existing) {
        Write-Host "引擎已在运行。PID: $existing"
        return
    }
    if (-not (Test-Path $Python)) {
        Write-Host "找不到引擎 venv：$Python" -ForegroundColor Red
        exit 1
    }
    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

    Set-EngineEnv
    Write-Host "启动 tansun_ui_engine（$EngineHost`:$EnginePort，ATP 注册开 / 自动 Pull 关）..."
    $proc = Start-Process -FilePath $Python `
        -ArgumentList "-m", "ui_execute" `
        -WorkingDirectory $EngineDir `
        -RedirectStandardOutput $OutLog `
        -RedirectStandardError $ErrLog `
        -WindowStyle Hidden `
        -PassThru
    Set-Content -Path $PidFile -Value $proc.Id

    if (Wait-ForHttp) {
        Write-Host "引擎已就绪。PID: $($proc.Id)"
        Write-Host "  health : http://$EngineHost`:$EnginePort/health"
        Write-Host "  docs   : http://$EngineHost`:$EnginePort/docs"
        Write-Host "  handlers: http://$EngineHost`:$EnginePort/api/handlers"
        Write-Host "  日志   : $OutLog"
    } else {
        Write-Host "引擎进程起了但端口未就绪，查日志：$ErrLog" -ForegroundColor Red
        if (Test-Path $ErrLog) { Get-Content $ErrLog -Tail 30 }
        exit 1
    }
}

function Stop-Engine {
    $procId = Get-EnginePid
    if (-not $procId) {
        Write-Host "引擎未在运行（无 PID 文件）。"
        return
    }
    Write-Host "停止引擎。PID: $procId"
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($proc) {
        Stop-Process -Id $procId -ErrorAction SilentlyContinue
        if (-not $proc.WaitForExit(15000)) {
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item $PidFile -ErrorAction SilentlyContinue
    Write-Host "已停止。"
}

switch ($Action) {
    "start" { Start-Engine }
    "stop" { Stop-Engine }
    "restart" { Stop-Engine; Start-Sleep -Seconds 2; Start-Engine }
    "status" {
        $procId = Get-EnginePid
        if ($procId) {
            Write-Host "引擎运行中。PID: $procId  →  http://$EngineHost`:$EnginePort"
        } else {
            Write-Host "引擎未运行。"
        }
    }
    "foreground" {
        Set-EngineEnv
        Write-Host "前台启动 tansun_ui_engine（Ctrl+C 退出）..."
        & $Python -m ui_execute
    }
}
