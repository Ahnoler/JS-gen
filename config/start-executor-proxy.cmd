@echo off
rem 面向服务器的第二执行机实例（独立于本地调试执行机）
rem 锁/uuid 隔离：uuid 走 env，锁文件 executor/.node-uuid-ee69c022.lock
set EXECUTOR_NODE_UUID=ee69c022-abfb-4dfe-9775-3eefcc99656d
set CONTROL_PLANE_URL=http://47.101.58.49:4097
set EXECUTOR_TOKEN=server1
set EXECUTOR_NAME=local-server-proxy
set EXECUTOR_HOST=local-server-proxy
set EXECUTOR_CDP_PORT_BASE=29242
cd /d D:\dev\JS-gen
node executor/agent.mjs >> logs-executor-server-proxy.log 2>&1
