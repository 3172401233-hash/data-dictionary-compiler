# data-dictionary-compiler

零依赖的 Node.js 数据字典编译器。把各数据域用不同格式维护的字段说明（语义类型、
物理类型、单位、可空性、枚举、默认值、版本）编译成**唯一事实来源**：规范化字段定义、
验证规则和下游产物清单，并在版本之间检查删除字段、枚举收窄、类型冲突等兼容性问题。

DLP 列脱敏申请和下游 SQL 生成不再各自手抄定义，而是消费同一份 manifest，
通过指纹发现过期副本。

## 设计原则

- **不猜测**：语义类型、物理类型、单位都必须在注册表（`src/registry.js`）中登记。
  未命中的映射一律保留为 `unresolved` 并写明原因，绝不自动推断。
- **结构错误与语义未知分开**：缺 `name`、字段重名、版本号非法等结构问题直接抛错；
  映射无法确定的问题进入 `unresolved` / `issues`，由人工确认后再登记到注册表。
- **指纹驱动**：每个字段和每类产物带 SHA-256 指纹，定义变更后指纹变化，
  下游可用 `verifyArtifact` 发现漏改的副本。

## 输入格式

编译器内置三套适配器，按字段名自动识别（也可用 `adapter` 显式指定）：

| 适配器 | 识别特征 | 典型来源 |
| --- | --- | --- |
| `canonical` | `name` / `semanticType` / `physicalType` | 规范化字典 |
| `dlp` | `field_name` / `db_type` / `is_nullable` | DLP 脱敏申请表 |
| `sql` | `column` / `type` | 下游 SQL 定义 |

字段描述符支持：`name`、`semanticType`、`physicalType`、`unit`、`nullable`、
`enum`、`default`、`description` 和嵌套 `fields`。嵌套字段递归编译，
路径用点号连接（如 `contact.email`）。

```js
import { compileDictionary, compileHistory } from './src/index.js';

const compiled = compileDictionary({
  name: 'orders',
  version: '1.0.0',
  fields: [
    {
      name: 'status',
      semanticType: 'enum',
      physicalType: 'VARCHAR(16)',
      nullable: false,
      enum: ['pending', 'paid'],
      default: 'pending',
    },
  ],
});
```

## 编译产物

`compileDictionary(input)` 返回：

- `fields`：规范化字段树，每个叶子含解析后的 `semanticType` / `physicalType` /
  `unit` / `nullable` / `enum` / `default`、`rules`、`unresolved` 和 `issues`。
- `rules`：全部叶子字段的规范化验证规则（`not-null`、`type`、`range`、`enum`、
  `unit`、`default`、语义 `format`，以及 `unresolved` 占位规则）。
- `manifest`：下游产物清单，包含三类产物，每类带版本和指纹：
  - `dlp-masking-policy`：按语义类型选择脱敏策略；unresolved 字段输出
    `strategy: 'unresolved'` 与 `manual-review-required`，不自动套用策略。
  - `sql-schema`：列定义、DDL 片段和默认值 SQL 字面量；物理类型无法解析时
    只输出 `-- unresolved` 注释占位，不生成臆造的列类型。
  - `validation-rules`：每个字段的规则清单，供数据校验侧直接消费。

### 产物依赖与漂移检测

下游系统只允许依赖 manifest，不允许再复制字段定义：

```js
import { verifyArtifact } from './src/index.js';

// storedEntries 是下游上次落地时保存的 entries
const result = verifyArtifact(compiled.manifest, 'sql-schema', storedEntries);
// { upToDate: false, currentFingerprint, storedFingerprint }
```

字段任意一项语义定义变化都会改变字段指纹与产物指纹；`upToDate: false`
表示下游副本已过期，必须重新生成。

## 兼容性规则

`compileHistory(inputs)` 按**输入顺序（发布顺序）**逐版本 diff，并额外输出按版本号
排序的字典列表。每条变化带 `severity` 与 `compatible`：

| 变化 | 级别 | 兼容 | 说明 |
| --- | --- | --- | --- |
| 删除字段 `field-removed` | breaking | 否 | 嵌套字段按点路径报告 |
| 新增字段 `field-added` | info | 是 | |
| 枚举收窄 `enum-narrowed` | breaking | 否 | 删除任一枚举值即破坏历史数据 |
| 枚举同时增删 `enum-changed` | breaking | 否 | |
| 枚举扩大 `enum-widened` | info | 是 | |
| 新增/移除枚举约束 | warning/info | 否/是 | 新增约束可能拒绝历史数据 |
| 物理类型放宽 `physical-type-widening` | info | 是 | 如 `INT -> BIGINT`、`VARCHAR(16) -> VARCHAR(32)` |
| 物理类型收窄 `physical-type-narrowing` | breaking | 否 | 如 `BIGINT -> INT`、长度/精度缩小 |
| 类型族冲突 `physical-type-conflict` | breaking | 否 | 如整数族与字符串族互转 |
| 语义类型改变 `semantic-type-changed` | breaking | 否 | |
| 单位可换算 `unit-changed-convertible` | warning | 是 | 带登记的换算系数，下游必须显式换算 |
| 单位同量纲未登记系数 `unit-changed-unregistered` | warning | 否（unresolved） | 不猜系数，需人工补登记 |
| 单位不兼容 `unit-incompatible` | breaking | 否 | 量纲不同或单位未知 |
| 可空收紧 `nullable-tightened` | breaking | 否 | 历史 NULL 无法写入 |
| 可空放宽 `nullable-relaxed` | info | 是 | |
| 默认值新增 | info | 是 | |
| 默认值修改/移除 | warning | 否 | 依赖默认值的写入行为会改变 |

任一侧定义处于 unresolved 时，对应结论保持 `unresolved: true`（warning 级），
不会给出猜测性的兼容判断。

### 版本回滚

新版本号不高于上一发布版本（`<=`，含同号重发）即判定为回滚：
`diff.rollback = true` 且该次发布 `compatible = false`，同时照常列出字段级变化
（回滚通常表现为删除高版本新增字段、枚举回退等）。

### 注册表扩展

内置语义类型、物理类型模式和单位见 `src/registry.js`。新增领域类型时通过
`registryOverrides` 显式登记，登记后编译器才会生成确定性映射：

```js
compileDictionary(input, {
  registryOverrides: {
    semanticTypes: {
      geohash: { physicalFamilies: ['string'], rule: { kind: 'format', format: 'geohash' } },
    },
    units: {
      fathom: { kind: 'length', conversions: { meter: 1.8288 } },
    },
  },
});
```

## 测试

```bash
node --test
# 或
npm test
```

覆盖场景：嵌套字段递归与点路径、单位变化（可换算/不兼容/unresolved）、默认值
（新增/修改/移除/非法字面量）、枚举兼容（扩大/收窄/增删并存）、类型放宽收窄与
冲突、版本回滚，以及 DLP/SQL 遗留格式适配和产物指纹漂移检测。

## 目录结构

```
src/
  version.js    语义版本解析、比较与回滚判定
  registry.js   语义类型/物理类型/单位注册表与类型宽度比较
  normalize.js  多格式适配、字段树规范化、枚举与默认值处理
  rules.js      规范化验证规则生成
  artifacts.js  DLP/SQL/验证产物 manifest 与指纹校验
  diff.js       版本间兼容性检查
  compiler.js   compileDictionary / compileHistory 入口
test/           node:test 测试（夹具位于 helpers/）
examples/       端到端示例：node examples/basic.mjs
```
