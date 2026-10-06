#!/usr/bin/env node
/**
 * 能力盘点：判断「某个功能到底有没有」用**事实**回答，不靠记忆。
 *
 * 用法：
 *   node scripts/feature-scan.mjs              # 全量盘点
 *   node scripts/feature-scan.mjs 幂等 拆匹     # 只查关键词，快速定位
 *
 * 为什么要有这个：开发中反复出现「以为没做、其实早做了」或「以为做了、其实断在别处」
 * 的误判（补货点写死？→ 早就能配；大屏没轮询？→ 早有；audit/target 有端点？→ 断在
 * targetType 缺失）。根因是凭印象判断。跑一下就知道。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const SRC = join(ROOT, 'apps')

/** 递归列出源码文件 */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === 'node_modules' || name === 'dist' || name === 'out') continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(p)
  }
  return out
}

const FILES = [
  ...walk(join(SRC, 'server/src')),
  ...walk(join(SRC, 'admin/src')),
  ...walk(join(SRC, 'desktop/src/renderer/src')),
]

/** 统计某关键词在多少文件出现、典型位置 */
function probe(keyword) {
  const hits = []
  for (const f of FILES) {
    let txt
    try {
      txt = readFileSync(f, 'utf8')
    } catch {
      continue
    }
    if (!txt.includes(keyword)) continue
    const lines = txt.split('\n')
    const n = lines.filter((l) => l.includes(keyword)).length
    hits.push({ file: f.replace(ROOT, '').replace(/\\/g, '/'), n })
  }
  hits.sort((a, b) => b.n - a.n)
  return hits
}

// ── 能力清单：关键词 → 中文说明 ──
const CAPABILITIES = [
  ['幂等', '幂等键（防重复提交/重复计量）'],
  ['clientRequestId', '客户端幂等键字段'],
  ['remainingM', '件卡剩余量（拆匹发货）'],
  ['rollOutbound', '件卡出库流水（一匹多去向）'],
  ["mode === 'roll'", '件卡级盘点'],
  ['safetyStock', '物料安全库存（补货点）'],
  ['AI_ENABLED', 'AI 总开关'],
  ['offlineQueue', '离线队列'],
  ['visibilitychange', '页面可见性感知（轮询暂停）'],
  ['targetType', '审计目标类型'],
  ['measure_mode', '量纲模式（按匹/按重量/按面积）'],
  ['LOW_STOCK_RATIO', '低位库存预警阈值'],
  ['withUniqueNo', '单号唯一性保障'],
  ['reorder', '补货/再订货'],
  ['幂等键', '幂等（中文注释）'],
]

const args = process.argv.slice(2)

if (args.length > 0) {
  console.log(`\n🔍 定向查询：${args.join('、')}\n`)
  for (const kw of args) {
    const hits = probe(kw)
    if (hits.length === 0) {
      console.log(`  ❌ "${kw}" —— 未找到`)
    } else {
      console.log(`  ✅ "${kw}" —— ${hits.length} 个文件`)
      hits.slice(0, 4).forEach((h) => console.log(`       ${h.file} (${h.n} 处)`))
    }
  }
  console.log('')
} else {
  // 全量盘点
  console.log('\n═══ 能力盘点 ═══\n')
  for (const [kw, desc] of CAPABILITIES) {
    const hits = probe(kw)
    const mark = hits.length ? '✅' : '❌'
    console.log(`${mark} ${desc.padEnd(30, ' ')} ${hits.length} 文件`)
    hits.slice(0, 2).forEach((h) => console.log(`      ${h.file} (${h.n})`))
  }

  // 迁移清单
  console.log('\n═══ 迁移清单 ═══\n')
  const migDir = join(SRC, 'server/src/migrations')
  const migs = readdirSync(migDir).filter((f) => f.endsWith('.ts')).sort()
  console.log(`共 ${migs.length} 个迁移：`)
  migs.slice(-5).forEach((m) => console.log(`  ${m}`))

  // 规模
  console.log('\n═══ 规模 ═══\n')
  const ctl = FILES.filter((f) => f.endsWith('.controller.ts'))
  let endpoints = 0
  for (const f of ctl) {
    endpoints += (readFileSync(f, 'utf8').match(/@(Get|Post|Patch|Put|Delete)\(/g) ?? []).length
  }
  const pages = FILES.filter((f) => /[\\/]pages[\\/].+\.tsx$/.test(f))
  const entities = FILES.filter((f) => /entities[\\/].+\.entity\.ts$/.test(f))
  console.log(`  API 端点：${endpoints}`)
  console.log(`  前端页面：${pages.length}（admin ${pages.filter((p) => p.includes('admin')).length} / desktop ${pages.filter((p) => p.includes('desktop')).length}）`)
  console.log(`  实体：${entities.length}`)
  console.log('')
}