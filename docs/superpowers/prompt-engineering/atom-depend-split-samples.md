# Atom 拆分样例：`produces` / `dataDependsOn`

这些例子说明**依赖图**与**能力内聚**怎么切 atom。它们碰巧来自产品库湿测（#675 / #676 / #678 / #504 / 维护形态），**不是**「树的每一层必须拆」教条，也不是按钮文案黑名单。换到客户、合同或其它对象，规则相同：后一步要新建/修改的对象依赖前一步 `produces` 的键，就必须拆成两笔；同页上另一项可独立验证的能力也必须另起 atom。每笔 `produces` 必须非空；`dataDependsOn` 根笔为 `[]`，否则指向上游 atom 或 `preset`。

线上 prompt 分区见 `scripts/prompts/req-draft-traj-atomize-prompt.md`（`<role>` / `<output_contract>` / `<split_rules>` / `<examples>` / `<anti_patterns>` / `<checklist>`）。下列正/反例与 prompt 内 `<good>` / `<bad reason="...">` 对齐。`taskDraft` 密度跟输入走：链瘦时用本节 G1/G2/G3；上传并解析了详细需求之后的录制员上限见 [`product-element-taskdraft-samples.md`](product-element-taskdraft-samples.md)（产品要素仅示意；不要把那里的控件文案抄进没有这些字符串的模块）。

## 正例

### G1 · 根能力一次落库（对齐 #675）

本笔新确立一级对象；无上游数据依赖。`produces` 非空，`dataDependsOn` 为 `[]`。

```
produces: ["一级分类"]
dataDependsOn: []

taskDraft:
1、进入功能页，等待加载
2、打开新建入口，填写名称/序号等字段
3、【确定】保存成功

关键数据
一级分类：KB测一级
```

### G2 · 下游能力：先定位再一次落库（对齐 #676）

本笔新确立子对象；开录前上游须已存在。taskDraft 含搜索/定位/选中准备步骤。也可写成 `{ "key": "一级分类", "source": "preset" }`。

```
produces: ["子分类"]
dataDependsOn: ["一级分类"]

taskDraft:
1、进入功能页，等待加载
2、搜索/定位并选中已有「一级分类」
3、打开新建子级入口，填写字段
4、【确定】保存成功

关键数据
一级分类：KB测一级
子分类：KB测子类
```

对齐 #678 的产品新建同构：`produces: ["产品"]`，`dataDependsOn: ["一级分类", "子分类"]`，步骤仍是定位已有依赖 → 本笔一次落库。前置草稿完成后，每一笔都应能**单独开录跑通**。

### G3 · 维护：定位 → 填写本能力字段 → 一次落库

搜索/选中已有对象、打开表单、填写**该项能力**的字段、一次落库——准备步骤服务于这一项能力，不是另一项能力。链瘦时保持下面骨架；链/章节已点名节点、页签、字段时代入这些名字（形态对齐富输入样例 Atom D：选中对象 → 改本能力字段 → 一次【保存】，见 [`product-element-taskdraft-samples.md`](product-element-taskdraft-samples.md)）。输入没有的悬停提示/弹窗标题不要编。

```
produces: ["已维护对象"]
dataDependsOn: ["已有对象"]

taskDraft:
1、进入功能页，等待加载
2、搜索/定位并选中已有对象
3、打开该项能力对应的表单或页签，填写本能力字段
4、一次【保存】成功

关键数据
已有对象：KB测对象
已维护对象：KB测对象
```

## 反例

### B1 · same-page multi-capability（维护 + 列表侧可独立验收能力）

不要因为两项能力出现在同一页面、同一需求段落、甚至同一对象上，就把它们写进同一 `taskDraft`。直觉（仅说明形态，不是场景法）：列表上另一次可独立验收的操作（如核对排序结果）与详情保存是**不同**能力。结构闸 reason = `multi_capability_task_draft`（实现见 `src/services/req-draft-traj/capability-cohesion.js`；多次【确定】仍走既有 `multi_persist_task_draft`）。

```
# 不要这样
produces: ["已维护对象"]
dataDependsOn: ["已有对象"]

taskDraft:
1、进入功能页
2、在列表上做一项可独立验收的操作（例如调整顺序并核对其结果）
3、再选中同一对象，打开详情，改另一组字段并【保存】
```

问题：准备步骤只允许服务本笔能力，不能顺带做另一项可单独开录的能力。正确：各成一笔 atom。

### B2 · maintain missing locate/search/select prep

维护依赖已有对象，但跳过搜索/定位/选中，直接打开表单改字段。

```
# 不要这样
produces: ["已维护对象"]
dataDependsOn: ["已有对象"]

taskDraft:
1、进入功能页
2、直接打开表单，修改字段
3、【保存】
```

问题：`dataDependsOn` 非空时，定位准备步骤必须写进本笔（见 G3）。

### B3 · multi-persist / multi-create chain

把互相依赖的多次新建/多次落库合成一笔。

```
# 不要这样
produces: ["一级分类", "子分类", "产品"]
dataDependsOn: []

taskDraft:
1、新增一级并【确定】
2、新增子分类并【确定】
3、新增产品并【确定】
```

问题：多次落库闭环必须拆开；下游用 `dataDependsOn` 指向上游 `produces`。硬闸另有 `multi_persist_task_draft` / `self_produce_depend`。正确做法仍是 G1 → G2 → #678 同构三条链。

### B4 · #504-style fallback pollution

把「造一级 + 造依赖一级的子类/产品」合成一笔，或在 `taskDraft` 写「若找不到父节点则先新建父再继续」。

```
# 不要这样
produces: ["一级分类", "子分类", "产品"]
dataDependsOn: ["一级分类", "子分类"]   // 与 produces 相交 → 自产自依赖

taskDraft:
1、进入功能页
2、若找不到父级则先点【新增一级分类】造父
3、再新增子分类 / 产品并【确定】
```

问题：

1. `produces ∩ dataDependsOn` 非空 → 硬拒 `self_produce_depend`。
2. 「找不到上游则本笔先造上游」是 #504 式兜底：缺上游应拆出上游 atom，或标 `source: "preset"` 并由人保证预置。
3. 湿测 #504 还因按钮口径错误造出幽灵顶层；拆笔 + 先搜索再写可避免把兜底写进同一交易。

这与「禁止按场景清单强制拆笔」不矛盾：判断标准是「能否独立验证 / 独立开录」以及依赖图，不是某几个按钮词或树的层数。
