#!/bin/sh
# ============================================================
# WeftCount · 后端容器启动脚本
# ------------------------------------------------------------
# 职责：等MySQL 就绪 → 跑迁移 → 可选 seed → 启动服务
# 幂等：迁移记录在 `migrations` 表，重复启动不会重复建表；
#      seed 自身幂等（按 code 判重），失败不阻断启动（种子数据非必需）。
# ============================================================
set -e

echo "[entrypoint] 等待 MySQL…"
# 用「建一个临时库再删掉」探活：比只看端口更可靠（端口可能已监听但还在初始化）
ATTEMPTS=0
until node -e "
const mysql=require('mysql2/promise');
mysql.createConnection({host:process.env.DB_HOST||'mysql',port:+(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||''})
  .then(c=>c.query('SELECT 1')).then(()=>process.exit(0)).catch(()=>process.exit(1));
" 2>/dev/null; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -gt 60 ]; then
    echo "[entrypoint] MySQL 等待超时（120s），放弃"
    exit 1
  fi
  sleep 2
done
echo "[entrypoint] MySQL 就绪"

# 建库（若不存在）。DDL 来自 sql/，保证与代码一致
DB_NAME="${DB_NAME:-weft_count}"
node -e "
const mysql=require('mysql2/promise');
const db=process.env.DB_NAME||'weft_count';
mysql.createConnection({host:process.env.DB_HOST||'mysql',port:+(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||''})
  .then(c=>c.query('CREATE DATABASE IF NOT EXISTS \`'+db+'\` DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_unicode_ci'))
  .then(()=>{console.log('[entrypoint] 数据库就绪: '+db);process.exit(0)})
  .catch(e=>{console.error('[entrypoint] 建库失败',e.message);process.exit(1)});
"

# 迁移（TypeORM）——schema 的唯一事实源
# 与本地脚本一致：在 apps/server 目录下执行（-d src/data-source.ts）
cd /app/apps/server
echo "[entrypoint] 执行数据库迁移…"
npx typeorm-ts-node-commonjs -d src/data-source.ts migration:run

# 种子数据（可选）：演示租户/角色/账号/物料/规格/件卡
if [ "${SEED_ON_START:-true}" = "true" ]; then
  echo "[entrypoint] 写入种子数据…"
  # seed 失败不应阻断服务启动（业务数据可后续手工导入）
  npx ts-node src/seeds/index.ts || echo "[entrypoint] seed 失败，跳过（不影响服务启动）"
fi

cd /app
echo "[entrypoint] 启动服务: $*"
exec "$@"