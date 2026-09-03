@echo off
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
node executor/agent.mjs >> logs-executor-server-proxy.log 2>&1
