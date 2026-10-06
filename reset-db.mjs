/**
 * 重置指定数据库：drop → create → migration:run → seed
 * 用法：node reset-db.mjs [库名，默认 weft_count]
 * 注意：会清空该库全部数据（仅用于本地开发库）。
 */
import { spawnSync } from 'node:child_process'
import mysql from 'mysql2/promise'

const DB = process.argv[2] ?? 'weft_count'
const conn = await mysql.createConnection({
  host: '127.0.0.1', port: 3306, user: 'root', password: '1234560', multipleStatements: false,
})

// 断开该库现有连接后删除重建
await conn.query(`DROP DATABASE IF EXISTS \`${DB}\``)
await conn.query(`CREATE DATABASE \`${DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
console.log(`[reset] 已重建空库 ${DB}`)
await conn.end()

const env = { ...process.env, DB_NAME: DB }
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: 'apps/server', env, shell: true, stdio: 'inherit' })
  if (r.status !== 0) {
    console.error(`[reset] ${cmd} ${args.join(' ')} 失败`)
    process.exit(r.status ?? 1)
  }
}
run('npx', ['typeorm-ts-node-commonjs', '-d', 'src/data-source.ts', 'migration:run'])
run('npx', ['ts-node', 'src/seeds/index.ts'])
console.log(`[reset] ${DB} 已完成 migration + seed`)
