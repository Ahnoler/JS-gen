# JS-gen product-mgmt 草稿交易查阅清单（handoff）

> 给其他会话 / agent 开发用。模块：`product-mgmt`。仓库：`Ahnoler/JS-gen`。
> **仓库内规范副本**（本文件）。模块作业区副本：`data/kb/req/product-mgmt/draft-quality-checklist-handoff.md`（内容同步，改一处请两边对齐或只改本文件再复制）。
> 上游开发分支以当前检出为准（常见 `uara_V2.0`）；文中湿测缓存版本以 v9/v11 为准，与 git 分支名无关。
> 模块作业区：`data/kb/req/product-mgmt/`。
>
> **转交一句：** 请阅读本文件。闸门通过 ≠ 质量达标。v9 四条为较密正向样例；v11 十二条薄稿为未达标现状。

## 0. 质量标准（金样口径）

参照「产品要素管理」录制级交易风格：

1. **进页 / 定位选中**（或明确依赖上游产物），禁止菜单导航（如 `【产品管理】→【…】`）。
2. **单一业务能力**（一个原子只做一件事：新增 / 维护 / 删除 / 查询…）。
3. **可执行步骤 + 断言收尾**（如点击【保存】/【确定】成功；列表展示结果）。
4. `taskDraft` 应有多步编号步骤，而不是单行「标题（页面），操作：【按钮】/【按钮】」。
5. `produces` / `dataDependsOn` 应是业务数据名，避免 `…产物` 或与 title 雷同的占位。

**注意：propose 闸门通过 ≠ 质量达标。** 闸门只挡 multi_capability / multi_persist / provenance 等硬规则。

相关闸门：`src/services/req-draft-traj/capability-cohesion.js`，`flow-card-guide.js`（persist 计数），cache 版本见 `propose-cache.js`（当前湿测为 **v11**）。

---

## 1. 较接近标准的样例（cache **v9** 湿测 · 闸门通过且步骤较密）

来源：`propose-response-v9.json`。当时通过 4 / 拒绝约 21（大量为当时 cohesion 假阳性，后经 PR #51–#53 收紧）。

### 1.1 维护产品基本信息

- atomKey: `product-mgmt:chain-c:1`
- kind: nav
- produces: ["已维护产品信息"]
- dataDependsOn: [{"key":"产品","source":"atom"}]
- sourceChapter: chapters/03-product-info-config.md#产品信息管理-配置产品信息
- pageCodes: ["ZJJK00107304"]

```
1、进入查看产品信息主页，等待加载（ZJJK00107304）
2、搜索/定位并选中已有「产品」
3、维护基本信息字段
4、【保存】成功

来源：source/K01天阳信贷管理系统-产品管理需求分册.docx / chapters/03-product-info-config.md#产品信息管理-配置产品信息

关键数据
产品：KB测产品
已维护产品信息：KB测产品信息
```

### 1.2 设置产品阶段

- atomKey: `product-mgmt:chain-c:4`
- kind: nav
- produces: ["产品阶段关系"]
- dataDependsOn: [{"key":"已维护产品信息","source":"atom"}]
- sourceChapter: chapters/03-product-info-config.md#产品信息管理-配置产品信息
- pageCodes: ["ZJJK00094364"]

```
1、进入产品阶段主页，等待加载（ZJJK00094364）
2、定位并选中已有产品
3、点击【设置阶段】
4、在弹窗选择阶段
5、【确定】保存成功

来源：source/K01天阳信贷管理系统-产品管理需求分册.docx / chapters/03-product-info-config.md#产品信息管理-配置产品信息

关键数据
已维护产品信息：KB测产品信息
产品阶段关系：KB测阶段关系
```

### 1.3 设置产品管控要素

- atomKey: `product-mgmt:chain-c:8`
- kind: write
- produces: ["产品管控要素"]
- dataDependsOn: [{"key":"产品阶段关系","source":"atom"}]
- sourceChapter: chapters/03-product-info-config.md#产品信息管理-配置产品信息
- pageCodes: ["ZJJK00094364","ZJJK00098070","ZJJK00094369","ZJJK00094370"]

```
1、进入产品阶段主页，等待加载（ZJJK00094364）
2、定位并选中已有「产品阶段关系」
3、点击【设置管控要素】
4、进入产品要素编辑主页（ZJJK00098070），通过【添加组件】/【配置单一要素】/【配置组合要素】等维护产品组件列表（ZJJK00094369、ZJJK00094370）
5、点击【保存】成功

来源：source/K01天阳信贷管理系统-产品管理需求分册.docx / chapters/03-product-info-config.md#产品信息管理-配置产品信息

关键数据
产品阶段关系：KB测阶段关系
产品管控要素：KB测管控要素
```

### 1.4 查询产品信息

- atomKey: `product-mgmt:chain-f:1`
- kind: nav
- produces: ["产品查询结果"]
- dataDependsOn: []
- sourceChapter: chapters/06-query-product.md#查询产品
- pageCodes: ["ZJJK00095907"]

```
1、进入查询产品信息主页，等待加载（ZJJK00095907）
2、填写产品名称、产品编号、产品状态、产品目录等查询条件
3、点击【查询】
4、列表展示符合条件的产品记录

来源：source/K01天阳信贷管理系统-产品管理需求分册.docx / chapters/06-query-product.md#查询产品

关键数据
产品查询结果：KB测查询结果
```

---

## 2. 当前湿测（cache **v11**）· 闸门通过但质量未达标（12）

cacheVersion: **11**

共性：单行跟表薄稿；缺定位/进页；`produces` 多为 `…产物`；一条标题含菜单路径。

### 2.1 删除产品要素

- atomKey: `product-mgmt:chain-a:5`
- 质量判定: **未达质量标准**
- 问题标记: 单行薄稿；跟表按钮列表；缺定位/进页步骤；persistConfirms=0；produces偏抽象
- produces: ["删除产品要素产物"]
- dataDependsOn: []
- sourceChapter: chapters/02-product-element.md#产品要素管理

```
1、删除产品要素（产品要素主页），操作：【删除】

来源：source/K01天阳信贷管理系统-产品管理需求分册.docx
```

### 2.2 禁用产品并登记下架理由

- atomKey: `product-mgmt:chain-b:3`
- 质量判定: **未达质量标准**
- 问题标记: 单行薄稿；跟表按钮列表；缺定位/进页步骤；produces偏抽象
- produces: ["禁用产品并登记下架理由产物"]
- dataDependsOn: []
- sourceChapter: chapters/03-product-info-config.md#产品信息管理-配置产品信息

```
1、禁用产品并登记下架理由（产品下架），操作：【确定】 / 【取消】

来源：source/K01天阳信贷管理系统-产品管理需求分册.docx
```

### 2.3 产品克隆

- atomKey: `product-mgmt:chain-b:4`
- 质量判定: **未达质量标准**
- 问题标记: 单行薄稿；跟表按钮列表；缺定位/进页步骤；produces偏抽象
- produces: ["产品克隆产物"]
- dataDependsOn: []
- sourceChapter: chapters/03-product-info-config.md#产品信息管理-配置产品信息

```
1、产品克隆（产品克隆），操作：【确定】 / 【取消】

来源：source/K01天阳信贷管理系统-产品管理需求分册.docx
```

### 2.4 配置视图

- atomKey: `product-mgmt:chain-b:6`
- 质量判定: **未达质量标准**
- 问题标记: 单行薄稿；跟表按钮列表；缺定位/进页步骤；produces偏抽象
- produces: ["配置视图产物"]
- dataDependsOn: []
- sourceChapter: chapters/03-product-info-config.md#产品信息管理-配置产品信息

```
1、配置视图（产品配置视图），操作：【配置】 / 【返回】

来源：source/K01天阳信贷管理系统-产品管理需求分册.docx
```

### 2.5 查看产品历史

- atomKey: `product-mgmt:chain-b:7`
- 质量判定: **未达质量标准**
- 问题标记: 单行薄稿；跟表按钮列表；缺定位/进页步骤；persistConfirms=0；produces偏抽象
- produces: ["查看产品历史产物"]
- dataDependsOn: []
- sourceChapter: chapters/06-query-product.md#查询产品

```
1、查看产品历史（产品历史页面／产品版本历史主页），操作：【查看】

来源：source/K01天阳信贷管理系统-产品管理需求分册.docx
```

### 2.6 设置管控要素

- atomKey: `product-mgmt:chain-c:6`
- 质量判定: **未达质量标准**
- 问题标记: 单行薄稿；跟表按钮列表；缺定位/进页步骤；produces偏抽象
- produces: ["设置管控要素产物"]
- dataDependsOn: []
- sourceChapter: chapters/03-product-info-config.md#产品信息管理-配置产品信息

```
1、设置管控要素（产品要素编辑主页（产品要素配置+保存返回按钮）），操作：【保存】 / 【返回】

来源：source/K01天阳信贷管理系统-产品管理需求分册.docx
```

### 2.7 产品组件列表管理

- atomKey: `product-mgmt:chain-c:7`
- 质量判定: **未达质量标准**
- 问题标记: 单行薄稿；跟表按钮列表；缺定位/进页步骤；produces偏抽象
- produces: ["产品组件列表管理产物"]
- dataDependsOn: []
- sourceChapter: chapters/03-product-info-config.md#产品信息管理-配置产品信息

```
1、产品组件列表管理（产品组件列表），操作：【添加组件】 / 【全部清空】 / 【删除】

来源：source/K01天阳信贷管理系统-产品管理需求分册.docx
```

### 2.8 删除阶段

- atomKey: `product-mgmt:chain-d:3`
- 质量判定: **未达质量标准**
- 问题标记: 单行薄稿；跟表按钮列表；缺定位/进页步骤；persistConfirms=0；produces偏抽象
- produces: ["删除阶段产物"]
- dataDependsOn: []
- sourceChapter: chapters/04-product-stage.md#维护产品阶段

```
1、删除阶段（维护产品阶段主页），操作：【删除】

来源：source/K01天阳信贷管理系统-产品管理需求分册.docx
```

### 2.9 【产品管理】→【产品信息管理】→【查询产品信息】

- atomKey: `product-mgmt:chain-f:1`
- 质量判定: **未达质量标准**
- 问题标记: 标题含菜单路径；单行薄稿；跟表按钮列表；缺定位/进页步骤；persistConfirms=0；produces偏抽象
- produces: ["【产品管理】→【产品信息管理】→【查询产品信息】产物"]
- dataDependsOn: []
- sourceChapter: chapters/06-query-product.md#查询产品

```
1、【产品管理】→【产品信息管理】→【查询产品信息】（查询产品信息主页），操作：【查询】 / 【重置】 / 【产品详情】 / 【产品历史】 / 【导出】

来源：source/K01天阳信贷管理系统-产品管理需求分册.docx
```

### 2.10 产品详情

- atomKey: `product-mgmt:chain-f:2`
- 质量判定: **未达质量标准**
- 问题标记: 单行薄稿；跟表按钮列表；缺定位/进页步骤；produces偏抽象
- produces: ["产品详情产物"]
- dataDependsOn: []
- sourceChapter: chapters/06-query-product.md#查询产品

```
1、产品详情（查看产品详情【场景:FS00003307】／任务页），操作：【返回】

来源：source/K01天阳信贷管理系统-产品管理需求分册.docx
```

### 2.11 产品历史

- atomKey: `product-mgmt:chain-f:3`
- 质量判定: **未达质量标准**
- 问题标记: 单行薄稿；跟表按钮列表；缺定位/进页步骤；produces偏抽象
- produces: ["产品历史产物"]
- dataDependsOn: []
- sourceChapter: chapters/06-query-product.md#查询产品

```
1、产品历史（产品版本历史主页），操作：【查看】

来源：source/K01天阳信贷管理系统-产品管理需求分册.docx
```

### 2.12 查看产品信息

- atomKey: `product-mgmt:chain-f:4`
- 质量判定: **未达质量标准**
- 问题标记: 单行薄稿；跟表按钮列表；缺定位/进页步骤；persistConfirms=0；produces偏抽象
- produces: ["查看产品信息产物"]
- dataDependsOn: []
- sourceChapter: chapters/03-product-info-config.md#产品信息管理-配置产品信息

```
1、查看产品信息（查看产品信息主页），操作：—

来源：source/K01天阳信贷管理系统-产品管理需求分册.docx
```

---

## 3. 当前湿测（cache **v11**）· 闸门未通过（7）

拒稿条目**不落盘 taskDraft**。下列步骤名来自 `through-chains.md`。

| atomKey | reason | 链 | 步骤 |
|---------|--------|----|------|
| `product-mgmt:chain-a:2` | `multi_persist_task_draft` | 主链 A：产品要素管理——维护产品要素分组与产品要素 | 选择节点，新增类型或新增组件 |
| `product-mgmt:chain-b:2` | `multi_capability_task_draft` | 主链 B：产品信息管理——产品库管理配置与发布 | 新增一级分类、子分类或产品 |
| `product-mgmt:chain-b:5` | `missing_source_chapter` | 主链 B：产品信息管理——产品库管理配置与发布 | 产品修改生成新版本 |
| `product-mgmt:chain-c:1` | `multi_persist_task_draft` | 主链 C：配置产品信息——产品详情、公共要素与个性化要素 | 查看产品信息 |
| `product-mgmt:chain-c:8` | `multi_capability_task_draft` | 主链 C：配置产品信息——产品详情、公共要素与个性化要素 | 产品要素编辑 |
| `product-mgmt:chain-d:2` | `multi_persist_task_draft` | 主链 D：维护产品阶段 | 新增阶段或新增子阶段后保存 |
| `product-mgmt:chain-e:2` | `multi_capability_task_draft` | 主链 E：维护核心产品映射 | 新增或修改核心产品映射 |

解读简要：

- `multi_capability_task_draft`：链上把多种写能力写进同一步（如「新增一级分类、子分类或产品」「新增或修改…」「配置+删除」），atomize 跟表后被 cohesion 拒绝——多为**真阳性**（应拆原子），不是 v11 词渗类。
- `multi_persist_task_draft`：稿内出现多个【确定】/【保存】/【提交】类 closer。
- `missing_source_chapter`：无法解析章节出处。

---

## 4. 给开发 agent 的结论

| 类别 | 数量 | 是否达金样 | 说明 |
|------|------|------------|------|
| v9 通过样例 | 4 | **较接近** | 可作正向 few-shot / 验收参照 |
| v11 通过 | 12 | **否** | 闸门放行，质量薄；勿当金样 |
| v11 拒绝 | 7 | 无稿 | 优先拆 through-chains / atomize，而非再松闸门 |

建议下一步杠杆：

1. **through-chains 拆步**（禁止一步 OR 多种写能力；菜单导航勿进第 1 步 action）。
2. **atomize prompt** 强制多步金样结构，禁止单行「操作：【…】/【…】」拷贝。
3. cohesion 闸门（v10/v11）已收词渗假阳性；剩余 multi_capability 多为切片合写问题。

**SOP 落点（2026-09-20）：** 金样五条与薄稿正/反例已内嵌于  
`tools/draft-traj-coach/skill/references/taskdraft-quality.md`（及同目录 gold/thin 样例）。本 handoff 为历史评审记录，操作员以 skill 包为准，不必外链回本文。

---

## 5. 相关文件

- 当前缓存：`.draft-traj-propose.json`
- v11 响应：`propose-response-v11.json`
- v9 响应：`propose-response-v9.json`
- 本清单：`draft-quality-checklist-handoff.md`（本文件）
- 结构化：`draft-quality-checklist-v11.json`
- 切片：`through-chains.md`，`chapters/*.md`
- atomize prompt：`scripts/prompts/req-draft-traj-atomize-prompt.md`
