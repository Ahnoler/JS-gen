@echo off
title JS-gen MySQL whitelist sync
rem Keeps the server iptables whitelist in sync with this PC's egress IP,
rem so the control plane can reach MySQL directly (DB_HOST=47.101.58.49:3306).
rem Engine logic lives in update-db-whitelist.ps1 (same folder).
rem Usage:
rem   double-click            -> sync immediately, then re-sync every 10 min while this window stays open
rem   update-db-whitelist.cmd once  -> single sync then exit (no loop)
rem Close this window (or Ctrl+C) to stop the auto-sync.

setlocal
set PS1=%~dp0update-db-whitelist.ps1
set INTERVAL=600

if not exist "%PS1%" (
  echo [error] update-db-whitelist.ps1 not found: %PS1%
  pause
  exit /b 1
)

echo.
echo ============================================
echo  JS-gen MySQL whitelist sync
echo  server : 47.101.58.49  (mysql 3306)
echo  engine : update-db-whitelist.ps1
echo  mode   : every %INTERVAL%s while this window is open
echo ============================================
echo  Keep this window open while developing.
echo  You do NOT need open-db-tunnel.cmd anymore.
echo.

if /i "%1"=="once" goto RUN
goto RUN

:LOOP
timeout /t %INTERVAL% /nobreak >nul

:RUN
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
if errorlevel 1 (
  echo [%date% %time%] sync FAILED, see config\.db-whitelist-sync.log
) else (
  echo [%date% %time%] sync OK
)
if /i "%1"=="once" (
  pause
  exit /b 0
)
goto LOOP
