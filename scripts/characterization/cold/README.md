# cold/ — 非门禁 characterization 归档（2026-09-08 瘦身）

本目录脚本**不被 `scripts/refactor/verify-all.sh` 执行**。2026-09-08 孤儿对账时从上级目录归档入此：当时上级目录 174 个脚本中仅 96 个注册进门禁，未注册的 78 个里有 5 个已经悄然变红（删 4、menu-import-nine-rules 留上级单独归因），其余 73 个绿但不受保护——归档于此以消除「目录=覆盖率」的错觉。

## 分层

- **环境依赖（真机/DB/浏览器）**：`live-xpath-e2e`、`partner-platform`、`screencast-timing`、`menu-push`、`session-*` 类——在对应环境手动跑。
- **冷区离线 pin**：其余多数——钉的功能稳定且不在引擎主路径，代码改动时按需手动跑。

## 运行方式（与门禁同约定：仓库根目录执行）

```bash
node scripts/characterization/cold/characterize-xxx.mjs
./python/python.exe scripts/characterization/cold/characterize-xxx.py
```

脚本内路径已按 cold/ 深度改写（`parents[3]`、`../../../`）；**从子目录运行会破坏 CWD 相关逻辑**。

## 收编政策

需要重新纳入门禁的脚本：移回上级目录（注意还原相对深度）、在 verify-all.sh 注册、附运行证据。新 characterization 一律落上级目录并注册，不再进本目录。
