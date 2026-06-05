---
name: atp-rule
description: |
  Smart value generation rules for Playwright test script generation. Contains keyword-to-value mapping tables (random generators for ID card, phone, email, etc.), format templates (expected results, operation steps, etc.), and enum code selectors (case type, case nature, etc.). Used by atp-ui to generate realistic test data in Playwright scripts. Part of the Playwright script generation knowledge base.
---

# atp-rule — Playwright 脚本测试数据生成规则

在编写 Playwright 脚本时，**必须**先扫描页面上所有表单字段的 label 文本，与下方的规则表进行关键词匹配。命中后按类型处理：

> 本规则是 `atp-ui` 技能的一部分，与 Element UI / Vue 组件交互指南配合使用。atp-ui 解决"怎么填"，atp-rule 解决"填什么"。

- **随机生成器**：直接用生成器函数产出合法随机值，确保每次运行不重复、通过校验
- **格式模板**：返回格式规范说明，由 AI 根据用例上下文自行编写具体内容

匹配顺序：按表从上到下依次匹配，命中第一个即停止。

## 随机生成器 — 关键词 → 生成值

| 关键词 | 生成器 | 格式约束 | 备注 |
|--------|--------|----------|------|
| `身份证`、`身份证号`、`证件号码`、`居民身份证` | `genIdCard()` | 18 位，末位含校验码（可为 X） | 用 `genValidIdCard(prefix)` 生成真校验位 |
| `单位电话`、`固定电话`、`座机` | `genLandline()` | 区号+号码 | 如 `0731` + 8 位随机数字 |
| `手机`、`电话`、`联系方式` | `genMobile()` | 11 位，`1` 开头，第二位 3-9 | 模糊匹配手机号/联系电话/联系方式等 |
| `邮箱`、`Email`、`电子邮箱` | `genEmail()` | `xxx@domain.tld` | 随机用户名 + 常见域名 |
| `统一社会信用代码`、`信用代码` | `genCreditCode()` | 18 位字母+数字 | 注册号前缀 + 随机段 |
| `银行卡`、`银行卡号`、`银行账号` | `genBankCard()` | 16-19 位，`62` 开头 | 银联卡号随机 |
| `金额`、`价格`、`费用`、`工资`、`收入` | `genAmount()` | 数字，可含 2 位小数 | 10000.00 ~ 9999999.99 |
| `邮编`、`邮政编码` | `'100000'` | 6 位数字 | 静态值 |
| `姓名`、`用户名`、`联系人` | `genName()` | 2-4 中文字符 | 从姓名池随机取 |
| `QQ`、`QQ号`、`QQ号码` | `genQQ()` | 5-11 位数字 | 随机 |
| `地址`、`详细地址`、`联系地址` | `genAddress()` | 省市区+街道 | "XX市XX区XX路XX号" |
| `工号`、`员工编号` | `genEmployeeId()` | 字母+数字 | `EMP` + 随机 3 位数字 |
| `年龄` | `genAge()` | 1-3 位 | 18-65 随机 |

## 格式模板 — 关键词 → 返回格式规范，模型自行填写

| 关键词 | 格式规范 | 示例 |
|--------|----------|------|
| `预期结果`、`预期` | 编号行格式 `N、描述`，N 从 1 自增。行为级描述（交易状态、提示信息、拒绝原因等）。 | `1、交易状态，成功` `2、提示信息，拒绝原因：证件类型不能为空` |
| `检查点` | 编号行格式 `N、描述`，N 从 1 自增。描述每个步骤后的系统状态/校验结果。 | `1、交易状态，失败` `2、提示信息，拒绝原因：证件类型不能为空` |
| `操作步骤` | 编号行格式 `N、操作描述`。引用业务要素用 `<<名称>>`，引用字段用 `「字段名」`，字段值用 `为值/为空` 描述。 | `1、执行<<新增对公信贷潜在客户>>，输入「证件类型A」为空，提交交易` `2、查看交易结果` |
| `案例名称`、`名称` | 描述性名称。正向：`验证[功能]正向流程`，反向：`反向验证：[场景]` | `验证新增潜客功能正向流程` |
| `案例描述`、`描述` | 1-3 句描述验证目标，每句一行。 | `1. 系统应正确处理正常输入` `2. 提交后出现操作成功提示` |
| `前置条件`、`前置` | 一行描述操作前的系统状态。 | `已登录信贷系统，进入对公客户新增潜客页面` |
| `测试数据`、`数据` | `字段名：值` 键值对，每行一个。批量场景用角色 + 列表格式。 | `客户名称：空值` `证件号码：110101199001011234` |
| `测试意图`、`意图` | 1-2 句描述测试意图。 | `验证新增潜客时输入非法数据，系统应拦截并提示错误` |

## 码值选择 — 关键词 → 可能取值

命中以下关键词时，取值必须从对应集合中选择，**不可随机生成、不可自行编造**。实际表单中可能是下拉选择（el-select）、单选按钮（el-radio）或普通输入框——**由模型根据页面 DOM 自行判断元素类型**，选择对应的填写方式。

| 关键词 | 可选值 | 说明 |
|--------|--------|------|
| `案例类型`、`类型` | `业务规则`、`业务要素` | 二选一；默认选 `业务规则` |
| `案例性质`、`性质` | `正向案例`、`反向案例` | 二选一；默认选 `正向案例`，反向用例场景选 `反向案例` |

**AI 填写规则**：
- 用户未指定时，取默认值
- 用户输入中有"反向""异常""拒绝"等语义时，`案例性质` 选 `反向案例`
- 用户输入中有"正向""正常""通过"等语义时，`案例性质` 选 `正向案例`
- 取值必须与码值表中文字**完全一致**（含标点），不可简写或同义替换

## 生成器函数代码

```javascript
// === 特殊规则生成器 ===

/** 生成合法身份证号（含正确校验位） */
function genValidIdCard(prefix = '430101') {
  const birth = `${1950 + Math.floor(Math.random() * 55)}${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}`;
  const seq = String(Math.floor(Math.random() * 999)).padStart(3, '0');
  const base = `${prefix}${birth}${seq}`;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const map = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  const sum = base.split('').reduce((s, c, i) => s + parseInt(c) * weights[i], 0);
  return base + map[sum % 11];
}

/** 生成随机手机号（11 位，1 开头，第二位 3-9） */
function genMobile() {
  const second = [3, 4, 5, 6, 7, 8, 9][Math.floor(Math.random() * 7)];
  let num = `1${second}`;
  for (let i = 0; i < 9; i++) num += Math.floor(Math.random() * 10);
  return num;
}

/** 生成随机座机号（区号 + 号码） */
function genLandline() {
  const areas = ['010', '021', '0731', '0755', '0571', '020', '028', '024'];
  const area = areas[Math.floor(Math.random() * areas.length)];
  let num = '';
  for (let i = 0; i < 8; i++) num += Math.floor(Math.random() * 10);
  return `${area}${num}`;
}

/** 生成随机邮箱 */
function genEmail() {
  const names = ['test', 'admin', 'user', 'contact', 'info', 'service'];
  const domains = ['example.com', 'company.com', 'test.org', 'mail.cn'];
  const name = names[Math.floor(Math.random() * names.length)];
  const suffix = Math.random().toString(36).substring(2, 6);
  const domain = domains[Math.floor(Math.random() * domains.length)];
  return `${name}_${suffix}@${domain}`;
}

/** 生成随机统一社会信用代码 */
function genCreditCode() {
  const prefix = `91${String(Math.floor(Math.random() * 90) + 10)}${String(Math.floor(Math.random() * 90) + 10)}`;
  let body = '';
  for (let i = 0; i < 9; i++) body += 'ABCDEFGHJKLMNPQRTUWXY0123456789'[Math.floor(Math.random() * 33)];
  const check = '0123456789ABCDEFGHJKLMNPQRTUWXY'[Math.floor(Math.random() * 31)];
  return `${prefix}${body}${check}`;
}

/** 生成随机银行卡号 */
function genBankCard() {
  let num = '62';
  for (let i = 0; i < 17; i++) num += Math.floor(Math.random() * 10);
  return num.slice(0, 19);
}

/** 生成随机金额 */
function genAmount() {
  const base = Math.floor(Math.random() * 9900000) + 100000;
  const cent = Math.floor(Math.random() * 100);
  return `${base}.${String(cent).padStart(2, '0')}`;
}

/** 生成随机中文姓名 */
function genName() {
  const surnames = ['张', '李', '王', '刘', '陈', '杨', '赵', '黄', '周', '吴', '朱', '郑'];
  const names = ['伟', '芳', '敏', '静', '丽', '强', '磊', '洋', '涛', '明', '飞', '峰', '华', '平', '刚', '杰'];
  const s = surnames[Math.floor(Math.random() * surnames.length)];
  const n1 = names[Math.floor(Math.random() * names.length)];
  const n2 = names[Math.floor(Math.random() * names.length)];
  return `${s}${n1}${n2}`;
}

/** 生成随机 QQ 号 */
function genQQ() {
  let num = '';
  for (let i = 0; i < 5 + Math.floor(Math.random() * 6); i++) num += Math.floor(Math.random() * 10);
  return num;
}

/** 生成随机地址 */
function genAddress() {
  const cities = ['北京市朝阳区', '上海市浦东新区', '广州市天河区', '深圳市南山区', '杭州市西湖区', '长沙市岳麓区'];
  const roads = ['中山路', '人民路', '解放路', '建设路', '五一路', '芙蓉路'];
  const city = cities[Math.floor(Math.random() * cities.length)];
  const road = roads[Math.floor(Math.random() * roads.length)];
  const no = Math.floor(Math.random() * 200) + 1;
  return `${city}${road}${no}号`;
}

/** 生成随机工号 */
function genEmployeeId() {
  return `EMP${String(Math.floor(Math.random() * 900) + 100)}`;
}

/** 生成随机年龄 */
function genAge() {
  return String(Math.floor(Math.random() * 48) + 18);
}

// === 格式模板（AI 根据用例上下文自行编写，不随机） ===

/**
 * 格式模板字段 — 返回格式规范字符串（以 FORMAT: 开头），AI 读取后根据上下文填写具体内容。
 * 命中以下规则时，结果以 "FORMAT:" 前缀标记，表示需要 AI 自行编写而非使用生成器值。
 *
 * 预期结果：每行 ^^N^^ 开头
 * 操作步骤：N、格式，引用 <<要素>>「字段」
 * 案例名称：正向/反向描述
 * 案例描述：1-3 句验证目标
 * 前置条件：一行系统状态描述
 * 测试数据：键值对
 * 测试意图：1-2 句测试目的
 */

// === 码值选择：返回固定选项集，LLM 自行从集合中选择 ===

function getEnumValues(labelText) {
  const t = labelText.replace(/\s+/g, '');
  if (t.includes('案例类型')) {
    return 'ENUM: [业务规则, 业务要素]（默认选 业务规则）';
  }
  if (t.includes('案例性质')) {
    return 'ENUM: [正向案例, 反向案例]（默认选 正向案例；反向用例场景选 反向案例）';
  }
  return null;
}

// === 格式模板：返回 FORMAT 规范字符串，LLM 按格式自行填充 ===

function getFormatTemplate(labelText) {
  const t = labelText.replace(/\s+/g, '');
  if (t.includes('检查点')) {
    return 'FORMAT: N、格式，N从1自增。每行描述步骤后的系统状态/校验结果。\n'
         + '1、交易状态，失败\n'
         + '2、提示信息，拒绝原因：[具体字段]不能为空';
  }
  if (t.includes('预期结果') || t.includes('预期')) {
    return 'FORMAT: N、格式，N从1自增。行为级描述（交易状态、提示信息、拒绝原因等）。\n'
         + '1、交易状态，[成功/失败]\n'
         + '2、提示信息，[具体描述]';
  }
  if (t.includes('操作步骤')) {
    return 'FORMAT: N、操作描述。引用业务要素用<<名称>>，引用字段用「字段名」，字段值用"为值/为空"描述。\n'
         + '1、执行<<新增对公信贷潜在客户>>，输入「证件类型A」为空，提交交易\n'
         + '2、查看交易结果';
  }
  if (t.includes('案例名称') || t.includes('名称')) {
    return 'FORMAT: 正向: 验证[功能]正向流程。反向: 反向验证: [场景]';
  }
  if (t.includes('案例描述') || t.includes('描述')) {
    return 'FORMAT: 1-3句描述验证目标。例: 1. 系统应正确处理输入 2. 提交后出现成功提示';
  }
  if (t.includes('前置条件') || t.includes('前置')) {
    return 'FORMAT: 一行描述操作前的系统状态。例: 已登录系统，进入XX页面';
  }
  if (t.includes('测试数据') || t.includes('数据')) {
    return 'FORMAT: 字段名: 值 键值对。批量用角色+列表。例: 客户名称: 空值\n证件号码: 110101199001011234';
  }
  if (t.includes('测试意图') || t.includes('意图')) {
    return 'FORMAT: 1-2句描述测试意图。例: 验证新增潜客时输入非法数据，系统应拦截并提示错误';
  }
  return null;
}

/** 根据 label 文本命中特殊规则，返回 [匹配值, 规则名]；未命中返回 [null, null]
 *  随机生成器 → 返回生成值
 *  码值选择  → 返回 "ENUM: ..." 字符串
 *  格式模板  → 返回 "FORMAT: ..." 字符串 */
function matchSpecialRule(labelText) {
  const t = labelText.replace(/\s+/g, '');
  // 随机生成器（12 组）
  if (t.includes('身份证') || t.includes('身份证号') || t.includes('证件号码') || t.includes('居民身份证')) return [genValidIdCard(), '身份证'];
  if (t.includes('电话') || t.includes('手机') || t.includes('手机号') || t.includes('联系电话') || t.includes('联系方式') || t.includes('电话号码')) return [genMobile(), '手机号'];
  if (t.includes('单位电话') || t.includes('固定电话') || t.includes('座机')) return [genLandline(), '座机'];
  if (t.includes('邮箱') || t.includes('Email') || t.includes('电子邮箱')) return [genEmail(), '邮箱'];
  if (t.includes('统一社会信用代码') || t.includes('信用代码')) return [genCreditCode(), '信用代码'];
  if (t.includes('银行卡') || t.includes('银行卡号') || t.includes('银行账号')) return [genBankCard(), '银行卡'];
  if (t.includes('金额') || t.includes('价格') || t.includes('费用') || t.includes('工资') || t.includes('收入')) return [genAmount(), '金额'];
  if (t.includes('邮编') || t.includes('邮政编码')) return ['100000', '邮编'];
  if (t.includes('姓名') || t.includes('用户名') || t.includes('联系人')) return [genName(), '姓名'];
  if (t.includes('QQ') || t.includes('QQ号') || t.includes('QQ号码')) return [genQQ(), 'QQ'];
  if (t.includes('地址') || t.includes('详细地址') || t.includes('联系地址')) return [genAddress(), '地址'];
  if (t.includes('工号') || t.includes('员工编号')) return [genEmployeeId(), '工号'];
  if (t.includes('年龄')) return [genAge(), '年龄'];
  // 码值选择（2 组）— 返回 ENUM: 字符串，LLM 自行从集合中选择
  const ev = getEnumValues(t);
  if (ev) return [ev, '码值'];
  // 格式模板（8 组：检查点 + 预期结果 + 操作步骤 + 案例名称 + 案例描述 + 前置条件 + 测试数据 + 测试意图）— 返回 FORMAT: 字符串
  const fmt = getFormatTemplate(t);
  if (fmt) return [fmt, '模板'];
  return [null, null];
}
```

## 集成到 Playwright 脚本

在脚本中使用 `matchSpecialRule(labelTrim)` 命中规则，自动填入合法随机值：

```javascript
const ID_CARD = genValidIdCard();           // 全局复用相同身份证号
const MOBILE = genMobile();                 // 全局复用相同手机号
const CERT_NO = (() => {                    // 唯一证件号（含校验位）
  const now = Date.now();
  const ts = now.toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  const raw = '9' + ts.slice(-4) + rand;
  const checkDigit = '0123456789ABCDEFGHJKLMNPQRTUWXY'[raw.split('').reduce((s, c) => (s + c.charCodeAt(0)) % 31, 0)];
  return (raw + checkDigit).padEnd(18, 'X').slice(0, 18);
})();

// 填写时：
const label = '联系电话';
const [val, ruleName] = matchSpecialRule(label);
if (val) {
  console.log(`[特殊规则] "${label}" → ${ruleName}: ${val}`);
  await setInput(page, label, val);
} else {
  await setInput(page, label, '无');
}
```

## 进阶：用户指定值优先

如果用户在对话中明确指定了某个字段的值，**用户指定值优先级高于生成器**：

```javascript
const userOverrides = {
  '姓名': '王五',
  '电话': '13912345678',
  '身份证': '430101199001011234',
};

function getFillValue(labelText) {
  // 1. 用户显式指定
  for (const [kw, val] of Object.entries(userOverrides)) {
    if (labelText.includes(kw)) return [val, `用户指定(${kw})`];
  }
  // 2. 特殊规则生成器
  return matchSpecialRule(labelText);
}
```
