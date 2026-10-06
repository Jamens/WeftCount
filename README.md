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
采购入库 + 生产产出 + 盘盈 = 生产领用 + 销售出库 + 盘亏 + 期末结存
```

入库有三条腿：**采购**买进来的、**生产**（织造报工）织出来的、**盘盈**（库存盘点找到的）；出库侧对应多一条**盘亏**（盘掉的）。早期版本只把采购当入库侧，加了生产产出/盘点调整后都会被误报「去向不明」——现已把 `production_in` / `count_gain` / `count_loss` 分别计入对应侧。盘盈/盘亏是「已解释」的差异（做了盘点并已调整批次），不该再算作 unexplained。

三口径折算到重量后若对不上，差值即「说不清的去向」：报废 / 未记录盘亏 /
录入单位错 / 规格版本漂移。超 3% 容差自动预警，提示指向具体可能原因。

折算一律用「每张单据自己的规格快照」，不同规格、版本各自精确，
不会因混用克重而失真——这是防历史数据漂移的硬约束。

接口：`POST /inventory/{purchase-inbound,production-issue,sales-outbound}`、
`GET /inventory/{batches,documents,transactions,reconcile}`。

### 仓库与调拨（多仓基础）

织造厂按物料形态分仓：纱线进原料库、织出的坯布进坯布库、成品进成品库、废布进废料库。

- 迁移 `1731000000000-CreateWarehouse`：`warehouses` 主数据表（编码 `W+流水`，类型 raw/greige/finished/auxiliary/scrap/other）+ `inventory_batches` 加 `warehouse_id`（批次归属仓库，存量批次先为 NULL）。
- **建批自动归仓**：采购入库 / 生产入库（报工）可指定仓库，不指定则落第一个启用仓。
- **调拨** `POST /inventory/transfer`（权限 `inventory.manage`）：把源批次的一部分数量移到目标仓，在**同一事务**内完成——扣减源批次剩余（扣完标记 `depleted`）、目标仓按同规格快照新建批次、记 `stock_transfer` 出/入两条流水。数量按源批次自己的快照折三视图，**保证调拨前后全库总量守恒**（仓间移动，不影响对账恒等式）。
- 接口 `GET/POST /warehouses`、`PATCH /warehouses/:id`（权限 `warehouse.view/manage`）；前端 `/warehouses` 仓库管理页，库存批次页支持**按仓库筛选**与**调拨**操作，菜单按 `warehouse.view` 门控。

### 库存盘点（仓库管理另一半）

对仓库做实物盘点，建单冻结账面量、录实盘数、按差异过账。

- 迁移 `1731100000000-CreateStocktake`：`stocktakes`（盘点单：仓库/日期/状态 draft·completed·cancelled）+ `stocktake_items`（明细：批次 `bookQuantityM` 账面量冻结 + `countedQuantityM` 实盘量）。
- 流程：建单快照目标仓内所有有剩余的批次账面量 → 录实盘数 → 完成过账。差异 = 实盘 - 账面；**盘盈**加批次剩余记 `count_gain`、**盘亏**减批次剩余（不超扣成负，扣完标 `depleted`）记 `count_loss`，均按批次**自己的规格快照**折三视图，在**同一事务**内完成。未录实盘的明细按账实相符处理。
- 盘点调整是「已解释」的差异：过账后对账把 `count_gain`/`count_loss` 计入恒等式对应侧，不会被误报「去向不明」。
- 接口 `GET/POST /stocktakes`、`GET /stocktakes/:id`、`POST /stocktakes/:id/{counts,complete,cancel}`（权限 `inventory.manage`）；前端 `/stocktakes` 盘点页（建单选仓库、录实盘数、差异着色、账实相符/盘盈/盘亏标签、完成过账），菜单按 `warehouse.view` 门控。

### 全链路追溯

「一件事三算」的护城河兑现：一匹布倒查它的来历——经了哪台织机、哪张工单、哪个供应商的纱。**纯只读穿透查询，不新建表**——数据早已通过 `sourceDocId` / `orderId` / `batchId` / `docId` 串成链，这里只把链条拼出来。

- `GET /traceability/sales/:docId`：销售单倒查 → 客户/销售订单 → 消耗的批次 → 每批来源：
  - **织造产出**批次 → 报工（日期/产出/停机）→ 生产工单（状态/计划/已产）→ **机台**（名称/型号）
  - **采购入库**批次 → 供应商 + 采购订单 + 入库单
  - **调拨**批次 → 递归追溯到最初来源（防环，最多 5 层）
- `GET /traceability/batch/:batchId`：批次双向追溯——来源链 + 被哪些单据消耗（正向）。
- 权限 `report.view`；前端 `/traceability` 追溯页（销售单倒查 / 批次追溯双模式，来源链树状展示，规格工艺卡片），菜单按 `report.view` 门控。

### 供应商条码映射（扫码入库的正宗做法）

到货商品带的是**供应商自己的条码**，系统不认识。建立「供应商条码 → 我方物料+规格」映射，收货时扫供应商条码即可查映射识别、自动带出建批次信息。

- 迁移 `1731600000000-SupplierCodeMappings`：`supplier_code_mappings`（供应商 + 供应商条码 → 物料+规格，唯一约束 company+supplier+code）。
- 端点（挂 partner 模块，`/supplier-codes`）：`GET/POST`、`DELETE /:id`、`GET /lookup?code=&supplierId=`（扫码解析，**只返回 ID**、名称由调用方自己的列表解析，避免跨模块耦合）。
- 扫码解析：带 `supplierId` 精确匹配该供应商；不带则全局查，**命中多条报歧义**（提示先选供应商）——不同供应商可能有相同条码。
- 前端 `/supplier-codes` 映射管理页（增删，partner.view/edit 门控）。
- 桌面「扫码入库」扫供应商条码查映射识别；未命中则回退「扫上批批次码作模板」。

### 桌面端 · 车间工作台（阶段七八）

Electron 客户端直连后端（默认本机 3180，后端已开 CORS），把已有能力搬到车间场景：

- **API 客户端** `renderer/src/lib/api.ts`：axios + `Bearer` token + `X-Tenant-Id`/`X-Company-Id` 三件套（与 admin 一致），统一拆服务端 envelope（成功返回 `data`、失败抛后端 message），会话存 localStorage 免重复登录。
- **登录门禁**：无 token 显示登录页，登录后进入四个页面导航。
- **织机报工**（挡车工核心）：列出**可报工工单**（`scheduled/in_progress`，服务端已带机台名/规格名），选一个填「本次产出(米)+停机分钟」提交 → 调 `/production-orders/:id/reports`，**报工即自动入库为坯布批次**并累加工单进度（满额自动完成）。只依赖 `production.report` 权限——挡车工没有 `production.view`/`material.view` 也能用。
- **车间大屏**：深色底，机台×工单网格（各机台当前工单+进度+交期）、机台数/运转数/在产工单/累计产出汇总、逾期工单与维修机台提示，每 15 秒自动刷新。
- **标签打印**（仓管员，离线）：选仓库→列批次→选批次预览**布匹标签**（CODE128 条码 + 物料/规格/数量/仓库/日期），调主进程 `app:printLabel` 用系统打印机打印。条码与版式**全在本地生成、内联 CSS/SVG，不依赖网络**——车间断网也能打标签。
- **扫码出库**（挡车工/仓管核心）：扫布匹标签条码加入拣货清单（可改数量）→ 确认发货，按**扫到的批次**扣减库存（替代 FIFO 自动拣货，发什么扫什么）。单据限一个规格（首扫批次决定），后端校验批次规格一致、剩余充足。
- **扫码入库**（收货）：到货时商品还没有我们的标签（是收货后才打），所以**不解析外来码**，改为扫**「上批同款」的批次标签作模板**——自动带出物料/规格/仓库，若上批是采购入库再带出供应商，工人只填数量/单价即建新批次。形成闭环「上批入库→打标签→下次收货扫上批→快速建本批」。不扫也能手动选物料规格，收货后提示去打印新标签。
- **扫码查询**：输入框自动聚焦（扫码枪以键盘楔入），扫/输批次码 → 查该批布的档案（物料/规格/数量/仓库/克重）+ **一键看全链路来源**（复用 `traceability/batch/:id`）。与标签打印形成「打印→扫码→追溯」闭环。
- 渲染层 `apps/desktop/src/renderer`，`pnpm dev:desktop` 启动（需后端在线）。条码用 `jsbarcode`(CODE128)。
- **主题（明/暗）**：桌面端自带明暗主题，默认跟随系统 `prefers-color-scheme`，点头部太阳/月亮按钮切换并持久化(localStorage)。ConfigProvider 按模式切 `darkAlgorithm`/`defaultAlgorithm`，品牌主色金 `#BA7517`。所有页面去硬编码配色、一律用 `theme.useToken()` token，Header/Sider/Menu 跟随主题——**此前只写死 darkAlgorithm + 浅色内容背景导致深色组件瘫在浅底上，现已统一**。标签打印预览(标签 HTML)刻意保持浅色，因其打印在白纸上。

> **扫码拣货（出库）**：库存出库接口 `sales-outbound` 支持可选 `pickedItems`（扫码批次+数量），传了按指定批次消耗，不传仍走 FIFO。
>
> **「扫码入库」说明**：到货入库时商品还没有我们的批次标签（是收货后才打），扫的是供应商/厂家码，不在本系统控制范围内，因此未做扫码驱动的入库；入库仍是录入表单（可扫供应商码辅助识别，由客户现场流程决定）。真正有价值的扫码闭环是「**打标签 → 扫标签 → 按批次发货/追溯**」，已完整实现。

### 合同 / 价格（多行明细 + 协议价）

与往来单位签**多行框架协议**：每个「物料+规格」一条**协议单价**(元/米)与协议数量(米)，订单可在生效合同下按协议价成交。

- 迁移 `1731200000000-CreateContracts`：`contracts`(合同头：采购/销售、往来单位快照、状态 draft·active·completed·cancelled、总量/总金额冗余) + `contract_items`(明细行：物料/规格/协议价/协议数量/行金额)。
- **往来单位按合同类型强约束**：采购合同=供应商、销售合同=客户（`both` 通用），须启用。状态机 `draft→active→completed`，`draft/active` 可 `cancelled`；**仅草稿可编辑**（编辑整体替换明细并重算汇总）。
- 总量/总金额 = 明细行汇总（前端实时算，**服务端再算一次为准**）。
- **协议价查询** `GET /contracts/price/lookup?partnerId=&specId=`：返回生效合同中该「往来单位+规格」的协议单价，无则 `null`（供订单建单时取价）。
- 新增权限 `contract.view` / `contract.manage`，授予内置 `company_admin`、`purchaser`、`sales_clerk`(管)、`accountant`(看)。
- 前端 `/contracts` 合同页：列表、建合同（**动态多行明细**编辑，自动算行金额与合同总额）、生效/完成/取消。明细的多行结构同时承载「合同多明细 + 价格层」。

> 订单目前仍是**单行**（一条订单一条明细）；本轮先把「合同多明细 + 协议价」的数据结构立起来，订单多明细是在订单下引用合同行的后续重构。

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

**多明细**（迁移 `1731300000000-OrderMultiLine`）：一个订单含多条明细行 `trade_order_items`（每行一个「物料+规格+数量+单价」），订单头只冗余汇总 `total_quantity_m`/`total_amount`。订单可选关联合同(`contract_id`)，明细行可引用合同行按协议价成交；支持**从合同建单**（带出各行+协议价）。

**按行履约进度**（迁移 `1731400000000-OrderItemFulfillment`）：单据挂订单时记录「履约了哪一行」`inventory_documents.order_item_id`，订单详情返回每行的 `已履约/计划/进度`（`perItem`）。挂单时传 `orderItemId` 则校验该行属该订单且物料规格匹配；不传则按规格**自动归到首个未满行**。历史单据已按「规格=订单行规格」回填，存量数据也能按行归集。前端订单详情每行带进度条 + 「完成 N/M 行」；建单时可选履约明细行（自动带出该行物料/规格）。

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

`apps/admin`（React 19 + Vite 6 + Ant Design 5）已覆盖阶段二全部后端能力，可直接点选操作；菜单按权限（`material.view` / `partner.view` / `purchase.view` / `sales.view` / `production.view` / `cost.view` / `report.view` / `inventory.view` / `warehouse.view` / `inventory.manage` / `user.view` / `role.view`）门控：

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
| 库存批次 | `/inventory/batches` | 列表（规格/状态/仓库筛选），米 + 公斤 + 平方米三视图，可调拨 |
| 三算单据 | `/inventory/documents` | 采购入库 / 生产领用 / 销售出库 三种单据新建 + 详情（折算三视图与关联交易流水）；采购选供应商、销售选客户 |
| 事务流水 | `/inventory/transactions` | 列表（规格/方向筛选），变化量带正负三视图 |
| 三算对账 | `/inventory/reconcile` | 闭环恒等式 + 容差预警 + 分规格明细 |
| 仓库管理 | `/warehouses` | 仓库主数据 CRUD（类型/仓管员/启停用） |
| 库存盘点 | `/stocktakes` | 建盘点单（快照账面量）、录实盘数、差异过账（盘盈/盘亏自动调批次与流水） |
| 全链路追溯 | `/traceability` | 销售单倒查（客户/订单→批次→工单/机台 或 采购/供应商）、批次双向追溯（来源+去向） |

> 后端 `decimal` 列经 JSON 序列化为**字符串**，前端统一用 `apps/admin/src/lib/erp.ts` 的 `dec()` 解析，不盲用 shared 中把 decimal 标成 `number` 的接口声明。

### AI 引擎（阶段五）

大模型**只负责理解意图 / 生成建议 / 解释原因，绝不参与任何数值计算**——数字全部来自确定性引擎。这是本项目的铁律：AI 不可用时系统仍能用（规则兜底），AI 结论一律带来源、置信度与推导依据。

- **配置**（`.env`）：`AI_PROVIDER` / `AI_API_KEY` / `AI_BASE_URL`(默认 DeepSeek) / `AI_MODEL`。**不填 `AI_API_KEY` 也能跑**，自动走确定性规则兜底。
- **LLM 客户端**（`ai/llm.client.ts`）：OpenAI 兼容 `/chat/completions`，超时/错误/无 key 一律优雅降级（返回 `ok:false`），绝不抛出影响主业务。
- **统一结论形态** `AiInsight<T>`：`source`(llm|rule) / `confidence`(0~1) / `derivation[]`(确定性依据) / `reasoning`(理由) / `data`。
- **智能核价**（`ai/pricing.service.ts`，端点 `POST /ai/quote`）：事实包 = 确定性成本(纱线材料+加工费，`shared computeSpecCost`) + 该规格近期成交价带(最近 N 笔销售出库单价)。据此给出建议报价：LLM 生成并校验(不低于成本×(1+最低毛利))，不可用/成本缺失则规则兜底(成本加成向历史均价靠拢；成本未知则按价带均价、标低置信度；成本与价带皆无则明确报错不臆造)。权限 `sales.view`。
- **损耗归因**（`ai/loss.service.ts`，端点 `GET /ai/loss`）：按规格核算 **投料当量(生产领用折算米) vs 实际产出(报工米)**，用工艺系数算标准得布率，`超额损耗 = 投料当量 − 产出`(正=比标准差)，折合金额按成品材料成本/米。AI 归因解释与改进建议(规则兜底)。权限 `cost.view`。
  - 口径要点：生产领用单存的是**成品当量**不是投纱重，实际投纱重由工艺系数(`warpKgPer100m+weftKgPer100m`)从米数推算；**领用折算已含标准损耗，不能重复扣**。得布率恒>100% 说明投料/产出数据缺口(负损耗会被标记)。
- **系数自学习**（`ai/coefficient.service.ts`，端点 `GET /ai/coefficients`、`POST /ai/coefficients/apply`）：从历史「生产领用(投料当量米) / 报工(产出米)」反推该规格**实测多耗倍数 F = 领用米/报工米**（>1 = 实际比设计多耗）。建议校准系数 `clamp(F,1,1.6)`（样本≥3 且 F≤1.6 才判可学习），应用后写入规格 `learned_loss_factor`；算工艺快照时按 **`(1+设计损耗)×F−1`** 折算有效损耗率，**反哺成本/用料/三算的确定性引擎**。因数作用在算快照时而非改设计基准，**反复学习不累积漂移**。权限：分析 `production.view`、应用 `material.edit`（带审计）。
  - 这是「AI 反哺确定性计算」的闭环：AI/统计定系数，**数字仍由 `shared` 引擎算**。
- **用料预测**（`ai/prediction.service.ts`，端点 `POST /ai/prediction`）：按规格工艺单耗(含**实测校准系数**) × 计划产量 = 需经/纬纱 kg；对比当前纱线库存(批次 `remainingWeightKg`) → 采购缺口 → 预计采购成本(有价才估)。AI 给备料采购量/时机/价位建议。权限 `production.view`。
- **排产建议**（`ai/scheduling.service.ts`，端点 `GET /ai/scheduling`）：对未排产(draft)生产工单按**交期升序(EDD)贪心**分配机台——占用天数 = 计划米数 ÷ 该规格日产能(快照 `dailyOutputM`)；机台初始负载含在产/已排工单；产出每单的建议机台/起止天/是否按期 + 逾期风险数。AI 解读排产合理性、点风险给调整建议。权限 `production.view`。
- 前端 `/ai-quote`「智能核价」、`/ai-loss`「损耗归因」、`/ai-coefficient`「系数自学习」、`/ai-production`「AI 生产助手(用料预测+排产建议)」。
- **成本口径**复用成本报表引擎(`CostService.specCost`/`salesPriceBand`)，AI 与成本报表数字一致、可对账。

> 后续 AI 能力（可复用本框架）：用料预测、损耗归因、系数自学习、排产建议。

### 回归冒烟测试（`pnpm test:smoke`）

对**运行中的后端 + 数据库**跑 API 级集成回归，零新增依赖（用 Node 内置 `node:test` + `node:assert`）。`test/smoke/` 下按域拆分：

- `01-auth` — 登录/令牌/`/auth/me`/权限边界(loom 无 cost.view、loom 不可写)/**多租户隔离**(伪造 `X-Tenant-Id`、缺 `X-Company-Id` 被拒)
- `02-inventory` — 采购入库建批次、**销售出库 FIFO**、**扫码拣货(pickedItems)扣指定批次**、超量/规格不符被拒、对账恒等式
- `03-order-contract` — **订单多明细**(表头汇总=各行之和)、**按行履约**(挂单命中行/按行进度/仅已确认可挂)、合同多明细+协议价查询、供应商码映射
- `04-ai` — AI 五能力**结构完整性**(`source`/`confidence`/`derivation`/`data`，llm/rule 都成立，不依赖 key)、用料预测需求=单耗×产量、AI 参数校验

`run.mjs` 自动复用/拉起后端（`apps/server` 目录启动以加载 `.env`）、跑完汇总、失败返回非 0。**测试文件串行执行**（`--test-concurrency=1`）——它们共享同一数据库、都会创建单据，并行会撞单号。

> ✅ 并发单号已修复：所有 `next*`（单号/批号/编码）改为**撞号重取号重试**（`common/util/unique-no.ts` 的 `withUniqueNo`：唯一键冲突 1062 → 递增退避+抖动 → 重取号重试）。库存/订单/合同/生产工单/往来单位的创建均已包裹。冒烟里「并发建单不撞号」用例守护该修复（并发 6 单全部成功且单号互异）。

### 损耗归因到匹（LossHotspot）

`GET /ai/loss/hotspots`（`cost.view`）——把规格级超额损耗**落到该规格织造产出的每一匹**，每匹标注产出工单/机台。用于质量追溯：定位「这个规格损得多，这些匹是它产的、谁织的」。

> 关键口径（诚实设计）：生产领用是「内部转移」进车间池、**不绑具体工单**（有意为之），所以投料无法精确配到单次织造。因此损耗按**规格**归集（与 `analyze` 同一 `computeLoss`），再挂上该规格的件卡。若强行按工单归集会得到无意义的数字。

- `LossService.computeLoss` 抽出为 analyze/hotspots 共用的私有方法（口径唯一）。
- 产出链路：production_in 批次 → sourceDocId=报工 → orderId → 工单号/机台；件卡按 batchId 归集。
- 端点 `GET /ai/loss/hotspots`；前端「AI 损耗归因」页新增可展开的「损耗热点到匹」表（展开显示每匹：件卡号/米数/产出工单/机台）。
- 冒烟 1 例：独立规格 领用100m→产出80m（超额20m）+ 2 匹件卡带工单机台标注。**49/49**。

### 报工按匹（织机产出件卡）

织机产出也可按匹登记——挡车工扫织机件卡逐匹报工，产出的每匹布直接生成件卡，**「匹」贯穿织造→入库→发货→追溯全链**。

- 报工单支持 `rolls: [{rollNo, meters}]`：各匹之和须≈报工产量（容差 max(0.5m, 0.1%)），同号拒；通过则按各匹生成件卡（`sourceType=production_in`，重量按 `kg/m` 折算）关联到本次产出批次。
- 桌面「报工」页支持**按米数 / 按匹**两种模式（件卡模式扫件卡逐匹登记、合计自动填产量、生成可追溯件卡）。

至此「匹」维度完整闭环：**织造产出(报工按匹) → 采购入库(逐匹) → 销售发货(逐匹) → 单匹全链路追溯**。

### 件卡全生命周期（逐匹发货 + 单匹追溯）

「匹」贯穿始终：入库逐匹登记 → 库存按匹 → **发货逐匹整出** → 每匹可全链路追溯。

- **逐匹发货**（销售/领用）：出库单支持 `pickedRolls: [{rollNo}]`，扫件卡发整匹（发什么扫什么）。校验件卡存在/`in_stock`（**防重发**）/所属批次规格与单据一致/批次剩余充足；出库量 = 各件卡米数之和。发货后件卡置 `sold`（销售）/`consumed`（领用）并记录 `outbound_doc_id`。
- **单匹追溯** `GET /inventory/rolls/trace?rollNo=`（`report.view`）：一匹布的完整来历与去向——件卡(米数/状态) → 批次(规格/克重) → 入库单(供应商 + 采购订单) → [已出库] 出库单(客户 + 销售订单)。全部为已落库的确定性事实。
- **件卡查询** `GET /inventory/rolls/lookup?rollNo=`（`inventory.manage`）：发货扫码用的轻量查询(米数/规格/批次/状态)。
- 桌面「扫码出库」页支持**按批次 / 按件卡**两种模式（件卡模式扫件卡整匹发货，件卡不可重复发）。

### 扫码逐匹计数（件卡）

仓储/织造按「匹」管理坯布，每匹布有自己的件卡与米数。入库时可**逐匹扫码计数**——扫一张件卡 = 收一匹，比手输总量更贴近真实收货、且天然防重扫。

- 迁移 `1731800000000-Rolls`：`rolls` 件卡表（`roll_no` **公司内唯一**→防重扫、`meters`、`weight_kg`、`status`、`batch_id`）。
- 采购入库单可带 `rolls: [{rollNo, meters}]`：
  - 校验**各匹米数之和 ≈ 入库总量**（容差 max(0.5m, 0.1%)），不一致拒单——防「数了 3 匹却按 100m 入账」。
  - 同单内 `rollNo` 重复拒单（防重扫）。
  - 通过则按各匹生成件卡记录并关联到新批次；件卡重量按 `批次kg/m × 该匹m` 折算。
- 桌面「扫码入库」页新增**逐匹模式**：开/关切换、扫件卡计一匹（默认每匹米数可改）、同号提示、标签式展示各匹、合计自动填入数量（强制以米计）。入口：数量行「逐匹模式」按钮。

### 导入导出（零依赖）

批量建档（物料/规格字段多，逐条点太慢）与报表导出。**坚持零新增依赖**：

- `server/src/common/csv.ts` — CSV 解析/生成（支持引号内逗号/换行/转义；导出带 UTF-8 BOM，Excel 中文不乱码）
- `server/src/common/xlsx.ts` — **极简 XLSX 写入器**：xlsx 本质是 zip，用 Node 内置 `zlib.deflateRawSync` + 自写 CRC32/zip 头逐文件构造，不引第三方库
- `modules/import-export`：物料/规格的**模板下载(CSV) → 批量导入 → 物料导出(XLSX)**；导入**逐行校验，错误行不影响其他行**，返回每行的行号+原因
- 端点 `/import-export/{materials|specs}/{template|import|export}`，导入权限 `material.edit`、模板/导出 `material.view`，导入带审计
- 前端 `/import-export` 导入导出中心：拖拽选文件（`FileReader` 读文本提交，避免 multipart 依赖）→ 导入 → 结果卡片（成功/失败统计 + 错误行明细表）

> 决策：**导入用 CSV、导出用 XLSX**。xlsx 解析需解压+XML 解析，复杂度高；CSV Excel 原生可开可编辑、解析零风险。导出用 xlsx 更好看。

### 打印模板（浏览器打印，零依赖）

`admin/src/lib/print.tsx` 提供打印基建：`usePrint()` 把 ReactNode 用 Portal 渲进专用 `.print-root`
容器（`flushSync` 保证打印前 DOM 就绪），配 `@media print` 隐藏页面其余部分，调 `window.print()`。
配套 `SheetHeader/MetaGrid/DetailTable/SheetFooter` 单据组件，A4 纵向、黑白细边框。

已接入的单据（`admin/src/components/print-docs.tsx`）：
- **规格单**：工艺参数（克重/用纱单耗/日产能/损耗系数），数据取 `GET /greige-specs/:id/snapshot`
  ——**工艺快照为确定性计算，打印不含 AI 推测**。入口：规格列表「详情」抽屉 → 打印规格单。
- **生产工单**：机台随工单（挡车工用），含织造参数与签字栏，数据取工单内嵌 `specSnapshot`。
  入口：生产工单列表操作列「工单」按钮。

### 趋势分析（零依赖 SVG 图表 · 深化版）

`GET /analytics/trends?days=N`（7~180，缺省 30，权限 `cost.view`）——**确定性聚合，不做预测**：

- **日产量**：报工产出批次(`production_in`)按 `inbound_at` 日聚合米数/公斤
- **日采购/销售金额**：单据按 `created_at` 日聚合 `total_amount`
- **规格产量占比**：报工产出按规格 SUM，取 Top N
- **损耗趋势**（深化）：日 **投料(生产领用) vs 产出(报工)**，当日损耗=投料−产出，**累计损耗滚存**。领用与产出按日不严格配对（纱按批领、织造跨天），故**以累计差看趋势**最有意义；诚实标注此口径。
- **匹维度**（深化）：日 **产出匹/发货匹**、当前**在库匹数**、**机台产出 Top**(匹数+米数，批次→报工→工单→机台 聚合)
- **缺失日期补 0** 保证 X 轴连续

前端 `/trends`：顶部汇总卡（总产量/采购/销售/**在库匹数**）+ **窗口累计损耗 & 损耗率卡** + 累计损耗面积图 + 投料vs产出双折线 + **匹数趋势双线** + **机台产出 Top 横条** + 采购销售双折线 + 规格占比横条 + 柱状。
图表组件在 `admin/src/components/Charts.tsx`——**自建轻量 SVG（LineChart/BarChart/HBarChart），不引入第三方图表库**。

### 预警中心（确定性规则引擎）

主动发现经营风险，不用等用户去查。三类规则**全部由数据库事实推导，不涉及 AI**：

- **交期逾期**：生产工单 `dueDate` 已过但未完成/未取消（超 7 天为严重）
- **库存低位**：物料当前库存(主单位) < **安全库存**（`materials.safetyStock`，只对已设的物料生效；缺货为严重）
- **呆滞批次**：批次入库超 60 天且仍有剩余未动

- 迁移 `1731700000000-Alerts`：`alerts` 表；按 **(类型, 关联对象, 未确认) 去重**——同一问题确认后才在下次扫描重新报，不刷屏。
- 端点 `/alerts`（`GET` 列表 / `GET summary` 角标 / `POST scan` 扫描 / `POST :id/ack` 确认）。权限：读 `inventory.view`、扫描与确认 `inventory.manage`（带审计）。
- 前端 `/alerts`「预警中心」：未确认角标、级别/类型标签、扫描、确认。

### 阶段三 ~ 八 · 待推进

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
