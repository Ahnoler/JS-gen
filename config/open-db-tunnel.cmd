@echo off
title JS-gen MySQL SSH tunnel
set SSH_HOST=47.101.58.49
set SSH_USER=root
set LOCAL_PORT=13306
set REMOTE_HOST=127.0.0.1
set REMOTE_PORT=3306
set SSH_EXE=%SystemRoot%\System32\OpenSSH\ssh.exe

echo.
echo ============================================
echo  JS-gen MySQL SSH tunnel
echo  127.0.0.1:%LOCAL_PORT%  --^>  %SSH_USER%@%SSH_HOST%:%REMOTE_PORT%
echo ============================================
echo  Keep this window open while developing.
echo  Close it to drop the database connection.
echo.

if not exist "%SSH_EXE%" (
  echo [error] OpenSSH not found: %SSH_EXE%
  echo Enable Windows Optional Feature: OpenSSH Client
  pause
  exit /b 1
)

netstat -ano | findstr ":%LOCAL_PORT%" | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo [ok] Port %LOCAL_PORT% is already listening. Tunnel is probably up.
  echo You can start the app:  npm start  or  .\start.ps1
  pause
  exit /b 0
)

echo Connecting... enter the SSH password if prompted.
echo After it connects, leave this window open, then start the app.
echo.

"%SSH_EXE%" -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -L %LOCAL_PORT%:%REMOTE_HOST%:%REMOTE_PORT% %SSH_USER%@%SSH_HOST%
set RC=%ERRORLEVEL%

echo.
if not "%RC%"=="0" (
  echo [error] Tunnel exited with code %RC%.
) else (
  echo Tunnel closed.
)
pause
exit /b %RC%
