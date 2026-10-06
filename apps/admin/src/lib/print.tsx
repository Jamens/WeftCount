import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { ReactNode } from 'react'

/**
 * 打印基建（浏览器打印，零依赖）
 *
 * 做法：把打印内容渲染到一个专用 `.print-root` 容器，用 `@media print` 隐藏页面其余部分，
 * 再调 `window.print()`。用 `flushSync` 保证 DOM 在打印前已就绪。
 * 打印样式：黑白、细边框、无阴影，A4 纵向。
 */

let styleInjected = false
function ensurePrintStyle() {
  if (styleInjected) return
  const style = document.createElement('style')
  style.textContent = `
    @media print {
      @page { size: A4 portrait; margin: 12mm; }
      html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
      /* 打印时只显示打印根容器 */
      body > *:not(.print-root) { display: none !important; }
      .print-root { display: block !important; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `
  document.head.appendChild(style)
  styleInjected = true
}

/** 打印任意 ReactNode */
export function usePrint() {
  return (node: ReactNode) => {
    ensurePrintStyle()
    const root = document.createElement('div')
    root.className = 'print-root'
    document.body.appendChild(root)
    const container = createRoot(root)
    flushSync(() => container.render(node))
    const cleanup = () => {
      window.removeEventListener('afterprint', cleanup)
      try {
        container.unmount()
      } catch {
        /* 已卸载 */
      }
      root.remove()
    }
    window.addEventListener('afterprint', cleanup)
    // 兜底：部分浏览器不触发 afterprint
    setTimeout(() => {
      if (document.body.contains(root)) cleanup()
    }, 1500)
    window.print()
  }
}

/** 单据抬头（厂名 + 标题 + 单号/日期） */
export function SheetHeader({ title, no, date, subtitle }: { title: string; no?: string; date?: string; subtitle?: string }) {
  return (
    <div style={{ borderBottom: '2px solid #000', paddingBottom: 8, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: 2 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: '#333', marginTop: 2 }}>{subtitle}</div>}
        </div>
        <div style={{ fontSize: 12, textAlign: 'right' }}>
          {no && <div>单号：{no}</div>}
          {date && <div>日期：{date}</div>}
        </div>
      </div>
    </div>
  )
}

/** 键值信息网格 */
export function MetaGrid({ items }: { items: (string | number | null | undefined)[][] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 12 }}>
      <tbody>
        {chunk(items, 3).map((row, ri) => (
          <tr key={ri}>
            {row.map((cell, ci) => {
              const [k, v] = cell
              return (
                <td key={ci} style={{ border: '1px solid #999', padding: '4px 6px' }}>
                  <span style={{ color: '#555' }}>{k}：</span>
                  <span style={{ fontWeight: 500 }}>{v ?? '-'}</span>
                </td>
              )
            })}
            {Array.from({ length: (3 - row.length) % 3 }).map((_, i) => (
              <td key={'pad' + i} style={{ border: '1px solid #999' }} />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** 明细表：columns=[{title, align?, render}] */
export function DetailTable({ columns, rows }: { columns: { title: string; align?: 'left' | 'right' | 'center'; width?: string }[]; rows: (string | number | null | undefined)[][] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th key={i} style={{ border: '1px solid #000', padding: '5px 6px', textAlign: c.align ?? 'left', width: c.width, background: '#f0f0f0' }}>
              {c.title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri}>
            {r.map((cell, ci) => (
              <td key={ci} style={{ border: '1px solid #999', padding: '4px 6px', textAlign: columns[ci]?.align ?? 'left' }}>
                {cell ?? '-'}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** 页脚（打印时间） */
export function SheetFooter() {
  return (
    <div style={{ marginTop: 16, fontSize: 11, color: '#666', display: 'flex', justifyContent: 'space-between' }}>
      <span>制表：系统自动生成</span>
      <span>打印时间：{new Date().toLocaleString('zh-CN')}</span>
    </div>
  )
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}
