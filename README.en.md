# WeftCount

> AI-assisted inventory & ERP for the weaving industry — built for small and mid-size weaving mills.
> Buying by weight, processing by length, selling by area — **three ledgers on the same greige lot must reconcile.**

[中文文档](./README.md) · **English**

---

## What this is

An inventory/ERP system for small and mid-size weaving mills. The differentiator is **not** "it has AI" —
it is **getting the measurement and loss accounting of weaving exactly right**.

Most ERPs treat "yarn consumption, shrinkage, greige GSM, width conversion" as manual work for process
engineers, with formulas scattered across each company's Excel files. This project takes a different approach:

- All industry-published process formulas are **coded, parameterized, and configurable** — never hardcoded
- The greige→finished GSM conversion factor varies by dyeing/finishing route (industry references
  explicitly state "every mill has its own standard"), so the system **learns a private factor** from
  your own measured production history — the more you run it, the more accurate it gets
- Purchase by weight, processing by length, selling by area — **one event, three ledgers**, closed and consistent

## Tech stack

| Layer | Technology |
| --- | --- |
| Desktop (workshop) | Electron 44 + electron-vite 5 + React 19 + TS + Ant Design 5 |
| Admin (web) | React 19 + TS + Vite 6 + Ant Design 5 + Zustand + React Router 7 |
| Server | NestJS 11 + TypeORM + MySQL 8 + JWT + Swagger |
| Shared | `packages/shared`: unit system, yarn-count conversion, process math, domain contracts (dual CJS + ESM build) |
| Build | pnpm workspace monorepo |

## Repository layout

```
WeftCount/
├── apps/
│   ├── admin/          Web admin · React + Vite · port 5180
│   ├── desktop/        Electron workshop terminal · electron-vite
│   └── server/         NestJS API · port 3180 · docs at /api/docs
├── packages/
│   └── shared/         Domain core (the real moat)
│       ├── src/units.ts          measurement unit system
│       ├── src/count-system.ts   yarn count conversions (NeS/Nm/Tex/D)
│       ├── src/weave-math.ts     weaving process calculation core
│       ├── src/tenant.ts         multi-tenant model & roles
│       ├── src/api.ts            API contracts & error codes
│       └── src/constants.ts      business constants
├── scripts/
│   ├── feature-scan.mjs  capability inventory (see below)
│   └── e2e-drill.mjs     end-to-end business-flow drill
├── pnpm-workspace.yaml
└── package.json
```

## Quick start

### Fastest: one command with Docker (try this first)

No Node, no MySQL install — brings up the whole stack (MySQL + API + admin):

```bash
docker compose up -d --build
# admin http://localhost:5180 · API docs http://localhost:3180/api/docs
```

On first start it automatically waits for MySQL, creates the database, runs migrations,
seeds demo data, then starts the services. See [`docker/README.md`](./docker/README.md).
The Electron desktop app still runs on the host.

### Local development

```bash
pnpm install

# create the database
mysql -h127.0.0.1 -uroot -p1234560 -e "CREATE DATABASE IF NOT EXISTS weft_count DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

pnpm --filter @weftcount/server migration:run   # schema
pnpm --filter @weftcount/server seed            # demo tenant + roles + accounts

pnpm dev:server        # http://127.0.0.1:3180/api
pnpm dev:admin         # http://127.0.0.1:5180
pnpm dev:desktop       # Electron workshop terminal
```

Database configuration lives in `apps/server/.env` (see `.env.example`):

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=1234560
DB_NAME=weft_count
```

### Alternative: import SQL directly (skip migrations)

The `sql/` folder contains ready-to-import database scripts — useful for deployment, demos, or
giving a DBA a reviewable DDL:

```bash
mysql -h127.0.0.1 -uroot -p < sql/01_create_database.sql
mysql -h127.0.0.1 -uroot -p weft_count < sql/02_schema.sql
pnpm --filter @weftcount/server seed            # demo data
```

`02_schema.sql` is dumped from a real database and matches the code exactly.
**For upgrading an existing database, still use migrations** (they preserve history).
See [`sql/README.md`](./sql/README.md).

### Verify

```bash
pnpm run verify        # typecheck + test + build
pnpm test:smoke        # regression smoke suite (runs against an isolated test DB)

# capability inventory — answers "does feature X exist?" from facts, not memory
node scripts/feature-scan.mjs
node scripts/feature-scan.mjs idempotency splitRoll

# end-to-end business-flow drill (requires a running server + empty-ish DB)
node scripts/e2e-drill.mjs
```

## Auth & permissions

### Demo accounts

| Account | Role | Scope |
| --- | --- | --- |
| `owner` | Tenant admin | Everything (`*`) |
| `factory` | Factory manager | Full control of one company |
| `craft` | Process engineer | Specs, coefficients, material consumption only |
| `warehouse` | Warehouse keeper | Inventory and stock movements only |
| `loom` | Loom operator | Machine reporting only |

Password for all demo accounts: `weft2026`. **Remove the demo accounts and change default passwords before deploying.**

### Isolation model

The guard **re-checks on every request**, not just at login:

1. JWT validity and expiry distinction
2. User status (disabled/locked → token invalidated immediately)
3. Tenant status (disabled/expired → token invalidated immediately)
4. `X-Tenant-Id` must match the token → prevents cross-tenant access
5. `X-Company-Id` must be in the accessible list → prevents cross-company access
6. `@RequirePermission()` declarative permission check

Permission codes use `<module>.<resource>.<action>` with wildcards. Matching is **bidirectional**
(either side containing `*` matches), avoiding the split where granting `*.view` fails to read `list`.

### Login security

- Unknown username and wrong password return the **same error code** (prevents account enumeration)
- 5 consecutive failures locks the account; after lock, even the correct password is rejected
- bcrypt storage; passwords require ≥8 chars with letters and digits

## Audit logging

### What is recorded

Every **write** operation (POST/PATCH/PUT/DELETE), via an interceptor — business code never calls the
audit API manually, because manual discipline is no discipline. Reads are not logged, otherwise the
table drowns in queries. Sensitive fields (`password`/`token`/`secret`/`apiKey`/`bankAccount`/`idCard`)
are masked to `***` before writing. **Audit write failures are logged as warnings and never fail the
business operation.**

### Key design points

- Login is also audited; the identity is taken from the transaction result since no token exists yet
- Records carry `targetType` + `targetId`, enabling **per-object change history**
  (`GET /audit-logs/target?targetType=&targetId=`)
- Queryable by operator, module, action, and time range

## Domain core

### Unit system

| Dimension | Units |
| --- | --- |
| Length | meter, centimeter, yard, foot, inch, 丈 (zhang, ≈3.33 m) |
| Weight | gram, kilogram, tonne, 斤 (jin, =0.5 kg), pound, ounce |
| Area | m², ft², yd² |
| Width | mm, cm, inch, 寸 (cun, =1/3 cm), 分 (fen, =1/3 mm) |
| Density / fineness | ends/inch, ends/cm, Tex, Denier (D) |
| Counters | 匹 (pi, a bolt/roll of fabric), 卷 (roll), 筒 (bobbin), 件 (piece) |

Meter, gram and m² are base units. Same-dimension conversion is allowed; cross-dimension conversion is
**rejected with an error** (area/length bridging requires the dedicated `weave-math` functions).

### Yarn count systems

English NeS / metric Nm / Tex / Denier D, all normalized internally to Tex (g/1000m).

Key constants are derived from physical definitions and **must never be hardcoded in business layers**:

```ts
INCH_TO_METER    = 0.0254          // ends/inch → ends/m is ×39.3701, NOT ×2.54
TEX_PER_NES      = 590.5412        // Tex = 590.5412 / NeS
DENIER_PER_TEX   = 9// D = Tex × 9 (1 gram per 9000 m)
TEX_NM_PRODUCT   = 1000// Nm is km/kg, so Nm × Tex = 1000
```

Verification baseline: 40 NeS cotton yarn → 14.76 Tex / 67.73 Nm / 132.87 D, matching industry standards.

### Weaving process calculations

All coefficients are configurable with factory / customer / order override precedence:

| Capability | Notes |
| --- | --- |
| GSM | Strict form (ends/inch × 39.3701 × Tex/1000) and industry empirical form (ends/NeS × 23.25) coexist; total is always exactly warp + weft |
| Yarn consumption | Derived from GSM: `kg/100m = g/m² × width÷10 × (1+loss rate)`, strictly consistent with GSM |
| Shrinkage | Definition-based (warp and weft handled independently), supports greige ↔ finished density conversion |
| Daily output | `rpm × 1440 ÷ picks-per-meter × efficiency`, picks-per-meter uses ×39.3701 |
| Coefficient learning | Greige→finished GSM, damped weighted mean, trust weight capped at 0.8, confidence rises monotonically with sample size |

Loss rate and shrinkage are kept **separate rather than merged into a single 1.1** — warp has sizing +
warp shrinkage, weft has weft shrinkage + yarn drop; merging them makes loss attribution impossible.

### Corrections against published industry references

Cross-verification during implementation surfaced several errors in public references that cause
**order-of-magnitude** mistakes. These are fixed and documented in code comments:

| Item | Common (incorrect) form | This implementation | Deviation |
| --- | --- | --- | --- |
| Picks per meter | weft density × 2.54 | weft density × 39.3701 | 2.54 converts ends/inch→ends/cm — 15.5× too large |
| GSM (g/m²) | (warp+weft) × 1.159 / (2.54 × yarn count) | (warp+weft) × 23.2497 / yarn count | 1.159 appears to be a digit-shifted 59.05 — 50.9× too small |
| Shrinkage | greige density × weave coefficient × … | Definition-based, warp/weft independent | The published form applies a transverse parameter to longitudinal shrinkage — physically invalid |
| GSM vs. width | Some references multiply width into GSM | GSM excludes width | GSM is an areal density; width only affects yarn consumption |

> ⚠️ Industry references have systematic unit confusion. **Before go-live, verify every coefficient
> against the target customer's process engineers.**

## Multi-tenancy

```
Tenant (subscription entity / group)
  └── Company (mill; inventory accounted independently)
        └── User (may span companies)
```

Every business table carries `companyId`; the guard injects the filter automatically.

| Plan | Companies | Users | AI engine |
| --- | --- | --- | --- |
| Basic · Inventory | 1 | 5 | — |
| Professional · + process algorithms | 3 | 30 | — |
| Flagship · + AI engine | unlimited | unlimited | enabled |

AI capabilities are gated to the top tier as a premium lever (market research suggests small Chinese
mills pay ¥5,000–20,000/year).

### Built-in roles

Modeled on real weaving-mill job functions rather than generic admin/user:

| Role | Boundary |
| --- | --- |
| Tenant admin | Group-level: companies, users, plan management |
| Factory manager | All operations for one company, including process coefficients |
| Process engineer | Specs, coefficient tuning, consumption accounting — **no access to financial documents** |
| Buyer | Suppliers, price comparison, purchase orders, arrival tracking |
| Warehouse keeper | Stock in/out, stocktake, transfers, alert handling |
| Salesperson | Quotes, customer orders, delivery and reconciliation |
| Loom operator | **Only** terminal reporting and own-machine output |
| Accountant | Costing, reconciliation, report export |
| Read-only visitor | Dashboards and reports only |

## API conventions

Uniform response envelope:

```json
{ "code": 0, "message": "ok", "data": {}, "ts": 1730000000000 }
```

Error code ranges:

| Range | Meaning |
| --- | --- |
| 1xxx | General (validation failed, not found, conflict, forbidden) |
| 2xxx | Auth (login failed, token expired, account disabled) |
| 3xxx | Tenant (quota exceeded, company missing, plan upgrade required) |
| 4xxx | Business (insufficient stock, illegal document state, duplicate code) |
| 5xxx | Process (illegal coefficient, incomplete spec, bad formula input) |
| 6xxx | AI (not enabled, upstream error, insufficient data) |

Paginated responses use `records` (not `list`) for the record array. Swagger docs: `/api/docs`.

## Feature progress

### Phase 1 · Foundation

- [x] monorepo skeleton + pnpm workspace
- [x] Nest + TypeORM + MySQL connection + migration system
- [x] Auth + RBAC multi-tenancy
- [x] Audit logging (interceptor records every write)

### Phase 2 · Process measurement core (the moat)

- [x] Multi-unit system and conversions
- [x] Four yarn count systems
- [x] Weaving process formulas (GSM / yarn consumption / shrinkage / daily output)
- [x] Greige→finished GSM coefficient self-learning
- [x] Greige & yarn spec master data (GSM computed by the engine; manual entry only for calibration)
- [x] One event, three ledgers (purchase weight / processing meters / sales area)

### Inventory & three-ledger closure

The same greige lot is accounted three ways — purchase by weight, production by length, sales by area —
and the three must reconcile.

**Data model**

| Table | Purpose |
| --- | --- |
| `inventory_batches` | Batch; base unit = meters, redundant kg/m² views, `specSnapshot` pins conversion basis |
| `inventory_transactions` | Ledger lines; all three views per movement (delta + resulting balance) |
| `inventory_documents` | Documents; purchase / issue / sales share one table |
| `rolls` | Bolt cards (per-roll tracking); `remaining_m` drives split-partial shipping |
| `roll_outbounds` | Per-roll outbound history (one bolt → many shipments) |

**Reconciliation identity**

```
purchase_in + production_in + count_gain = production_issue + sales_out + count_loss + ending_balance
```

Inbound has three legs: **purchase** (bought), **production** (woven via machine reporting), and
**count_gain** (found during stocktake); outbound adds **count_loss** (written off). Early versions
counted only purchases as inbound, so adding production/stocktake produced spurious "unexplained"
differences — `production_in` / `count_gain` / `count_loss` are now assigned to the correct side.
Gains and losses are *explained* differences (a stocktake adjusted the batch), so they must not be
counted as unexplained.

Once converted to weight, any mismatch is an "unexplained destination": scrap / unrecorded write-off /
wrong entry unit / spec version drift. Beyond a 3% tolerance the system raises an alert pointing at
these specific causes.

All conversion uses **each document's own spec snapshot**, so differing specs and versions stay exact
and mixing GSM cannot distort history — a hard constraint against historical drift.

Endpoints: `POST /inventory/{purchase-inbound,production-issue,sales-outbound}`,
`GET /inventory/{batches,documents,transactions,reconcile}`.

### Warehouses & transfers

Weaving mills store by material form: yarn into raw material, woven greige into greige stores, finished
goods into FG, scrap into scrap stores. `POST /inventory/transfer` (perm `inventory.manage`) moves part
of a batch to another warehouse in a **single transaction** — decrementing the source batch (marking
`depleted` when exhausted), creating a target batch from the same spec snapshot, and writing
`stock_transfer` in/out ledger lines. Quantity is converted from the **source batch's own snapshot**,
guaranteeing whole-warehouse quantity conservation.

### Stocktake

Physical counting against a warehouse. Creating a sheet freezes book quantities; roll-level mode
snapshots **each in-stock bolt card** so a missing bolt can be identified individually — necessary once
split-partial shipping means a batch holds both fully shipped and residual bolts. Completing posts
`count_gain` / `count_loss` per difference and never drives a batch negative.

### Full-chain traceability

From a sales document back to the work order, machine and supplier, and from a batch forward to every
destination — all **persisted deterministic facts**, no inference.

### Supplier barcode mapping

The proper way to do scan-driven inbound: map supplier/brand codes to your own item codes once, then
scan the supplier's barcode at receiving. In goods do **not** yet carry your labels, so scanning your
own label at inbound is impossible — the valuable closed loop is **print label → scan label → ship by
batch / trace**, which is fully implemented.

### Desktop · Workshop terminal

Electron app connecting directly to the backend. Views are permission-gated:

| View | Required permission |
| --- | --- |
| Loom reporting | `production.report` |
| Workshop board | `production.view` |
| Scan out / in | `inventory.manage` |
| Label / roll-card printing | `inventory.view` |
| Scan query | `report.view` |

Highlights:

- **Report by the roll** — the loom operator scans roll cards and registers each produced bolt;
  the "bolt" dimension then runs through the entire chain: weaving → inbound → shipping → traceability
- **Split-partial shipping** — ship part of a bolt (e.g. tail fabric); the remainder stays in stock and
  can be shipped later. Cost is recognized **pro rata by meter** (see below)
- **Offline queue** — network failures are queued locally and replayed on reconnect; business errors
  (insufficient stock, spec mismatch) are **never** queued, so real errors surface immediately
- **Report idempotency** — each report carries a `clientRequestId`; retries return the first result
  instead of double-counting output

### Orders & contracts

- Purchase/sales orders as the **planning layer**, multi-line items, contract linkage, and
  **per-line fulfillment progress** (documents record which line they settle)
- Contracts support multiple priced lines with agreed prices; `GET /contracts/price/lookup` powers
  price lookup when building orders

### Costing

A deterministic cost engine — no LLM in the number path. Per-meter cost is derived from
spec snapshot + yarn prices + overhead; gross margin uses the document's own spec version.

### AI engine

Five capabilities, all **hybrid** (deterministic facts first, LLM only for wording/explanation):
intelligent quoting, loss attribution, coefficient self-learning, material demand forecasting,
production scheduling. Every conclusion carries a confidence level and its derivation.

Cost figures are **never** produced by the model. When required data is missing (e.g. no yarn purchase
price), the API **refuses with a clear error** rather than inventing numbers.

Enabled only when `AI_API_KEY` is configured; `AI_ENABLED=false` forces it off for demos or
offline troubleshooting while all capabilities keep returning deterministic results.

### Alerts (deterministic rule engine)

Three rule families, **all derived from database facts, no AI**:

- **Order overdue** — production order past `dueDate`, not completed/cancelled (>7 days = severe)
- **Low stock** — current stock (base unit) < **reorder point**, computed from real outbound history
- **Stale batch** — inbound more than 60 days ago with remaining stock

Deduplication on scan has three rules, all necessary:

1. An unacknowledged alert for the same (type, object) → skip
2. Acknowledged within the **silence period** (default 7 days, configurable per company) → skip
   (otherwise "acknowledge" appears to do nothing, because the condition still holds)
3. A purchase order was already generated from this object's alert and is not cancelled → skip

Low-stock alerts carry a **structured reorder suggestion** (suggested quantity, reorder point, daily
usage, derivation) and can be **converted into a purchase order draft in one click** — spec and supplier
inferred where possible, otherwise the user is prompted (the system does not guess).

### Dev conventions

- One feature per commit, Conventional Commits
- Run tests before committing
- `pnpm run typecheck` and `pnpm run build` must pass before commit
- Do not commit `.workbuddy/`, build output, or dependency directories
- All quantity/amount math goes through the domain functions in `packages/shared`; business layers
  must not reimplement
- Process formula changes must update `packages/shared/src/__tests__/weave-math.test.ts`
- Every new industry formula needs **at least two independent derivations cross-validated** and checked
  against an industry reference value (e.g. 40S → 14.76 Tex)
- **After adding a migration, run `migration:run` against every database in use** (not just the test
  DB). Confirm no `[ ]` remains in `migration:show` — a missed run shows up as HTTP 500
  (Unknown column)
- **Never judge "does feature X exist" from memory** — run
  `node scripts/feature-scan.mjs [keyword]`. The distinction matters: *having an endpoint is not having
  a feature*; the whole chain must be connected

### Local environment notes

The `pnpm-workspace.yaml` settings are required for this Windows environment — **do not delete them
when moving the repo**:

- `nodeLinker: hoisted` — pnpm's isolated linker cannot create symlinks here, which breaks esbuild's
  platform binary lookup and electron's `@electron/get`
- `injectWorkspacePackages: true` — workspace deps are hardlinked instead

## Data sources

Process formulas come from public industry materials published by Chinese textile-education providers
(庄杰化工 / 大耀纺织课堂 — *Zhuangjie Chemical* / *Dayao Textile Classroom*), including greige
process-formula and usage-rate tables and Chinese textile-industry literature.

**Coefficients differ between mills — verify every one against the target customer's process engineers
before go-live.**