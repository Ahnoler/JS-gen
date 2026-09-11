@echo off
title JS-gen control-plane release
rem ======================= Usage =======================
rem What : pack the backend control plane and release it to the test
rem        server 47.101.58.49 (node server.mjs on :4097).
rem How  : double-click, or run `release-backend.cmd` from any shell.
rem Needs: 1) passwordless SSH to root@47.101.58.49 (BatchMode: fails fast
rem           on missing key, never hangs on a password prompt)
rem        2) node/npm, git, Git Bash (bash) on PATH
rem        3) pack list = pack-control-plane.sh (excludes config/.env,
rem           executor/, scripts/ - executor code runs on THIS PC; update it
rem           separately via git pull + executor restart, not by this release)
rem        4) remote logic lives next to this file in
rem           release-backend-remote.sh and is scp'd + executed on the server
rem Notes:
rem   - uncommitted control-plane changes are listed and need Y/N
rem     confirmation (they ARE included in the bundle)
rem   - failures in the prepare phase (extract/npm ci/migrate) leave the old
rem     release untouched; a failure AFTER the symlink flip needs rollback =
rem     flip the symlink back + restart (hint printed on failure)
rem   - server keeps the newest 3 releases, older ones auto-pruned
rem   - IMPORTANT: restarting :4097 disconnects the executor - reconnect it
rem     before the next recording session
rem =====================================================
setlocal EnableDelayedExpansion
set HOST=47.101.58.49
set REMOTE_SH=release-backend-remote.sh
set SSHCMD=ssh -o BatchMode=yes -o ConnectTimeout=15 root@%HOST%
set SCPCMD=scp -o BatchMode=yes -o ConnectTimeout=15
cd /d "%~dp0"

echo.
echo ============================================
echo  JS-gen control-plane release
echo  server : %HOST%  (:4097, symlink /data/app/JS-gen)
echo  flow   : pack -^> upload -^> extract+.env+deps+migrate
echo           -^> symlink -^> restart 4097 -^> verify
echo  rollback : flip symlink back to previous release + restart
echo ============================================
echo.

rem --- 1. show what will be shipped -------------------------------------------
for /f "delims=" %%H in ('git log -1 --oneline 2^>nul') do set HEADLINE=%%H
if not defined HEADLINE (
  echo [error] not a git repo or git unavailable: %CD%
  goto fail
)
echo HEAD: %HEADLINE%

set DIRTY=
for /f "delims=" %%F in ('git diff HEAD --name-only -- src/ config/ migrations/ server.mjs package.json package-lock.json 2^>nul') do set "DIRTY=!DIRTY! %%F"
if defined DIRTY (
  echo [warn] uncommitted control-plane changes will be INCLUDED in the bundle:
  git diff HEAD --stat -- src/ config/ migrations/ server.mjs package.json package-lock.json
  echo.
  choice /c YN /n /m "Ship anyway? [Y=continue / N=abort] "
  if errorlevel 2 (
    echo aborted by user.
    goto fail
  )
)
if not exist "%REMOTE_SH%" (
  echo [error] remote script %REMOTE_SH% not found next to this script.
  goto fail
)

rem --- 2. pack (single source of truth = pack-control-plane.sh) -----------------
rem The pack script names its output with `date +%Y%m%d-%H%M%S`; we require the
rem newest tarball to carry the timestamp we just stamped, else refuse to deploy.
for /f %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set TS=%%T
if not defined TS (
  echo [error] cannot generate timestamp ^(powershell unavailable^).
  goto fail
)
where bash >nul 2>nul && (set BASH=bash) || (set BASH=C:\Program Files\Git\bin\bash.exe)
echo.
echo [1/4] packing via pack-control-plane.sh (ts=%TS%) ...
"%BASH%" pack-control-plane.sh
if errorlevel 1 (
  echo [error] pack failed - stopped, server untouched.
  goto fail
)
set TGZ=
for /f "delims=" %%P in ('dir /b /o-d dist\JS-gen-control-plane-*.tar.gz') do if not defined TGZ set TGZ=%%P
if not defined TGZ (
  echo [error] no JS-gen-control-plane-*.tar.gz found in dist\.
  goto fail
)
echo !TGZ! | find "%TS%" >nul
if errorlevel 1 (
  echo [error] newest tarball "!TGZ!" does not match timestamp %TS% - refusing to deploy a stale pack.
  goto fail
)
echo packed: !TGZ!

rem --- 3. upload ----------------------------------------------------------------
echo.
echo [2/4] uploading ...
%SCPCMD% "dist\!TGZ!" root@%HOST%:/tmp/!TGZ!
if errorlevel 1 (
  echo [error] scp failed - check SSH key auth ^(BatchMode never prompts for a password^).
  goto fail
)
%SCPCMD% "%REMOTE_SH%" root@%HOST%:/tmp/%REMOTE_SH%
if errorlevel 1 (
  echo [error] scp failed for %REMOTE_SH%.
  goto fail
)

rem --- 4. deploy + restart + verify ----------------------------------------------
echo.
echo [3/4] deploying release %TS% on server ...
%SSHCMD% "bash /tmp/%REMOTE_SH% %TS% !TGZ!"
if errorlevel 1 (
  echo [error] server-side deploy/verify failed - release NOT completed.
  echo Rollback: ssh root@%HOST% "ln -sfn /data/app/JS-gen-releases/^<previous^> /data/app/JS-gen; cd /data/app/JS-gen; setsid nohup node server.mjs ^>^> server.log 2^>^&1 ^< /dev/null ^&"
  goto fail
)

echo.
echo [4/4] done.
echo.
echo ============================================
echo  DONE. release %TS% live on %HOST%:4097
echo  NOTE: reconnect the executor before the next recording session.
echo ============================================
echo.
pause
exit /b 0

:fail
echo.
echo Release NOT completed ^(if the server is in a bad state, use the
echo rollback command printed above^).
pause
exit /b 1
