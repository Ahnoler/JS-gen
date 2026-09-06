# elk-msg-extract — ELK 日志解析 / 报文捞取（MVP）

抓取 ELK(ES) 中 appName=tansun-tcp-cst（对公客户管理）且 msg 含 "===== API Request =====" 的日志，
解析 Request/Response 报文并输出 JSON。

用法示例:

    # 最近 30 分钟全部报文
    node scripts/log-extract/elk-msg-extract.mjs --minutes 30

    # 只捞 /custCorporat 相关接口（子串匹配，大小写不敏感）
    node scripts/log-extract/elk-msg-extract.mjs --minutes 30 --uri /custCorporat --out out/cst.json

    # 指定时间窗口
    node scripts/log-extract/elk-msg-extract.mjs --since 2026-08-26T21:00:00+08:00 --until 2026-08-26T21:30:00+08:00

    # 只打印摘要
    node scripts/log-extract/elk-msg-extract.mjs --minutes 15 --stdout

说明: ES 账号不支持按索引名搜索，脚本使用无索引 /_search（与 Kibana discover 等价）；
时间过滤使用 @timestamp（UTC），输出记录含 logdate（本地 CST）供阅读。

validate-backfill.mjs — 报文→表单回填验证：将 elk-msg-extract 输出的 saveCustCorporat 报文与字段映射样本对齐，产出覆盖率/脱敏/未匹配统计。
用法：node scripts/log-extract/validate-backfill.mjs --input <records.json> --mapping docs/superpowers/specs/saveCustCorporat-field-mapping.json --out <report.json> [--md <report.md>]
