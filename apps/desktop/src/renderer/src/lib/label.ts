import JsBarcode from 'jsbarcode'

/** 布匹标签数据（打印与预览共用，来源=批次档案） */
export interface LabelData {
  batchNo: string
  materialName: string
  specName: string
  quantityM: string
  weightKg: string
  warehouseName: string
  date: string
}

/** 用 jsbarcode 渲染 CODE128 条码为内联 SVG */
function barcodeSvg(code: string): string {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  try {
    JsBarcode(svg, code, { format: 'CODE128', displayValue: true, height: 44, width: 1.6, fontSize: 13, margin: 6 })
  } catch {
    // 条码内容非法时给出占位，避免整张标签打不出来
    return `<div style="font:14px monospace;padding:8px">${code}</div>`
  }
  return svg.outerHTML
}

/**
 * 生成自包含的标签 HTML（内联 CSS + 内联条码 SVG）
 *
 * 预览(iframe srcDoc)与打印(主进程隐藏窗口)用同一份 HTML，保证所见即所得；
 * 不引用任何外部资源，离线可打印。
 */
export function buildLabelHtml(d: LabelData): string {
  const row = (k: string, v: string) => `<tr><td class="k">${k}</td><td class="v">${v}</td></tr>`
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: "Microsoft YaHei", -apple-system, sans-serif; padding:8px; background:#fff; }
  .label { width: 300px; border: 2px solid #000; padding: 10px; }
  .title { text-align:center; font-size:18px; font-weight:700; letter-spacing:2px; border-bottom:2px solid #000; padding-bottom:6px; margin-bottom:8px; }
  table { width:100%; border-collapse: collapse; }
  td { font-size:13px; padding:2px 0; }
  td.k { color:#555; width:64px; }
  td.v { font-weight:600; }
  .bc { text-align:center; margin-top:8px; }
  .bc svg { max-width:100%; }
  .foot { text-align:center; font-size:11px; color:#666; margin-top:6px; }
</style></head>
<body>
  <div class="label">
    <div class="title">纬数 · 布匹标签</div>
    <table>
      ${row('批次号', d.batchNo)}
      ${row('物料', d.materialName)}
      ${row('规格', d.specName)}
      ${row('数量', `${d.quantityM} m / ${d.weightKg} kg`)}
      ${row('仓库', d.warehouseName)}
      ${row('日期', d.date)}
    </table>
    <div class="bc">${barcodeSvg(d.batchNo)}</div>
    <div class="foot">扫此码可查批次档案与全链路来源</div>
  </div>
</body></html>`
}
