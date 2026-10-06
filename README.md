# 纬数 WeftCount

> 纺织行业 AI 进销存系统 · 面向织造厂
> 买按重量、加工按米数、销售按面积 —— 同一批坯布，三本账必须对得上。

---

## 这是什么

一套面向中小织造厂的进销存系统。核心差异点不在"有 AI"，而在**把织造工艺的计量与损耗算清楚**。

市面多数 ERP 把「纱线用量、织缩率、坯布克重、门幅换算」当工艺员手工活，公式散落在各家 Excel 里。这里的做法是：

- 把行业公开的工艺公式全部代码化、参数化，系数一律可配置，绝不写死
- 坯布克重 → 成品克重的换算系数因染整工序而异（行业资料明确写"每个企业均有其标准"），系统从该厂历史实测数据里**自学习私有系数**，越用越准
- 采购按重量、加工按米数、销售按面积，**一件事三算**闭环一致

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面端 | Electron 44 + electron-vite 5 + React 19 + TS + Ant Design 5 |
| 管理端 | React 19 + TS + Vite 6 + Ant Design 5 + Zustand + React Router 7 |
| 后端 | NestJS 11 + TypeORM + MySQL 8 + JWT + Swagger |
| 共享层 | `packages/shared`：单位体系、支数换算、工艺公式、领域契约（双格式产物 CJS + ESM） |
| 构建 | pnpm workspace monorepo |

## 仓库结构

```
WeftCount/
├── apps/
│   ├── admin/          管理端（Web）· React + Vite · 端口 5180
│   ├── desktop/        桌面端 · Electron + electron-vite · 车间/仓库工作台
│   └── server/         后端 · NestJS · 端口 3180 · 文档 /api/docs
├── packages/
│   └── shared/         领域内核（护城河所在）
│       ├── src/units.ts          计量单位体系
│       ├── src/count-system.ts   纱线支数四体系换算
│       ├── src/weave-math.ts     织造工艺计算内核
│       ├── src/tenant.ts         多租户模型与角色
│       ├── src/api.tsAPI 契约与错误码
│       └── src/constants.ts      业务常量
├── pnpm-workspace.yaml
└── package.json
```

## 快速开始

```bash
pnpm install

# 建库
mysql -h127.0.0.1 -uroot -p1234560 -e "CREATE DATABASE IF NOT EXISTS weft_count DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

pnpm --filter @weftcount/server migration:run   # 建表
pnpm --filter @weftcount/server seed            # 种子数据（演示租户+角色+账号）

pnpm dev:server        # http://127.0.0.1:3180/api
pnpm dev:admin         # http://127.0.0.1:5180
pnpm dev:desktop       # Electron 车间工作台
```

数据库连接配置在 `apps/server/.env`（参考 `.env.example`）：

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=1234560
DB_NAME=weft_count
```

### 验证

```bash
pnpm run verify        # typecheck + test + build
```

## 认证与权限

### 登录

```bash
curl -X POST http://127.0.0.1:3180/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"factory","password":"weft2026"}'
```

返回令牌 + 用户 + 租户 + 可访问公司 + 展开后的权限码。后续请求需带三个头：

| 头 | 用途 |
| --- | --- |
| `Authorization: Bearer <token>` | 身份认证 |
| `X-Tenant-Id` | 租户上下文，须与令牌一致 |
| `X-Company-Id` | 当前操作公司，须在用户可访问列表内 |

### 演示账号

| 账号 | 角色 | 权限范围 |
| --- | --- | --- |
| `owner` | 租户管理员 | 全部（`*`） |
| `factory` | 厂长 | 单公司全权 |
| `craft` | 工艺员 | 仅规格、系数、用料核算 |
| `warehouse` | 仓管员 | 仅库存与出入库 |
| `loom` | 挡车工 | 仅报工与本机产量 |

密码统一 `weft2026`，**部署前必须删除演示账号并改默认密码**。

### 隔离机制

守卫在**每次请求**都复核，而非仅登录时校验：

1. JWT 有效性与过期区分
2. 用户状态（停用/锁定 → 令牌立即失效）
3. 租户状态（停用/过期 → 令牌立即失效）
4. `X-Tenant-Id` 与令牌一致性 → 防跨租户
5. `X-Company-Id` 在可访问列表内 → 防跨公司
6. `@RequirePermission()` 声明式权限校验

权限码格式 `<模块>.<资源>.<动作>`，支持通配。匹配采用**双向通配**（任一侧含 `*` 即命中），避免「给了 `*.view` 却读不到 `list`」的割裂。

### 登录安全

- 用户名不存在与密码错误返回**同一错误码**，防账号枚举
- 连续失败 5 次锁定账号，锁定后正确密码也拒绝
- bcrypt 存储；密码强度要求≥8 位且含字母与数字

## 审计日志

用切面自动记录所有写操作，不依赖业务代码主动调用——靠自觉的审计等于没有审计。

### 记录内容

| 维度 | 说明 |
| --- | --- |
| 操作人 | 用户 id、账号、姓名 |
| 归属 | 租户 id、公司 id |
| 动作 | create / update / delete / submit / approve / reject / cancel / login / logout / export / print / ai_call |
| 对象 | 模块名、对象类型、对象 id |
| 请求 | HTTP 方法、路径、IP、User-Agent |
| 变更 | 字段级前后快照（仅变化的字段） |
| 性能 | 执行耗时（毫秒） |

### 关键设计

1. **审计失败绝不影响主业务**。写入异常只记 warn 日志——宁可丢一条审计，也不能因为审计表写不进去而让采购单下不了。
2. **GET 一律不记**，只记 POST/PUT/PATCH/DELETE，否则日志表会被查询淹没。
3. **登录也记**。「谁登录了系统」是最该被审计的一条，但此时还没有令牌，身份要从事务成功后的响应体里取。
4. **未声明 `@Audit()` 也能用**，切面按路径推断模块名与动作，避免漏加注解。
5. **失败操作也记**（摘要前缀「操作失败」），便于排查反复提交失败的接口。
6. **只增不改不删**——修改审计记录本身就是审计对象。

### 脱敏

密码、令牌、密钥、身份证号、银行账号等字段在写入前递归脱敏为 `***`，深度上限 3 层。
改密码接口的 `oldPassword` 与 `newPassword` 都不会出现在审计里。

### 查询

```bash
GET /api/audit-logs?page=1&pageSize=20&module=auth&action=login&keyword=张
GET /api/audit-logs/target?targetType=MaterialEntity&targetId=xxx
```

需要 `audit.view` 权限。数据库建了三个复合索引，分别覆盖
「本厂近期操作」「单据完整变更史」「某人操作轨迹」三类查询。

## 领域内核

### 计量单位体系

| 维度 | 单位 |
| --- | --- |
| 长度 | 米、厘米、码、英尺、英寸、丈 |
| 重量 | 克、公斤、吨、斤、磅、盎司 |
| 面积 | 平方米、平方英尺、平方码 |
| 门幅 | 毫米、厘米、英寸、寸、分 |
| 密度/纤度 | 根/英寸、根/厘米、特数 Tex、旦数 D |
| 量词 | 匹、卷、筒、件 |

米、克、平方米为基本单位；同维度可换算，跨维度拒绝并抛错（面积/长度桥接须走 `weave-math` 专用函数）。

### 支数四体系

英制 NeS / 公制 Nm / 特数 Tex / 旦数 D，内部统一折算为 Tex（g/1000m）。

关键常数均由物理定义推导，**禁止在业务层硬编码**：

```ts
INCH_TO_METER    = 0.0254          // 根/英寸 → 根/米 是 ×39.3701，不是 ×2.54
TEX_PER_NES      = 590.5412        // Tex = 590.5412 / NeS
DENIER_PER_TEX   = 9// D = Tex × 9（9000 米重 1 克）
TEX_NM_PRODUCT   = 1000// Nm 口径是千米/千克，故 Nm × Tex = 1000
```

校验基准：40 NeS 棉纱 → 14.76 Tex / 67.73 Nm / 132.87 旦，与行业标准值一致。

### 织造工艺计算

已实现（系数全部可配置，按工厂/客户/订单三级覆盖）：

| 能力 | 说明 |
| --- | --- |
| 克重 | 严格式（经密 × 39.3701 × Tex/1000）与行业经验式（经密/NeS × 23.25）双路并存，合计恒等于经向+纬向 |
| 用纱量 | 由克重推导，`kg/100m = g/m² × 幅宽÷10 × (1+损耗率)`，与克重严格恒等 |
| 织缩率 | 定义式（经纬向独立），支持坯布↔成品密度互算 |
| 日产量 | `转速 × 1440÷ 每米纬数 × 运转率`，每米纬数用 ×39.3701 |
| 系数自学习 | 坯布→成品克重，带阻尼加权均值，信任权重上限 0.8，置信度随样本量单调上升 |

损耗率与织缩率**分列**而非合并成 1.1 —— 经向有上浆+经缩，纬向有纬缩+落纱，合并会导致损耗归因无法定位。

### 相对行业公开资料的勘误

实现过程中对公开工艺资料做了交叉验证，发现几处会导致数量级错误的问题，已修正并写进代码注释：

| 项目 | 资料常见写法 | 本实现 | 偏差 |
| --- | --- | --- | --- |
| 每米纬数 | 纬密 × 2.54 | 纬密 × 39.3701 | 2.54 是「根/英寸→根/厘米」，偏大 15.5 倍 |
| 平方米克重 | (经密+纬密) × 1.159 / (2.54 × 纱支) | (经密+纬密) × 23.2497 / 纱支 | 1.159 疑为 59.05 数字错位，偏小 50.9 倍 |
| 织缩率 | 坯布纬密 × 组织系数 ×(...) | 定义式，经纬独立 | 原式把横向参数当纵向收缩，物理不成立 |
| 克重与幅宽 |部分资料将幅宽乘入克重 | 克重不含幅宽 | 克重是面密度，幅宽只影响用纱量 |

> ⚠️ 行业资料存在系统性口径混乱。**上线前必须与目标客户的工艺员逐条核对实测系数。**

## 多租户架构

```
Tenant（租户/集团，订阅主体）
  └── Company（公司/工厂，库存独立核算）
        └── User（用户，可跨公司）
```

所有业务表强制携带 `companyId`，查询由守卫自动注入过滤条件。

| 套餐 | 公司数 | 用户数 | AI 引擎 |
| --- | --- | --- | --- |
| 基础版 · 进销存 | 1 | 5 | — |
| 专业版 · 含工艺算法 | 3 | 30 | — |
| 旗舰版 · 含 AI 引擎 | 不限 | 不限 | 开启 |

AI 能力放最高档做溢价，依据调研结论：国内中小织造厂年费普遍 5000–20000 元。

### 内置角色

刻意贴合织造厂真实岗位，而非通用 admin/user：

| 角色 | 职责边界 |
| --- | --- |
| 租户管理员 | 集团层面：公司/用户/套餐管理 |
| 厂长 | 单公司全部经营操作，含工艺系数配置 |
| 工艺员 | 规格设定、系数调参、用料核算，**碰不到资金单据** |
| 采购员 | 供应商、比价、采购订单与到货跟踪 |
| 仓管员 | 出入库、盘点、移库、预警处理 |
| 业务员 | 报价、客户订单、出库送货与对账 |
| 挡车工 | **仅**终端报工与本机台产量查看 |
| 会计 | 成本核算、对账、报表导出 |
| 只读访客 | 仅查看看板与报表 |

## API 约定

统一响应 envelope：

```json
{ "code": 0, "message": "ok", "data": {}, "ts": 1730000000000 }
```

业务错误码分段：

| 段位 | 含义 |
| --- | --- |
| 1xxx | 通用（校验失败、未找到、冲突、越权） |
| 2xxx | 认证（登录失败、令牌过期、账号停用） |
| 3xxx | 租户（配额超限、公司不存在、需升级套餐） |
| 4xxx | 业务（库存不足、单据状态非法、编码重复） |
| 5xxx | 工艺（系数非法、规格不完整、公式入参错误） |
| 6xxx | AI（未开通、上游异常、数据不足） |

分页响应的记录数组字段名为 `records`（不是 `list`）。Swagger 文档：`/api/docs`。

## 功能进度

### 阶段一 · 地基

- [x] **1.1** monorepo 骨架 + pnpm workspace（三包并行 dev）
- [x] **1.2** Nest + TypeORM + MySQL 连接 + 迁移体系
- [x] **1.3** 登录鉴权 + RBAC 多租户
- [x] **1.4** 审计日志（切面自动记录所有写操作）

### 阶段二 · 工艺计量内核（护城河）

- [x] 多单位体系与换算
- [x] 纱线支数四体系互转
- [x] 织造工艺计算公式（克重/用纱量/织缩/日产量）
- [x] 坯布→成品克重系数自学习
- [x] 坯布/纱线规格主数据（克重由内核算，手填实测仅用于校准）
- [x] 一件事三算（采购重量/加工米数/销售面积闭环）

### 库存与三算闭环

同批坯布三个记账口径——采购按重量、生产按长度、销售按面积——必须能对上。

**数据模型**

| 表 | 作用 |
| --- | --- |
| `inventory_batches` | 批次，主单位=米，冗余 kg/m² 双视图，`specSnapshot` 锁死换算依据 |
| `inventory_transactions` | 流水，每次移动三视图齐全（变化量 + 变化后余额） |
| `inventory_documents` | 单据，采购/领用/销售三类型共用一表 |

**对账恒等式**

```
采购入库重量 + 生产产出重量 = 生产领用折算重量 + 销售出库折算重量 + 期末结存重量
```

入库有两条腿：**采购**买进来的，和**生产**（织造报工）织出来的。早期版本只把采购当入库侧，
加了生产产出后每米织造布都会被误报「去向不明」——现已把 `production_in` 计入入库侧。

三口径折算到重量后若对不上，差值即「说不清的去向」：报废 / 盘亏 /
录入单位错 / 规格版本漂移。超 3% 容差自动预警，提示指向具体可能原因。

折算一律用「每张单据自己的规格快照」，不同规格、版本各自精确，
不会因混用克重而失真——这是防历史数据漂移的硬约束。

接口：`POST /inventory/{purchase-inbound,production-issue,sales-outbound}`、
`GET /inventory/{batches,documents,transactions,reconcile}`。

### 成本报表（阶段六 · 成本核算）

**制造成本 = 纱线成本 + 加工费**。纱线用量（每百米经/纬纱 kg）由工艺内核快照给出，成本只做「用量 × 单价」的确定性乘法——数字不会错。

- **成本引擎** `packages/shared/src/cost.ts` 的 `computeSpecCost`：纯函数、无 IO、可单测，输入规格快照 + 经纬纱单价 + 加工费，输出物成本/加工费/制造成本（每米·每kg·每m²）+ 售价对比的毛利与毛利率。用量全部取自 `SpecCalculationSnapshot`，规格改了历史成本仍可还原。
- **加工费**（元/米）按规格配置：迁移 `1730900000000-AddSpecOverhead` 给 `greige_specs` 加 `overhead_cost_per_meter`，在坯布规格表单里按电费/人工/机台折旧核定。是成本项、非工艺参数，不影响克重计算。
- **取价规则**：经/纬纱单价取该物料**最近一次采购入库**的 `unitCost` → 回落**物料参考价** `standardPrice` → 0（页面标注来源）；售价取该规格**最近一次销售出库**单价算毛利，无售价则毛利留空不臆造。
- 接口 `GET /cost/analysis`（权限 `cost.view`），按规格列成本构成与毛利；前端 `/cost` 成本报表页，菜单按 `cost.view` 门控。

> 成本是否可信取决于**规格有没有配经/纬纱物料与加工费**——未配置的规格成本为 0、毛利率会显示 100%，属数据未录而非引擎错误。

### 往来单位（供应商 / 客户）

采购与销售单据的 `counterparty` 指向此主数据。隔离维度与物料一致（`tenant_id` + `company_id`），编码在公司内唯一。

- 实体 `partners`，迁移 `1730400000000-CreatePartner`
- 接口：`GET/POST /partners`、`GET/PATCH /partners/:id`、`POST /partners/:id/disable`
- 编码规则：固定前缀 `P` + 4 位流水（如 `P0001`），类型可改为「供应商兼客户」而不必换编码
- 权限门控：`partner.view`（读）/ `partner.edit`（写），内置角色 `company_admin`、`tenant_owner` 已含
- 种子数据：演示租户下预置 3 个往来单位（绍兴金辉棉纺 / 杭州天成服装 / 宁波华联供应链）

**与单据的联动**（迁移 `1730500000000-LinkPartnerToDocs`）：

- `inventory_documents.counterparty`（自由文本）升级为 `partner_id`（外键）+ `partner_name`（开单时名称快照，partner 改名不影响历史单据）
- 按单据类型约束交易对手：**采购入库必须是供应商**、**销售出库必须是客户**（`both` 兼营通用）、**生产领用为内部转移不设往来单位**（多传直接报错）；采购/销售强制必填，避免无供应商的入库单无法参与按供应商对账
- 前端三算单据页按类型显示下拉：采购列供应商、销售列客户、领用不显示

### 采购 / 销售订单（计划层）

在「三算单据（实际收发）」之上补一层**订单（计划/意向）**。采购与销售共用 `trade_orders` 一表、用 `order_type` 区分（与 `inventory_documents` 同样的一表两用风格）。

- 迁移 `1730600000000-CreateTradeOrders`；实体 `TradeOrderEntity`
- 同样走「一件事三算」：只按自然单位录入（采购多按重量 `kg`、销售多按面积 `m2`），用规格快照折出 **米/kg/m²** 三视图并存下；另存 `partner_name` / `spec_snapshot` 名称与规格快照，改名改规格不影响历史订单
- 往来单位按类型强约束：采购订单必须供应商、销售订单必须客户（`both` 通用）、且须启用
- 状态机：`draft → confirmed → completed`，`draft/confirmed` 可 `cancelled`；**仅草稿可编辑**，改动数量/规格会重算三视图与金额
- 单号规则：`PO`/`SO` + 日期 + 流水（按「前缀+日期」Like 取末号，避免跨类型撞号）
- 接口：`GET/POST /orders`、`GET/PATCH /orders/:id`、`POST /orders/:id/{confirm,complete,cancel}`；权限 `purchase.view/manage`、`sales.view/manage`
- 前端 `/orders`：类型/状态/关键字筛选、新建、编辑、确认/完成/取消、详情看三视图

> 当前是**单行订单**（一个订单一条明细），与现有单据一致；多明细后续拆 `trade_order_items` 表，不影响现有逻辑。

**单据 ↔ 订单联动**（迁移 `1730700000000-LinkOrdersToDocs`）：

- `inventory_documents` 加可空 `order_id`：采购入库 / 销售出库可挂到订单上，生产领用不挂（多传报错）
- 挂单严格校验：订单类型须匹配（采购订单↔采购入库、销售订单↔销售出库）、仅「已确认」可挂、且**往来单位/物料/规格须与订单一致**（防止给 A 供应商的订单记 B 的货）
- 订单按关联单据的折米**累计履约量**，满额（留 1cm 容差）自动把订单推为「已完成」；单据不可编辑/删除，履约量只增不减，故满额即完成是安全的
- 订单详情 `GET /orders/:id` 返回 `{ order, fulfilledM, orderedM, progressPct, documents }`；前端订单页展示履约进度条与已关联单据
- 前端三算单据页新建采购/销售单时可「关联订单（可选）」，选中自动带出往来单位/物料/规格

### 生产管理（阶段四 · 织造命脉）

机台 + 生产工单 + 挡车工报工，构成织造生产的最小闭环。三张表（迁移 `1730800000000-CreateProduction`）：

| 表 | 作用 |
| --- | --- |
| `machines` | 机台（织机）主数据，编码 `M+流水`；状态 idle/running/maintenance/retired |
| `production_orders` | 生产工单（织造任务）：计划产量(米)、指派机台、状态机、累计产出 |
| `production_reports` | 挡车工报工：本次产出(米)、报工日期、停机分钟/原因 |

- **工单状态机**：`draft → scheduled → in_progress → completed`，`draft/scheduled/in_progress` 可 `cancelled`；**排产/开工前必须已指派机台**（未指派机台的机台不可指派、报废机台不可用）
- **报工**：针对「已排产/生产中」且已指派机台的工单；产出累加到 `produced_quantity_m`，**首次报工自动转「生产中」，满额（1cm 容差）自动转「已完成」**；报工记录不可编辑/删除，产出只增不减
- 工单详情 `GET /production-orders/:id` 返回 `{ order, reports, progressPct }`
- 权限：`production.view`（读）/ `production.order.edit`（建/指派/排产/开工/完成）/ `production.report`（报工）；均已含在内置 `company_admin` 等角色
- 前端 `/production`：「生产工单」Tab（列表/新建/指派机台/排产/开工/报工弹窗/进度条/报工记录）+「机台」Tab（列表/新建/编辑）

> 报工产出**自动生成坯布入库批次**：报工与入库在**同一事务**内完成（存报工+累计产出+推进状态+建批次），任一步失败整体回滚，不会出现「报了工但没库存」。产出批次 `sourceType=production_in`，可经 批次→报工→工单 回溯是哪张工单织出来的。打通「织造产出 → 坯布库存 → 销售/领用」全链闭环。

### 用户 / 角色管理

`users` / `roles` 两表早已存在，但此前只有 `login / me / switch-company / change-password / permissions` 端点，缺管理接口。本次补齐。

- 角色：内置 9 个按租户复制（`builtin=true`，系统所有、可改权限、不可删）；可新建 `builtin=false` 自定义角色，删除前校验「仍被用户引用」
- 用户：新建/编辑（资料、状态、所属公司 `companyIds`、角色 `roleCodes`）、重置密码；列表回传公司名与角色名，**绝不返回 `passwordHash`**
- 公司与角色都做**归属校验**：只能关联本租户的公司与角色
- 密码统一走强度校验（≥8 位且含字母+数字），改密/重置均不可与原密码相同
- 权限门控：`user.view` / `user.manage` / `role.view` / `role.manage`；已授予内置角色 `company_admin`（演示 `factory` 账号）与 `tenant_owner`
- 接口：`GET/POST /users`、`PATCH /users/:id`、`POST /users/:id/reset-password`；`GET/POST /roles`、`PATCH /roles/:id`、`DELETE /roles/:id`

> **NestJS DTO 必须「值导入」**：控制器里 `@Body() dto: XxxDto` 的 DTO 要用普通 `import`，用 `import type` 会在编译期把 `design:paramtypes` 塌成 `Function`，导致 `ValidationPipe` 的 `whitelist/forbidNonWhitelisted` 把正常字段判为「should not exist」。

### 前端 admin（阶段二界面）

`apps/admin`（React 19 + Vite 6 + Ant Design 5）已覆盖阶段二全部后端能力，可直接点选操作；菜单按权限（`material.view` / `partner.view` / `purchase.view` / `sales.view` / `production.view` / `cost.view` / `inventory.view` / `inventory.manage` / `user.view` / `role.view`）门控：

| 页面 | 路由 | 能力 |
| --- | --- | --- |
| 物料主数据 | `/materials` | 列表（关键字/大类/状态筛选）、抽屉新建、停用 |
| 往来单位 | `/partners` | 供应商/客户档案：列表（关键字/类型/状态筛选）、新建、编辑、停用；编码 `P+流水` 自动生成 |
| 采购/销售订单 | `/orders` | 计划层：类型/状态/关键字筛选、新建、编辑(草稿)、确认/完成/取消、详情看三视图 |
| 生产管理 | `/production` | 生产工单（指派机台/排产/开工/报工/进度/报工记录）+ 机台主数据 |
| 成本报表 | `/cost` | 按规格列成本构成（经纬纱成本/物成本/加工费/制造成本 每米每kg每m²）+ 售价/毛利/毛利率 |
| 用户管理 | `/users` | 列表（含公司/角色名）、新建、编辑资料/状态/公司/角色、重置密码 |
| 角色管理 | `/roles` | 角色列表（内置/自定义）、新建自定义角色、编辑权限、删除（内置/被引用不可删） |
| 坯布规格 | `/greige-specs` | 列表、新建；表单内「试算预览」实时看克重/用纱量/日产量（工艺内核计算） |
| 库存批次 | `/inventory/batches` | 列表（规格/状态筛选），米 + 公斤 + 平方米三视图 |
| 三算单据 | `/inventory/documents` | 采购入库 / 生产领用 / 销售出库 三种单据新建 + 详情（折算三视图与关联交易流水）；采购选供应商、销售选客户 |
| 事务流水 | `/inventory/transactions` | 列表（规格/方向筛选），变化量带正负三视图 |
| 三算对账 | `/inventory/reconcile` | 闭环恒等式 + 容差预警 + 分规格明细 |

> 后端 `decimal` 列经 JSON 序列化为**字符串**，前端统一用 `apps/admin/src/lib/erp.ts` 的 `dec()` 解析，不盲用 shared 中把 decimal 标成 `number` 的接口声明。

### 阶段三 ~ 八 · 待推进

库存批次 → 采购销售 → 生产工单排产报工 → AI 引擎 → 成本报表追溯 → 桌面端离线与打印

## 开发规范

- 单功能单 commit，commit message 使用 Conventional Commits
- 每个功能完成后先跑测试，通过再提交
- 提交前必须 `pnpm run typecheck` 与 `pnpm run build` 通过
- 不提交 `.workbuddy/`、构建产物、依赖目录
- 涉及金额与数量的计算一律走 `packages/shared` 的领域函数，业务层不重复实现
- 工艺公式改动必须同步更新 `packages/shared/src/__tests__/weave-math.test.ts`
- 新增行业公式必须做**至少两路独立推导交叉验证**，并用行业标准值（如 40S → 14.76 Tex）校验

## 本机环境适配说明

`pnpm-workspace.yaml` 中的配置是本机 Windows 环境的必要适配，**迁仓时不要直接删**：

- `nodeLinker: hoisted` —— 本机 pnpm isolated linker 无法建立符号链接，会导致 esbuild 找不到平台二进制、electron 找不到 `@electron/get`
- `injectWorkspacePackages: true` —— workspace 依赖改用硬链接注入

## 资料来源

工艺公式来自行业公开资料（庄杰化工 / 大耀纺织课堂、坯布工艺公式与用坯率表）与《中国纺织工业》类行业文献。

**不同企业的实际系数存在差异，上线前必须与目标客户的工艺员逐条核对。**
