# `sql/` · 建库脚本

开源用途：**不装 Node 也能建库**，或给运维/DBA 一份可审阅的 DDL。

## 文件

| 文件 | 用途 |
| --- | --- |
| `01_create_database.sql` | 创建空库（utf8mb4） |
| `02_schema.sql` | 全部 26 张表的 DDL（**从真实数据库导出**，与代码 100% 一致） |
| `03_seed_reference.sql` | 演示数据说明（用 `pnpm seed` 生成，不提供 INSERT） |

## 两条建库路径

### A. 直接导入 SQL（推荐给「只想跑起来看看」）

```bash
mysql -h127.0.0.1 -uroot -p < sql/01_create_database.sql
mysql -h127.0.0.1 -uroot -p weft_count < sql/02_schema.sql
pnpm --filter @weftcount/server seed        # 演示数据（可选）
```

### B. TypeORM 迁移（推荐给「要长期演进/升级」）

```bash
pnpm --filter @weftcount/server migration:run
pnpm --filter @weftcount/server seed
```

两者**结构相同**。区别：

- **A** 是一次性快照，不带迁移历史 —— 适合部署、演示、给 DBA 审阅
- **B** 记录迁移历史 —— **升级已有库必须走 B**，否则后续迁移无法接续
  （`apps/server/src/migrations/` 才是 schema 的source of truth）

## 约定

- **列名**：实体用驼峰，数据库列由 `WeftNamingStrategy` 自动转下划线。
  即 entity 的 `createdAt` → DB 的 `created_at`；**不要在`@Column` 上写 `name:`**。
- **utf8mb4 必需**：物料/规格名可能含中文与特殊符号，utf8（3 字节）存不下。
- 本目录**不含任何本机凭证**（无密码、无绝对路径）；`02_schema.sql` 也不含数据行。

## 与seed 的关系

演示数据（租户/角色/账号/物料/规格/件卡）由 `apps/server/src/seeds/` 生成，
**刻意不提供 SQL 版**——固定 UUID 写死在 SQL 里换库就对不上，且无法随代码演进。
`03_seed_reference.sql` 说明了seed 会生成什么。

## 重新导出 schema

改了实体/迁移后，用**干净库**重新导出，避免混入本地数据：

```bash
node reset-db.mjs weft_count_sqldump      # 建干净库并跑完所有迁移
mysqldump -u<pwd> --no-data --skip-add-drop-table --skip-comments --compact \
  --set-gtid-purged=OFF weft_count_sqldump > sql/02_schema.sql
```
