import JsBarcode from 'jsbarcode'

/** 件卡标签数据（来源=件卡档案） */
export interface RollCardData {
  rollNo: string
  meters: string
  specName: string
  batchNo: string
  widthCm: string
  date: string
}

/** 用 jsbarcode 渲染 CODE128 条码为内联 SVG */
function barcodeSvg(code: string, height = 40, width = 1.5, fontSize = 12): string {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  try {
    JsBarcode(svg, code, { format: 'CODE128', displayValue: true, height, width, fontSize, margin: 4 })
  } catch {
    return `<div style="font:13px monospace;padding:6px">${code}</div>`
  }
  return svg.outerHTML
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 单张件卡（一张=一匹） */
function cardHtml(d: RollCardData): string {
  const row = (k: string, v: string) => `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}</td></tr>`
  return `<div class="card">
    <div class="title">件卡 · 织数</div>
    <table>
      ${row('件卡号', d.rollNo)}
      ${row('规格', d.specName)}
      ${row('米数', `${d.meters} m`)}
      ${row('幅宽', d.widthCm ? `${d.widthCm} cm` : '-')}
      ${row('批次', d.batchNo)}
      ${row('日期', d.date)}
    </table>
    <div class="bc">${barcodeSvg(d.rollNo)}</div>
    <div class="foot">扫此码识别本匹（入库/发货/追溯）</div>
  </div>`
}

/**
 * 批量生成件卡标签 HTML（每页 4 张，2×2 网格，自动分页）
 *
 * 自包含：内联 CSS + 内联条码 SVG，离线可打印；预览与打印用同一份 HTML。
 * 件卡号是**唯一**条码——扫到即定位这一匹。
 */
export function buildRollCardsHtml(cards: RollCardData[]): string {
  const cardsHtml = cards.map(cardHtml).join('')
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: "Microsoft YaHei", -apple-system, sans-serif; background:#fff; }
  .sheet { display:grid; grid-template-columns:1fr 1fr; gap:6mm; padding:6mm; }
  .card { border:2px solid #000; padding:8px; break-inside:avoid; page-break-inside:avoid; height:62mm; overflow:hidden; }
  .title { text-align:center; font-size:16px; font-weight:700; letter-spacing:2px; border-bottom:2px solid #000; padding-bottom:4px; margin-bottom:6px; }
  table { width:100%; border-collapse:collapse; }
  td { font-size:12px; padding:1px 0; }
  td.k { color:#555; width:56px; }
  td.v { font-weight:600; }
  .bc { text-align:center; margin-top:4px; }
  .bc svg { max-width:92%; }
  .foot { text-align:center; font-size:10px; color:#666; margin-top:2px; }
  @media print { .sheet { padding:0; } @page { size:A4 portrait; margin:8mm; } }
</style></head>
<body><div class="sheet">${cardsHtml}</div></body></html>`
}
