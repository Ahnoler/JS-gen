# saveCustCorporat 字段映射（表单标签 ↔ 接口字段）

> 日期：2026-08-25
> 数据来源：对公客户概况页保存按钮触发的 `POST .../custCorporat/saveCustCorporat` 接口
> 用途：作为自动化填写的字段映射数据

---

## 1. 接口信息

| 项 | 值 |
|----|-----|
| Method | POST |
| URL | `/prod-api/tansun-tcp-app-pc/tansun-tcp-cst/custCorporat/saveCustCorporat` |
| Content-Type | application/json;charset=UTF-8 |
| 自定义头 | `token`(JWT) / `pdcmptecd`(ZJJK00104640) / `g-version`(v1) |
| 响应 | `{"status":200,"description":"操作成功","errorCode":"000000000000"}` |

## 2. 页面信息

| 项 | 值 |
|----|-----|
| 页面 | 天阳宏业信贷系统 - 对公客户管理 - 创建对公客户信息 |
| Tab | 客户基本信息 |
| Collapse | 对公客户概况 |
| URL | `http://test.creditv5p2.tansun.com.cn/#/cstMgt/csinfMntSubDmn/cpctMgt/crtCpctInf/hostCstmgrCrtCpctInf` |

---

## 3. 字段映射表

> **值匹配说明**：
> - `exact` = DOM 显示值与 API 值完全一致
> - `code` = DOM 显示中文标签，API 存码值（select 控件）
> - `format` = DOM 有千分位格式化，API 为原始数值
> - `datetime` = DOM 仅日期，API 含 `00:00:00` 时间部分

### 3.1 基本信息（42 字段）

| # | 表单标签 | API 字段 | API 值 | DOM 显示值 | 类型 | 禁用 | 匹配 |
|---|---------|----------|--------|-----------|------|------|------|
| 1 | 客户编号 | cstNo | 26081317115618826 | 26081317115618826 | textbox | ✓ | exact |
| 2 | 客户名称 | cstNm | 鑫瑞丰禾农业开发有限公司 | 鑫瑞丰禾农业开发有限公司 | textbox | ✓ | exact |
| 3 | 对公客户类型 | cpctTp | 601 | 企业类 | select | ✓ | code |
| 4 | 证件类型 | crdtTp | 20111 | 营业执照 | select | ✓ | code |
| 5 | 证件号码 | crdtNo | 91330100MA27XW8T3R | 91330100MA27XW8T3R | textbox | ✓ | exact |
| 6 | 客户简称 | cstShrtnm | 500106200403137035 | 500106200403137035 | textbox | | exact |
| 7 | 国别 | nat | CHN | 中华人民共和国 | select | | code |
| 8 | 外文名称 | frgnlangNm | Test Customer | Test Customer | textbox | | exact |
| 9 | 异地客户标志 | diffplcCstInd | 0 | 否 | select | | code |
| 10 | 投资主体 | ivsSbjTp | 1 | 法人投资 | select | | code |
| 11 | 隶属关系标识 | affilRelId | 99 | 其他 | select | | code |
| 12 | 控股经济类型 | hldgEcnTp | B0102 | 私人绝对控股 | select | | code |
| 13 | 行业代码 | idyCd | A0131 | 棉花种植 | textbox | | code |
| 14 | 扶持类企业标志 | sprtCgyEntpInd | 0 | 否 | select | | code |
| 15 | 上年度从业人数 | lastyrCrerPnum | 21856 | 21856 | textbox | ✓ | exact |
| 16 | 上年度资产总额（元）| lastyrAstTamt | 2026.00 | 2,026.00 | textbox | ✓ | format |
| 17 | 上年度营业收入（元）| lastyrOprgIncm | 3188358.04 | 3,188,358.04 | textbox | ✓ | format |
| 18 | 企业规模 | entpSz | 03 | 小型企业 | select | | code |
| 19 | 国民经济部门 | nalEcnDept | C | 非金融企业部门 | select | | code |
| 20 | 国民经济部门类别 | nalEcnDeptCgy | C99 | 其他非金融企业部门 | select | | code |
| 21 | 六大高耗能企业标志 | topsixHighEnrgEntpInd | 0 | 否 | select | | code |
| 22 | 政府平台标志 | govtPltfrmInd | 0 | 否 | select | | code |
| 23 | 项目法人标志 | prjLglpsnInd | 0 | 否 | select | | code |
| 24 | 是否供应链金融企业 | splchainFncEntpInd | 0 | 否 | select | | code |
| 25 | 评级客户分类标识 | rtgCstClId | | | select | | - |
| 26 | 是否新型农业经营主体 | newTypAgriOpsbjInd | 0 | 否 | select | | code |
| 27 | 是否科创型企业 | sciinnoTypEntpInd | 0 | 否 | select | | code |
| 28 | 有中征码标志 | extCncredCdInd | 0 | 否 | select | | code |
| 29 | 机构信用代码 | instCrCdEcd | 8635944469 | 8635944469 | textbox | | exact |
| 30 | 征信首贷客户标志 | crFirstLoanCstInd | | | select | ✓ | - |
| 31 | 上市公司标志 | lstdCoInd | 0 | 否 | select | | code |
| 32 | 龙头企业 | ldingEntpInd | 9 | 非龙头企业 | select | ✓ | code |
| 33 | 与本行关系 | corpRelTp | 1 | 普通客户 | select | | code |
| 34 | 与我行合作关系类型 | withCcbCoRelTp | 3 | 一般 | select | | code |
| 35 | 财务部联系人 | fncDeptCtcpsnNm | 周强刚 | 周强刚 | textbox | | exact |
| 36 | 财务部联系人身份证号码 | fncDeptCtcpsnIdno | 130300197704191122 | 130300197704191122 | textbox | | exact |
| 37 | 财务部联系人手机号归属人关系类型 | fncDeptCtcpsnMpnbpRelTp | 100 | 本人 | select | | code |
| 38 | 财务部联系人手机号码（短信通知）| fncDeptCtcpsnMblphNo | 18045033518 | 18045033518 | textbox | | exact |
| 39 | 单位电话 | fncDeptCtcpsnUnitTel | 01032756258 | 01032756258 | textbox | | exact |
| 40 | 单位地址邮政编码 | unitAdrZipecd | 200001 | 200001 | textbox | | exact |
| 41 | 单位地址 | unitAdr | 广州市天河区解放路21号 | 广州市天河区解放路21号 | textbox | | exact |
| 42 | 单位Email | email | test561@company.cn | test561@company.cn | textbox | | exact |
| 43 | 是否为一般纳税人 | comTaxpyrInd | 1 | 是 | select | | code |

### 3.2 基本户信息（5 字段）

| # | 表单标签 | API 字段 | API 值 | DOM 显示值 | 类型 | 禁用 | 匹配 |
|---|---------|----------|--------|-----------|------|------|------|
| 44 | 基本存款账户是否在法人行 | bscDepAccExstAgricoopInstInd | 1 | 是 | select | | code |
| 45 | 基本户状态 | bscaccSt | 1 | 正常 | select | | code |
| 46 | 基本存款账户开户行 | bscaccDpbknm | 中国工商银行 | 中国工商银行 | textbox | | exact |
| 47 | 基本存款账户账号 | bscaccAcctno | 62220264709866 | 62220264709866 | textbox | | exact |
| 48 | 基本户开户日期 | bscaccOpnaccDt | 2016-08-13 00:00:00 | 2016-08-13 | date | | datetime |

### 3.3 评级信息（5 字段，4 个来自其他接口）

| # | 表单标签 | API 字段 | API 值 | DOM 显示值 | 类型 | 禁用 | 匹配 |
|---|---------|----------|--------|-----------|------|------|------|
| 49 | 认定等级 | — | — | | select | ✓ | 外部接口 |
| 50 | 认定评分 | — | — | | textbox | ✓ | 外部接口 |
| 51 | 评级认定日期 | — | — | | date | ✓ | 外部接口 |
| 52 | 评级到期日期 | — | — | | date | ✓ | 外部接口 |
| 53 | 备注 | rmrk | 系统自动生成测试数据 | 系统自动生成测试数据 | textarea | | exact |

> 评级信息中「认定等级/评分/日期」由 `getRatingResult` 接口回填，不在 `saveCustCorporat` 请求体中。

### 3.4 登记信息（27 字段）

| # | 表单标签 | API 字段 | API 值 | DOM 显示值 | 类型 | 禁用 | 匹配 |
|---|---------|----------|--------|-----------|------|------|------|
| 54 | 统一社会信用代码 | uscc | 912204001581778690 | 912204001581778690 | textbox | | exact |
| 55 | 登记注册号类型 | rgsRgstNoTp | 6 | 统一社会信用代码 | select | | code |
| 56 | 登记注册号 | wrkBusiRgsRgstNo | 91330100MA27XW8T3R | 91330100MA27XW8T3R | textbox | | exact |
| 57 | 注册地为开发区标识 | rgstLandIsDvlpZonId | 0 | 否 | select | | code |
| 58 | 行政区划名称 | adivNm | 上海市浦东新区 | 上海市浦东新区 | textbox | | exact |
| 59 | 行政区划代码 | adivcd | 210819 | 210819 | textbox | | exact |
| 60 | 登记注册地址 | rgsRgstAdr | 长沙市岳麓区中山路177号 | 长沙市岳麓区中山路177号 | textbox | | exact |
| 61 | 经度 | lgt | 98.85 | 98.85 | textbox | | exact |
| 62 | 纬度 | ltt | 34.10 | 34.10 | textbox | | exact |
| 63 | 区域类型 | rgonTp | 1 | 城市区域（不含县城城区）| select | | code |
| 64 | 城乡类型 | urbTwnshpTp | 1 | 城市企业 | select | | code |
| 65 | 外文登记注册地址 | frgnlangRgsRgstAdr | 长沙市岳麓区芙蓉路91号 | 长沙市岳麓区芙蓉路91号 | textbox | | exact |
| 66 | 实际经营地址 | actOprtAdr | 广州市天河区芙蓉路91号 | 广州市天河区芙蓉路91号 | textbox | | exact |
| 67 | 注册资本币种 | rgstFndLclccy | CNY | 人民币 | select | | code |
| 68 | 注册资本金额（元）| rgstCaptlfundAmt | 699181002.00 | 699,181,002.00 | textbox | | format |
| 69 | 实收资本币种 | arcptlCcy | CNY | 人民币 | select | | code |
| 70 | 实收资本金额（元）| arcptlAmt | 665771935.00 | 665,771,935.00 | textbox | | format |
| 71 | 经费来源 | feeSrc | 1 | 自营收入 | select | | code |
| 72 | 主营业务范围描述 | mainbsnScopDsc | 计算机技术开发、技术服务 | 计算机技术开发、技术服务 | textbox | | exact |
| 73 | 经营范围 | oprtScop | 计算机技术开发、技术服务 | 计算机技术开发、技术服务 | textarea | | exact |
| 74 | 成立日期 | fdDt | 2016-08-13 00:00:00 | 2016-08-13 | date | ✓ | datetime |
| 75 | 注册登记日期 | rgstRgdt | 2016-08-13 00:00:00 | 2016-08-13 | date | | datetime |
| 76 | 登记注册失效日期 | rgsRgstExpdt | 2036-08-13 00:00:00 | 2036-08-13 | date | | datetime |
| 77 | 注册登记机关名称 | rgstRgsAhrNm | 上海市浦东新区市场监督管理局 | 上海市浦东新区市场监督管理局 | textbox | | exact |
| 78 | 年检到期日期 | anulinsptnExdt | 2026-12-31 00:00:00 | 2026-12-31 | date | | datetime |
| 79 | 经营状态 | oprtSt | 01 | 存续 | select | | code |
| 80 | 企业名称 | entNm | 鑫瑞丰禾农业开发有限公司 | 鑫瑞丰禾农业开发有限公司 | textbox | ✓ | exact |

### 3.5 涉税基本信息（8 字段）

| # | 表单标签 | API 字段 | API 值 | DOM 显示值 | 类型 | 禁用 | 匹配 |
|---|---------|----------|--------|-----------|------|------|------|
| 81 | 纳税评级标识 | taxpymtRtgId | B | B | select | | exact |
| 82 | 纳税人识别号 | taxpyrIdNo | 91530500941208436B | 91530500941208436B | textbox | | exact |
| 83 | 税务登记证发证日期 | taxRgsctfIssuctfDt | 2016-08-13 00:00:00 | 2016-08-13 | date | | datetime |
| 84 | 是否年审 | anulrvwInd | 1 | 是 | select | | code |
| 85 | 最近三年所得税及增值税纳税总额（元）| rctly3YrIncmtaxAndVatTaxpymtTamt | 500000.00 | 500,000.00 | textbox | | format |
| 86 | 欠税总额（元）| arrTaxTamt | 0.00 | 0.00 | textbox | | exact |
| 87 | 存在违法违章标识 | exstIlglViolatId | 0 | 否 | select | | code |
| 88 | 查询时间 | enqrTm | 2025-07-09 00:00:00 | 2025-07-09 | date | | datetime |

### 3.6 法定代表人/负责人信息（18 字段）

| # | 表单标签 | API 字段 | API 值 | DOM 显示值 | 类型 | 禁用 | 匹配 |
|---|---------|----------|--------|-----------|------|------|------|
| 89 | 法定代表人/负责人姓名 | lglRprsNm | 吴芳军 | 吴芳军 | textbox | ✓ | exact |
| 90 | 法定代表人/负责人证件类型 | lglRprsCrdtTp | 100 | 居民身份证 | select | ✓ | code |
| 91 | 法定代表人/负责人证件号码 | lglRprsCrdtNo | 370200196006245765 | 370200196006245765 | textbox | ✓ | exact |
| 92 | 法定代表人/负责人客户编号 | lglRprsCstNo | 26072918053103967 | 26072918053103967 | textbox | ✓ | exact |
| 93 | 法定代表人/负责人证件起始日期 | lglRprsCrdtStdt | 2016-08-13 00:00:00 | 2016-08-13 | date | ✓ | datetime |
| 94 | 法定代表人证件到期日 | lglRprsCrdtExdt | 2036-08-13 00:00:00 | 2036-08-13 | date | ✓ | datetime |
| 95 | 法定代表人手机号码归属人关系类型 | lglRprsMpnbpRelTp | 100 | 本人 | select | | code |
| 96 | 联系号码/手机号码（短信通知）| lglRprsCtcNo | 13418029028 | 13418029028 | textbox | | exact |
| 97 | 法定代表人单位电话号码 | lglRprsUnitTelno | 18214147069 | 18214147069 | textbox | | exact |
| 98 | 法定代表人个人简历信息 | lglRprsIdvRsmInf | 2016年至今任鑫瑞丰禾农业开发有限公司法定代表人 | (同左) | textarea | | exact |
| 99 | 法定代表人配偶证件类型 | lglRprsSpsCrdtTp | | | select | ✓ | - |
| 100 | 法定代表人配偶证件号码 | lglRprsSpsCrdtNo | | | textbox | ✓ | - |
| 101 | 法定代表人配偶客户编号 | lglRprsSpsCstNo | | | textbox | ✓ | - |
| 102 | 法定代表人配偶姓名 | lglRprsSpsNm | | | textbox | ✓ | - |
| 103 | 居住地址 | lglRprsRsdncAdr | 长沙市岳麓区芙蓉路121号 | 长沙市岳麓区芙蓉路121号 | textbox | | exact |
| 104 | 法定代表人配偶证件起始日期 | lglRprsSpsCrdtStdt | 2016-08-13 00:00:00 | 2016-08-13 | date | | datetime |
| 105 | 法定代表人配偶证件到期日期 | lglRprsSpsCrdtExdt | 2036-08-13 00:00:00 | 2036-08-13 | date | | datetime |
| 106 | 联网核查状态 | ntwrkgInspSt | 1 | 核查通过 | select | | code |

### 3.7 实际控制人及其配偶（15 字段）

| # | 表单标签 | API 字段 | API 值 | DOM 显示值 | 类型 | 禁用 | 匹配 |
|---|---------|----------|--------|-----------|------|------|------|
| 107 | 实际控制人证件类型 | acpCrdtTp | 100 | 居民身份证 | select | ✓ | code |
| 108 | 实际控制人证件号码 | acpCrdtNo | 370200196006245765 | 370200196006245765 | textbox | ✓ | exact |
| 109 | 实际控制人名称 | acpNm | 吴芳军 | 吴芳军 | textbox | ✓ | exact |
| 110 | 实际控制人客户编号 | acpCstNo | 26072918053103967 | 26072918053103967 | textbox | ✓ | exact |
| 111 | 实际控制人单位电话 | acpUnitTel | | | textbox | | - |
| 112 | 实际控制人手机号码归属人关系类型 | acpMpnbpRelTp | 100 | 本人 | select | | code |
| 113 | 实际控制人手机号码 | acpMblphNo | | | textbox | | - |
| 114 | 实际控制人与内部员工关联关系类型 | acpWithInrEmpeRltvRelTp | 6 | 无 | select | | code |
| 115 | 实际控制人证件起始日 | acpCrdtStdt | | | date | | - |
| 116 | 实际控制人证件到期日期 | acpCrdtExdt | | | date | | - |
| 117 | 实际控制人个人简历信息 | acpIdvRsmInf | 本科毕业，从事农业开发行业多年，具有丰富的企业管理经验 | (同左) | textarea | | exact |
| 118 | 实际控制人配偶证件类型 | acpSpsCrdtTp | | | select | ✓ | - |
| 119 | 实际控制人配偶证件号码 | acpSpsCrdtNo | | | textbox | ✓ | - |
| 120 | 实际控制人配偶客户编号 | acpSpsCstNo | | | textbox | ✓ | - |
| 121 | 实际控制人配偶姓名 | acpSpsNm | | | textbox | ✓ | - |

### 3.8 其他特色信息（14 字段，仅 1 个在请求体中）

| # | 表单标签 | API 字段 | API 值 | DOM 显示值 | 类型 | 禁用 | 匹配 |
|---|---------|----------|--------|-----------|------|------|------|
| 122 | 进出口权标志 | impexprgtInd | 0 | 否 | select | | code |
| 123 | 经营场所面积 | — | — | | textbox | | 不在请求体 |
| 124 | 经营场所所有权类型 | — | — | | select | | 不在请求体 |
| 125 | 主要产品情况 | — | — | | textarea | | 不在请求体 |
| 126 | 主要生产设备 | — | — | | textarea | | 不在请求体 |
| 127 | 实际生产能力 | — | — | | textarea | | 不在请求体 |
| 128 | 地区重点企业 | — | — | | select | | 不在请求体 |
| 129 | 优势企业 | — | — | | select | | 不在请求体 |
| 130 | 高环境风险高污染企业 | — | — | | select | | 不在请求体 |
| 131 | 宏观调控限控行业标志 | — | — | | select | | 不在请求体 |
| 132 | 特种经营标识 | — | — | | select | | 不在请求体 |
| 133 | 租金（元/年）| — | — | | textbox | | 不在请求体 |
| 134 | 土地面积（㎡）| — | — | | textbox | | 不在请求体 |
| 135 | 建筑面积（㎡）| — | — | | textbox | | 不在请求体 |

> 其他特色信息中 123-135 号字段在 DOM 中存在但不在 `saveCustCorporat` 请求体中，可能属于其他保存接口或折叠未展开部分。

---

## 4. API 请求体中的隐含字段（DOM 不可见）

以下字段在 `saveCustCorporat` 请求体中但无对应 DOM 表单标签（隐藏 / 计算 / 审计字段）：

### 4.1 隐藏业务字段（空值占位）

| API 字段 | 含义 | 值 |
|----------|------|-----|
| crdtExdt | 证件到期日期 | (空) |
| crdtLongtrmInd | 长期证件标志 | (空) |
| idyNm | 行业代码名称 | (空) |
| highEnrgIdyTp | 高耗能行业类型 | (空) |
| govfncplfAdmnLvlId | 政府融资平台行政级别 | (空) |
| govfncplfAttrId | 政府融资平台属性 | (空) |
| govfncplfTp | 政府融资平台类型 | (空) |
| newTypAgriOpsbjTp | 新型农业经营主体类型 | (空) |
| sciinnoTypEntpTp | 科创型企业类型 | (空) |
| cncredCd | 中征代码 | (空) |
| cncredCdSt | 中征代码状态 | (空) |
| cncredCdAnulinsptnExdt | 中征代码年检到期 | (空) |
| lstdPlc | 上市地点 | (空) |
| stkCd | 股票代码 | (空) |
| estbCrRelDt | 建立信用关系日期 | (空) |
| ccbCstCl | 银行客户分类 | (空) |
| fncDeptCtcpsnMpnbpNm | 财务部联系人手机号姓名 | (空) |
| fncDeptCtcpsnMpnbpIdno | 财务部联系人手机号身份证 | (空) |
| bscaccOpnaccLcnsApvlNo | 基本户开户许可证号 | (空) |
| dvlpZonRtfdLvlId | 开发区认证级别 | (空) |
| spvsUnitNm | 主管单位名称 | (空) |
| rtfdAhrNm | 认证账户名称 | (空) |
| rtfdNo | 认证编号 | (空) |
| aimAndBsnScopDsc | 宗旨和经营范围描述 | (空) |
| orcd | 组织机构代码 | (空) |
| blngInst | 隶属机构 | (空) |
| relPsnTp | 关联人类型 | (空) |
| rltvRelEffTm | 关联关系生效时间 | (空) |
| fxLcnsNo | 外汇许可证号 | (空) |
| wthrSocUnnCrCd | 是否社会统一信用代码 | 0 |

### 4.2 URL 回显参数（从页面 URL query 原样带入）

| API 字段 | 值 |
|----------|-----|
| part | cstMgtcsinfMntcpctMgtcpctMgtPg |
| newtag | false |
| needupdate | yes |
| newTag | true |
| cstCgy | 60 |
| cstSt | 1 |
| rgsInstNo | 9881 |
| rgsInstNm | 9881**银行股份有限公司 |
| usrNo | 701994 |
| usrNm | 黄某某 |
| id | 2087829494894903296 |
| rgulztnInd | 1 |
| crdtTp | 20111 |
| createInst | 9881 |
| tsRowIndex | 1 |
| operoratFlag | edit |
| qryType | 0 |
| showFlg | 1 |
| viewType | edit |
| avyEcd | UML00005557 |
| fcnScnEcd | FS00004007 |
| v | 1787631003277 |

### 4.3 审计字段

| API 字段 | 值 |
|----------|-----|
| beforeFucList | [] |
| beforeFucDataList | [] |
| beforeValidList | [] |
| createUser | 701994 |
| createTime | 2026-08-20 12:32:04 |
| updateUser | 701994 |
| updateInst | 9881 |
| updateTime | 2026-08-24 14:31:07 |
| hdlUser | 701994 |
| hdlInst | 9881 |
| hdlTime | 2026-08-20 12:32:04 |
| delInd | 0 |
| tenantId | 9881 |
| tempsaveInd | 3 |

---

## 5. 填写数据 JSON

以下 JSON 可直接用于自动化表单填写。仅包含**可见表单字段**（排除隐含/审计/URL 回显字段），`apiValue` 为接口实际传值（码值非显示文本）：

```json
{
  "api": {
    "method": "POST",
    "url": "/prod-api/tansun-tcp-app-pc/tansun-tcp-cst/custCorporat/saveCustCorporat"
  },
  "page": {
    "url": "http://test.creditv5p2.tansun.com.cn/#/cstMgt/csinfMntSubDmn/cpctMgt/crtCpctInf/hostCstmgrCrtCpctInf",
    "tab": "客户基本信息",
    "collapse": "对公客户概况"
  },
  "fields": [
    {"section":"基本信息","label":"客户编号","prop":"cstNo","value":"26081317115618826","type":"textbox","disabled":true},
    {"section":"基本信息","label":"客户名称","prop":"cstNm","value":"鑫瑞丰禾农业开发有限公司","type":"textbox","disabled":true},
    {"section":"基本信息","label":"对公客户类型","prop":"cpctTp","value":"601","display":"企业类","type":"select","disabled":true},
    {"section":"基本信息","label":"证件类型","prop":"crdtTp","value":"20111","display":"营业执照","type":"select","disabled":true},
    {"section":"基本信息","label":"证件号码","prop":"crdtNo","value":"91330100MA27XW8T3R","type":"textbox","disabled":true},
    {"section":"基本信息","label":"客户简称","prop":"cstShrtnm","value":"500106200403137035","type":"textbox","disabled":false},
    {"section":"基本信息","label":"国别","prop":"nat","value":"CHN","display":"中华人民共和国","type":"select","disabled":false},
    {"section":"基本信息","label":"外文名称","prop":"frgnlangNm","value":"Test Customer","type":"textbox","disabled":false},
    {"section":"基本信息","label":"异地客户标志","prop":"diffplcCstInd","value":"0","display":"否","type":"select","disabled":false},
    {"section":"基本信息","label":"投资主体","prop":"ivsSbjTp","value":"1","display":"法人投资","type":"select","disabled":false},
    {"section":"基本信息","label":"隶属关系标识","prop":"affilRelId","value":"99","display":"其他","type":"select","disabled":false},
    {"section":"基本信息","label":"控股经济类型","prop":"hldgEcnTp","value":"B0102","display":"私人绝对控股","type":"select","disabled":false},
    {"section":"基本信息","label":"行业代码","prop":"idyCd","value":"A0131","display":"棉花种植","type":"textbox","disabled":false},
    {"section":"基本信息","label":"扶持类企业标志","prop":"sprtCgyEntpInd","value":"0","display":"否","type":"select","disabled":false},
    {"section":"基本信息","label":"上年度从业人数","prop":"lastyrCrerPnum","value":"21856","type":"textbox","disabled":true},
    {"section":"基本信息","label":"上年度资产总额（元）","prop":"lastyrAstTamt","value":"2026.00","type":"textbox","disabled":true},
    {"section":"基本信息","label":"上年度营业收入（元）","prop":"lastyrOprgIncm","value":"3188358.04","type":"textbox","disabled":true},
    {"section":"基本信息","label":"企业规模","prop":"entpSz","value":"03","display":"小型企业","type":"select","disabled":false},
    {"section":"基本信息","label":"国民经济部门","prop":"nalEcnDept","value":"C","display":"非金融企业部门","type":"select","disabled":false},
    {"section":"基本信息","label":"国民经济部门类别","prop":"nalEcnDeptCgy","value":"C99","display":"其他非金融企业部门","type":"select","disabled":false},
    {"section":"基本信息","label":"六大高耗能企业标志","prop":"topsixHighEnrgEntpInd","value":"0","display":"否","type":"select","disabled":false},
    {"section":"基本信息","label":"政府平台标志","prop":"govtPltfrmInd","value":"0","display":"否","type":"select","disabled":false},
    {"section":"基本信息","label":"项目法人标志","prop":"prjLglpsnInd","value":"0","display":"否","type":"select","disabled":false},
    {"section":"基本信息","label":"是否供应链金融企业","prop":"splchainFncEntpInd","value":"0","display":"否","type":"select","disabled":false},
    {"section":"基本信息","label":"评级客户分类标识","prop":"rtgCstClId","value":"","type":"select","disabled":false},
    {"section":"基本信息","label":"是否新型农业经营主体","prop":"newTypAgriOpsbjInd","value":"0","display":"否","type":"select","disabled":false},
    {"section":"基本信息","label":"是否科创型企业","prop":"sciinnoTypEntpInd","value":"0","display":"否","type":"select","disabled":false},
    {"section":"基本信息","label":"有中征码标志","prop":"extCncredCdInd","value":"0","display":"否","type":"select","disabled":false},
    {"section":"基本信息","label":"机构信用代码","prop":"instCrCdEcd","value":"8635944469","type":"textbox","disabled":false},
    {"section":"基本信息","label":"征信首贷客户标志","prop":"crFirstLoanCstInd","value":"","type":"select","disabled":true},
    {"section":"基本信息","label":"上市公司标志","prop":"lstdCoInd","value":"0","display":"否","type":"select","disabled":false},
    {"section":"基本信息","label":"龙头企业","prop":"ldingEntpInd","value":"9","display":"非龙头企业","type":"select","disabled":true},
    {"section":"基本信息","label":"与本行关系","prop":"corpRelTp","value":"1","display":"普通客户","type":"select","disabled":false},
    {"section":"基本信息","label":"与我行合作关系类型","prop":"withCcbCoRelTp","value":"3","display":"一般","type":"select","disabled":false},
    {"section":"基本信息","label":"财务部联系人","prop":"fncDeptCtcpsnNm","value":"周强刚","type":"textbox","disabled":false},
    {"section":"基本信息","label":"财务部联系人身份证号码","prop":"fncDeptCtcpsnIdno","value":"130300197704191122","type":"textbox","disabled":false},
    {"section":"基本信息","label":"财务部联系人手机号归属人关系类型","prop":"fncDeptCtcpsnMpnbpRelTp","value":"100","display":"本人","type":"select","disabled":false},
    {"section":"基本信息","label":"财务部联系人手机号码（短信通知）","prop":"fncDeptCtcpsnMblphNo","value":"18045033518","type":"textbox","disabled":false},
    {"section":"基本信息","label":"单位电话","prop":"fncDeptCtcpsnUnitTel","value":"01032756258","type":"textbox","disabled":false},
    {"section":"基本信息","label":"单位地址邮政编码","prop":"unitAdrZipecd","value":"200001","type":"textbox","disabled":false},
    {"section":"基本信息","label":"单位地址","prop":"unitAdr","value":"广州市天河区解放路21号","type":"textbox","disabled":false},
    {"section":"基本信息","label":"单位Email","prop":"email","value":"test561@company.cn","type":"textbox","disabled":false},
    {"section":"基本信息","label":"是否为一般纳税人","prop":"comTaxpyrInd","value":"1","display":"是","type":"select","disabled":false},
    {"section":"基本户信息","label":"基本存款账户是否在法人行","prop":"bscDepAccExstAgricoopInstInd","value":"1","display":"是","type":"select","disabled":false},
    {"section":"基本户信息","label":"基本户状态","prop":"bscaccSt","value":"1","display":"正常","type":"select","disabled":false},
    {"section":"基本户信息","label":"基本存款账户开户行","prop":"bscaccDpbknm","value":"中国工商银行","type":"textbox","disabled":false},
    {"section":"基本户信息","label":"基本存款账户账号","prop":"bscaccAcctno","value":"62220264709866","type":"textbox","disabled":false},
    {"section":"基本户信息","label":"基本户开户日期","prop":"bscaccOpnaccDt","value":"2016-08-13 00:00:00","type":"date","disabled":false},
    {"section":"评级信息","label":"备注","prop":"rmrk","value":"系统自动生成测试数据","type":"textarea","disabled":false},
    {"section":"登记信息","label":"统一社会信用代码","prop":"uscc","value":"912204001581778690","type":"textbox","disabled":false},
    {"section":"登记信息","label":"登记注册号类型","prop":"rgsRgstNoTp","value":"6","display":"统一社会信用代码","type":"select","disabled":false},
    {"section":"登记信息","label":"登记注册号","prop":"wrkBusiRgsRgstNo","value":"91330100MA27XW8T3R","type":"textbox","disabled":false},
    {"section":"登记信息","label":"注册地为开发区标识","prop":"rgstLandIsDvlpZonId","value":"0","display":"否","type":"select","disabled":false},
    {"section":"登记信息","label":"行政区划名称","prop":"adivNm","value":"上海市浦东新区","type":"textbox","disabled":false},
    {"section":"登记信息","label":"行政区划代码","prop":"adivcd","value":"210819","type":"textbox","disabled":false},
    {"section":"登记信息","label":"登记注册地址","prop":"rgsRgstAdr","value":"长沙市岳麓区中山路177号","type":"textbox","disabled":false},
    {"section":"登记信息","label":"经度","prop":"lgt","value":"98.85","type":"textbox","disabled":false},
    {"section":"登记信息","label":"纬度","prop":"ltt","value":"34.10","type":"textbox","disabled":false},
    {"section":"登记信息","label":"区域类型","prop":"rgonTp","value":"1","display":"城市区域（不含县城城区）","type":"select","disabled":false},
    {"section":"登记信息","label":"城乡类型","prop":"urbTwnshpTp","value":"1","display":"城市企业","type":"select","disabled":false},
    {"section":"登记信息","label":"外文登记注册地址","prop":"frgnlangRgsRgstAdr","value":"长沙市岳麓区芙蓉路91号","type":"textbox","disabled":false},
    {"section":"登记信息","label":"实际经营地址","prop":"actOprtAdr","value":"广州市天河区芙蓉路91号","type":"textbox","disabled":false},
    {"section":"登记信息","label":"注册资本币种","prop":"rgstFndLclccy","value":"CNY","display":"人民币","type":"select","disabled":false},
    {"section":"登记信息","label":"注册资本金额（元）","prop":"rgstCaptlfundAmt","value":"699181002.00","type":"textbox","disabled":false},
    {"section":"登记信息","label":"实收资本币种","prop":"arcptlCcy","value":"CNY","display":"人民币","type":"select","disabled":false},
    {"section":"登记信息","label":"实收资本金额（元）","prop":"arcptlAmt","value":"665771935.00","type":"textbox","disabled":false},
    {"section":"登记信息","label":"经费来源","prop":"feeSrc","value":"1","display":"自营收入","type":"select","disabled":false},
    {"section":"登记信息","label":"主营业务范围描述","prop":"mainbsnScopDsc","value":"计算机技术开发、技术服务","type":"textbox","disabled":false},
    {"section":"登记信息","label":"经营范围","prop":"oprtScop","value":"计算机技术开发、技术服务","type":"textarea","disabled":false},
    {"section":"登记信息","label":"成立日期","prop":"fdDt","value":"2016-08-13 00:00:00","type":"date","disabled":true},
    {"section":"登记信息","label":"注册登记日期","prop":"rgstRgdt","value":"2016-08-13 00:00:00","type":"date","disabled":false},
    {"section":"登记信息","label":"登记注册失效日期","prop":"rgsRgstExpdt","value":"2036-08-13 00:00:00","type":"date","disabled":false},
    {"section":"登记信息","label":"注册登记机关名称","prop":"rgstRgsAhrNm","value":"上海市浦东新区市场监督管理局","type":"textbox","disabled":false},
    {"section":"登记信息","label":"年检到期日期","prop":"anulinsptnExdt","value":"2026-12-31 00:00:00","type":"date","disabled":false},
    {"section":"登记信息","label":"经营状态","prop":"oprtSt","value":"01","display":"存续","type":"select","disabled":false},
    {"section":"登记信息","label":"企业名称","prop":"entNm","value":"鑫瑞丰禾农业开发有限公司","type":"textbox","disabled":true},
    {"section":"涉税基本信息","label":"纳税评级标识","prop":"taxpymtRtgId","value":"B","type":"select","disabled":false},
    {"section":"涉税基本信息","label":"纳税人识别号","prop":"taxpyrIdNo","value":"91530500941208436B","type":"textbox","disabled":false},
    {"section":"涉税基本信息","label":"税务登记证发证日期","prop":"taxRgsctfIssuctfDt","value":"2016-08-13 00:00:00","type":"date","disabled":false},
    {"section":"涉税基本信息","label":"是否年审","prop":"anulrvwInd","value":"1","display":"是","type":"select","disabled":false},
    {"section":"涉税基本信息","label":"最近三年所得税及增值税纳税总额（元）","prop":"rctly3YrIncmtaxAndVatTaxpymtTamt","value":"500000.00","type":"textbox","disabled":false},
    {"section":"涉税基本信息","label":"欠税总额（元）","prop":"arrTaxTamt","value":"0.00","type":"textbox","disabled":false},
    {"section":"涉税基本信息","label":"存在违法违章标识","prop":"exstIlglViolatId","value":"0","display":"否","type":"select","disabled":false},
    {"section":"涉税基本信息","label":"查询时间","prop":"enqrTm","value":"2025-07-09 00:00:00","type":"date","disabled":false},
    {"section":"法定代表人/负责人信息","label":"法定代表人/负责人姓名","prop":"lglRprsNm","value":"吴芳军","type":"textbox","disabled":true},
    {"section":"法定代表人/负责人信息","label":"法定代表人/负责人证件类型","prop":"lglRprsCrdtTp","value":"100","display":"居民身份证","type":"select","disabled":true},
    {"section":"法定代表人/负责人信息","label":"法定代表人/负责人证件号码","prop":"lglRprsCrdtNo","value":"370200196006245765","type":"textbox","disabled":true},
    {"section":"法定代表人/负责人信息","label":"法定代表人/负责人客户编号","prop":"lglRprsCstNo","value":"26072918053103967","type":"textbox","disabled":true},
    {"section":"法定代表人/负责人信息","label":"法定代表人/负责人证件起始日期","prop":"lglRprsCrdtStdt","value":"2016-08-13 00:00:00","type":"date","disabled":true},
    {"section":"法定代表人/负责人信息","label":"法定代表人证件到期日","prop":"lglRprsCrdtExdt","value":"2036-08-13 00:00:00","type":"date","disabled":true},
    {"section":"法定代表人/负责人信息","label":"法定代表人手机号码归属人关系类型","prop":"lglRprsMpnbpRelTp","value":"100","display":"本人","type":"select","disabled":false},
    {"section":"法定代表人/负责人信息","label":"联系号码/手机号码（短信通知）","prop":"lglRprsCtcNo","value":"13418029028","type":"textbox","disabled":false},
    {"section":"法定代表人/负责人信息","label":"法定代表人单位电话号码","prop":"lglRprsUnitTelno","value":"18214147069","type":"textbox","disabled":false},
    {"section":"法定代表人/负责人信息","label":"法定代表人个人简历信息","prop":"lglRprsIdvRsmInf","value":"2016年至今任鑫瑞丰禾农业开发有限公司法定代表人","type":"textarea","disabled":false},
    {"section":"法定代表人/负责人信息","label":"法定代表人配偶证件类型","prop":"lglRprsSpsCrdtTp","value":"","type":"select","disabled":true},
    {"section":"法定代表人/负责人信息","label":"法定代表人配偶证件号码","prop":"lglRprsSpsCrdtNo","value":"","type":"textbox","disabled":true},
    {"section":"法定代表人/负责人信息","label":"法定代表人配偶客户编号","prop":"lglRprsSpsCstNo","value":"","type":"textbox","disabled":true},
    {"section":"法定代表人/负责人信息","label":"法定代表人配偶姓名","prop":"lglRprsSpsNm","value":"","type":"textbox","disabled":true},
    {"section":"法定代表人/负责人信息","label":"居住地址","prop":"lglRprsRsdncAdr","value":"长沙市岳麓区芙蓉路121号","type":"textbox","disabled":false},
    {"section":"法定代表人/负责人信息","label":"法定代表人配偶证件起始日期","prop":"lglRprsSpsCrdtStdt","value":"2016-08-13 00:00:00","type":"date","disabled":false},
    {"section":"法定代表人/负责人信息","label":"法定代表人配偶证件到期日期","prop":"lglRprsSpsCrdtExdt","value":"2036-08-13 00:00:00","type":"date","disabled":false},
    {"section":"法定代表人/负责人信息","label":"联网核查状态","prop":"ntwrkgInspSt","value":"1","display":"核查通过","type":"select","disabled":false},
    {"section":"实际控制人及其配偶","label":"实际控制人证件类型","prop":"acpCrdtTp","value":"100","display":"居民身份证","type":"select","disabled":true},
    {"section":"实际控制人及其配偶","label":"实际控制人证件号码","prop":"acpCrdtNo","value":"370200196006245765","type":"textbox","disabled":true},
    {"section":"实际控制人及其配偶","label":"实际控制人名称","prop":"acpNm","value":"吴芳军","type":"textbox","disabled":true},
    {"section":"实际控制人及其配偶","label":"实际控制人客户编号","prop":"acpCstNo","value":"26072918053103967","type":"textbox","disabled":true},
    {"section":"实际控制人及其配偶","label":"实际控制人单位电话","prop":"acpUnitTel","value":"","type":"textbox","disabled":false},
    {"section":"实际控制人及其配偶","label":"实际控制人手机号码归属人关系类型","prop":"acpMpnbpRelTp","value":"100","display":"本人","type":"select","disabled":false},
    {"section":"实际控制人及其配偶","label":"实际控制人手机号码","prop":"acpMblphNo","value":"","type":"textbox","disabled":false},
    {"section":"实际控制人及其配偶","label":"实际控制人与内部员工关联关系类型","prop":"acpWithInrEmpeRltvRelTp","value":"6","display":"无","type":"select","disabled":false},
    {"section":"实际控制人及其配偶","label":"实际控制人证件起始日","prop":"acpCrdtStdt","value":"","type":"date","disabled":false},
    {"section":"实际控制人及其配偶","label":"实际控制人证件到期日期","prop":"acpCrdtExdt","value":"","type":"date","disabled":false},
    {"section":"实际控制人及其配偶","label":"实际控制人个人简历信息","prop":"acpIdvRsmInf","value":"本科毕业，从事农业开发行业多年，具有丰富的企业管理经验","type":"textarea","disabled":false},
    {"section":"实际控制人及其配偶","label":"实际控制人配偶证件类型","prop":"acpSpsCrdtTp","value":"","type":"select","disabled":true},
    {"section":"实际控制人及其配偶","label":"实际控制人配偶证件号码","prop":"acpSpsCrdtNo","value":"","type":"textbox","disabled":true},
    {"section":"实际控制人及其配偶","label":"实际控制人配偶客户编号","prop":"acpSpsCstNo","value":"","type":"textbox","disabled":true},
    {"section":"实际控制人及其配偶","label":"实际控制人配偶姓名","prop":"acpSpsNm","value":"","type":"textbox","disabled":true},
    {"section":"其他特色信息","label":"进出口权标志","prop":"impexprgtInd","value":"0","display":"否","type":"select","disabled":false}
  ]
}
```

---

## 6. 统计与关键发现

### 6.1 映射统计

| 类别 | 数量 | 说明 |
|------|------|------|
| 可见表单字段（DOM） | 116 | 含 8 个分区 |
| 成功映射到 API 字段 | 101 | 有 prop 对应 |
| DOM 字段不在请求体 | 15 | 评级 4 个（外部接口）+ 其他特色 11 个 |
| API 隐含字段（无 DOM） | ~50 | 隐藏业务 + URL 回显 + 审计 |
| 值精确匹配（exact） | 51 | DOM 值 = API 值 |
| 码值匹配（code） | 38 | DOM 显示文本，API 存码值 |
| 格式化匹配（format） | 5 | 千分位差异 |
| 日期时间匹配（datetime） | 12 | 日期 vs 日期+时间 |

### 6.2 关键发现

1. **select 控件用码值传输**：表单显示中文（如「企业类」），API 传码值（如「601」）。自动化填写需用 `value`（码值）而非 `display`（文本），且需要选项列表做码值↔文本映射。

2. **金额字段去格式化**：DOM 显示千分位（`699,181,002.00`），API 传原始值（`699181002.00`）。填写时需去千分位。

3. **日期字段补时间**：DOM 仅日期（`2016-08-13`），API 补零时间（`2016-08-13 00:00:00`）。填写时需追加 `00:00:00`。

4. **URL 参数原样回传**：页面 URL 的 query 参数（`part`/`avyEcd`/`fcnScnEcd`/`usrNo` 等）被原样塞进请求体，自带页面上下文。

5. **审计字段自动填充**：`createUser`/`updateTime`/`tenantId` 等由后端自动维护，填写时无需关注。

6. **多接口协作**：一个表单页的「保存」按钮只触发 1 个保存接口，但表单数据来自多个加载接口（`getCustCorporat` + `getRatingResult` + `custLabel/list` 等）。
