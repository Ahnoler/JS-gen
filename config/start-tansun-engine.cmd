@echo off
rem 同事引擎（tansun_ui_engine）本地启动 —— JS-gen 推送链联调
rem 用法：双击=后台启动；命令行带参数 start|stop|restart|status|foreground
rem 详见同行 start-tansun-engine.ps1 头部说明

set ACTION=%~1
if "%ACTION%"=="" set ACTION=start

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-tansun-engine.ps1" %ACTION%
pause
