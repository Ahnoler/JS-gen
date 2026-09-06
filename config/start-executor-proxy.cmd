@echo off
title JS-gen executor proxy (server 47.101.58.49)

rem Second executor instance registering to the server control plane
rem (isolated from the local debug executor: uuid via env, CDP port base 29242)
rem Lock file: executor/.node-uuid-ee69c022.lock

set EXECUTOR_NODE_UUID=ee69c022-abfb-4dfe-9775-3eefcc99656d
set CONTROL_PLANE_URL=http://47.101.58.49:4097
set EXECUTOR_TOKEN=server1
set EXECUTOR_NAME=local-server-proxy
set EXECUTOR_HOST=local-server-proxy
set EXECUTOR_CDP_PORT_BASE=29242
cd /d D:\dev\JS-gen

echo.
echo ============================================
echo  JS-gen executor proxy -= local-server-proxy
echo  control plane: %CONTROL_PLANE_URL%  (ws path /ws/executor)
echo  uuid=%EXECUTOR_NODE_UUID:~0,8%  cdp=%EXECUTOR_CDP_PORT_BASE%+slot
echo ============================================
echo  Console output is muted (goes to log).
echo  Log: D:\dev\JS-gen\logs-executor-server-proxy.log
echo  Tail the log in another terminal:
echo    powershell -Command Get-Content logs-executor-server-proxy.log -Wait -Tail 20
echo  Stop: close this window (or Ctrl+C).
echo.

node executor/agent.mjs >> logs-executor-server-proxy.log 2>&1

echo.
echo [exit] executor proxy exited with code %ERRORLEVEL%. Check the log.
pause
