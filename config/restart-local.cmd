@echo off
setlocal EnableExtensions
title JS-gen restart (control plane + executors)

rem ============================================================
rem  Restart local JS-gen services: control plane (server.mjs,
rem  port 4097) + local executor (executor/agent.mjs) + the
rem  second-instance proxy (config\start-executor-proxy.cmd,
rem  registers to the REMOTE server control plane 47.101.58.49).
rem  - Kills existing instances first (matched by node command
rem    line via kill-node-match.ps1; unrelated node apps survive)
rem  - Frees orphan executor Chrome on CDP port 19242
rem  - Starts server first, then executors (documented order)
rem  - Opens one visible "tail" window per service (server/executor)
rem    streaming its log live; close them or Ctrl+C to dismiss. Each
rem    restart opens fresh windows - close stale ones from prior runs.
rem  Logs: tmp\server-main.log / tmp\executor-main.log
rem        (stdout+stderr merged, so tail sees crashes too)
rem ============================================================

set ROOT=%~dp0..
cd /d %ROOT%

echo.
echo [1/4] stopping existing control plane (server.mjs)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\config\kill-node-match.ps1" -Match "server.mjs"

echo [2/4] stopping executors (local + second-instance proxy)...
rem The proxy (config\start-executor-proxy.cmd) runs the same node command
rem line as the local executor, so both are killed and both restarted below.
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\config\kill-node-match.ps1" -Match "agent.mjs"

echo [3/4] freeing CDP port 19242 (orphan executor Chrome, if any)...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":19242 .*LISTENING"') do (
    echo    killing orphan CDP chrome pid %%P
    taskkill /F /PID %%P >nul 2>&1
)

echo [4/4] starting services...
if not exist tmp mkdir tmp
start "JS-gen server" /MIN cmd /c "node server.mjs > tmp\server-main.log 2>&1"
ping -n 7 127.0.0.1 >nul
start "JS-gen executor" /MIN cmd /c "node executor\agent.mjs > tmp\executor-main.log 2>&1"
start "JS-gen executor proxy" /MIN cmd /c ""%ROOT%\config\start-executor-proxy.cmd""

rem Live log viewers: single file per service (native Get-Content -Wait;
rem multi-file -Wait starves every file after the first - verified 09-10).
start "JS-gen server log (tail, close when done)" cmd /k powershell -NoProfile -Command "if(!(Test-Path 'tmp\server-main.log')){New-Item 'tmp\server-main.log' -ItemType File -Force | Out-Null}; Get-Content -Path 'tmp\server-main.log' -Encoding UTF8 -Wait -Tail 40"
start "JS-gen executor log (tail, close when done)" cmd /k powershell -NoProfile -Command "if(!(Test-Path 'tmp\executor-main.log')){New-Item 'tmp\executor-main.log' -ItemType File -Force | Out-Null}; Get-Content -Path 'tmp\executor-main.log' -Encoding UTF8 -Wait -Tail 40"

echo waiting for control plane to listen on 4097...
set /a tries=0
:wait4097
ping -n 3 127.0.0.1 >nul
set /a tries+=1
netstat -ano | findstr /R /C:":4097 .*LISTENING" >nul 2>&1
if errorlevel 1 (
    if %tries% lss 15 goto wait4097
    echo [FAIL] port 4097 not listening after ~30s - check tmp\server-main.log
    exit /b 1
)
findstr /I /C:"EADDRINUSE" tmp\server-main.log >nul 2>&1
if not errorlevel 1 (
    echo [FAIL] EADDRINUSE in server stderr - old process survived, kill it manually
    exit /b 1
)

echo.
echo [OK] control plane + executors restarted.
echo   server log:   tmp\server-main.log  (live tail window opened)
echo   executor log: tmp\executor-main.log  (live tail window opened)
echo   proxy log:    logs-executor-server-proxy.log
exit /b 0
