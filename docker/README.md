# Docker 一键部署

不装 Node、不装 MySQL，一条命令把整套跑起来（MySQL + 后端 + 管理端）。

```bash
docker compose up -d --build
```

| 服务 | 地址 | 说明 |
| --- | --- | --- |
| 管理端 | http://localhost:5180 | 浏览器打开这个 |
| 后端 API | http://localhost:3180/api/docs | Swagger 文档 |
| MySQL | localhost:3306 | 演示账号 `root` / 见 `.env` |

首次启动会**自动**完成：等 MySQL 就绪 → 建库 → 跑迁移 → 写种子数据 → 启动服务。
日志里能看到每一步。

## 桌面端（Electron）不在容器里

桌面端是带 GUI 的桌面应用，**必须在宿主机运行**：

```bash
pnpm i
pnpm --filter @weftcount/desktop build
pnpm dev:desktop          # 或 pnpm --filter @weftcount/desktop start
```

桌面端默认直连 `127.0.0.1:3180`，与 compose 映射的端口正好一致，**无需额外配置**。

## 登录

演示账号（种子数据写入，密码统一 `weft2026`）：

| 账号 | 角色 |
| --- | --- |
| `owner` | 租户管理员（全部权限） |
| `factory` | 厂长 |
| `craft` | 工艺员 |
| `warehouse` | 仓管员 |
| `loom` | 挡车工（仅报工） |

> ⚠️ **上生产前务必删除演示账号并修改密码。**

## 配置

改 `.env`（可复制 `.env.example`）：

```bash
DB_PASSWORD=your-strong-password   # MySQL root 密码
DB_NAME=weft_count               # 库名
ADMIN_PORT=5180                   # 管理端端口
SERVER_PORT=3180                  # 后端端口
CORS_ORIGIN=https://your-domain   # 收敛跨域来源
AI_API_KEY=sk-...                 # 可选：不配则 AI 走确定性规则兜底
SEED_ON_START=false               # 生产建议关闭（不写演示数据）
```

改完 `docker compose up -d` 生效。

## 常用运维

```bash
docker compose ps                       # 看状态与健康检查
docker compose logs -f server           # 跟后端日志（迁移/seed 过程都在这）
docker compose restart server           # 只重启后端
docker compose down                     # 停止（保留数据卷）
docker compose down -v                  # 停止并**删除数据**（慎用）
```

## 架构要点

**为什么管理端用 nginx 而不是 vite dev server**
生产要的是静态托管。nginx 同时做两件事：提供静态文件 + 把 `/api` 反代到后端容器。
前端代码用**相对路径 `/api`**，因此**换后端地址不需要重新构建镜像**（由
`BACKEND_ORIGIN` 环境变量在容器启动时注入 nginx 模板）。

**为什么要 `depends_on: service_healthy`**
只等「容器启动」不够——MySQL 初始化期间端口已监听但还没真正可用，
后端会 migration 连不上库直接退出。等 healthcheck 通过才启动后端。

**镜像里为何保留 devDependencies**
`migration:run` 用 `typeorm-ts-node-commonjs`、`seed` 用 `ts-node`，
都需要 devDependencies。故镜像不是「纯生产依赖」，换取「容器内能自助迁移」——
对运维更友好。若要瘦身可改用编译产物执行迁移。

**schema 的唯一事实源**
`apps/server/src/migrations/` 才是权威，`sql/02_schema.sql` 是它的快照。
容器启动跑的是**迁移**而非导入 SQL——这样升级镜像时结构自动跟进。
`sql/` 里的 DDL 供「不跑容器时手动建库」与 DBA 审阅使用。

## 数据持久化

MySQL 数据存于命名卷 `mysql-data`，`docker compose down` **不会**删除它。
只有显式 `down -v` 才会清空。