import type { SpecCalculationSnapshot } from '@weftcount/shared'
import { DetailTable, MetaGrid, SheetFooter, SheetHeader } from '../lib/print'
import type { GreigeSpecWire, ProductionOrderWire } from '../lib/erp'

/**
 * 打印单据模板
 * - 规格单：工艺参数（克重/用纱量/日产能），给工艺与客户确认用
 * - 生产工单：挡车工机台随工单，对应报工口径
 * 数据全部来自工艺快照（确定性），不含 AI 推测。
 */

const n = (v: string | number | null | undefined, d = 2) => (v == null || v === '' ? '-' : Number(v).toFixed(d))
const sysLabel = (s: string) => ({ NeS: '英支', Nm: '公支', Tex: '特', D: '旦' })[s] ?? s

/** 规格单 */
export function SpecSheet({ spec, snapshot }: { spec: GreigeSpecWire; snapshot: SpecCalculationSnapshot }) {
  return (
    <div style={{ fontFamily: 'sans-serif', color: '#000' }}>
      <SheetHeader title="坯布规格单" subtitle="工艺参数（由确定性引擎计算，AI 不参与）" no={spec.code} date={new Date().toLocaleDateString('zh-CN')} />
      <MetaGrid
        items={[
          ['规格名称', spec.name],
          ['规格编码', spec.code],
          ['成品幅宽', `${n(spec.finishedWidth, 0)} cm`],
          ['组织', spec.weaveType],
          ['经密', `${n(spec.warpDensity, 0)} 根/cm`],
          ['纬密', `${n(spec.weftDensity, 0)} 根/cm`],
          ['经纱规格', `${n(spec.warpCountValue, 1)} ${sysLabel(spec.warpCountSystem)}`],
          ['纬纱规格', `${n(spec.weftCountValue, 1)} ${sysLabel(spec.weftCountSystem)}`],
          ['上机幅宽', spec.loomWidth ? `${n(spec.loomWidth, 0)} cm` : '-'],
        ]}
      />
      <div style={{ fontSize: 13, fontWeight: 700, margin: '6px 0 4px' }}>工艺计算结果</div>
      <MetaGrid
        items={[
          ['总克重', `${n(snapshot.totalGsm, 1)} g/m²`],
          ['经纱克重', `${n(snapshot.warpGsm, 1)} g/m²`],
          ['纬纱克重', `${n(snapshot.weftGsm, 1)} g/m²`],
          ['单米重量', `${n(snapshot.kgPerMeter, 4)} kg/m`],
          ['经纱单耗', `${n(snapshot.warpKgPer100m, 2)} kg/100m`],
          ['纬纱单耗', `${n(snapshot.weftKgPer100m, 2)} kg/100m`],
          ['合计单耗', `${n(snapshot.totalKgPer100m, 2)} kg/100m`],
          ['单米面积', `${n(snapshot.kgPerM2, 4)} kg/m²`],
          ['日产量', snapshot.dailyOutputM > 0 ? `${n(snapshot.dailyOutputM, 0)} m/台·日` : '未设置纬密机速'],
        ]}
      />
      <div style={{ fontSize: 13, fontWeight: 700, margin: '6px 0 4px' }}>工艺系数</div>
      <DetailTable
        columns={[
          { title: '经纱损耗率', align: 'right' },
          { title: '纬纱损耗率', align: 'right' },
          { title: '上机加放量', align: 'right' },
          { title: '机台效率', align: 'right' },
        ]}
        rows={[
          [
            `${n(Number(snapshot.coefficients.warpLossRate) * 100, 2)}%`,
            `${n(Number(snapshot.coefficients.weftLossRate) * 100, 2)}%`,
            `${n(snapshot.coefficients.widthAllowance, 0)} cm`,
            `${n(Number(snapshot.coefficients.machineRunRate) * 100, 1)}%`,
          ],
        ]}
      />
      <SheetFooter />
    </div>
  )
}

/** 生产工单 */
export function WorkOrderSheet({ order, machineName, specName, materialName }: { order: ProductionOrderWire; machineName: string; specName: string; materialName: string }) {
  const s = order.specSnapshot
  return (
    <div style={{ fontFamily: 'sans-serif', color: '#000' }}>
      <SheetHeader title="生产工单" subtitle="机台随工，产量以报工为准" no={order.orderNo} date={new Date().toLocaleDateString('zh-CN')} />
      <MetaGrid
        items={[
          ['工单号', order.orderNo],
          ['机台', machineName],
          ['物料', materialName],
          ['规格', specName],
          ['计划产量', `${n(order.plannedQuantityM, 0)} m`],
          ['已报产量', `${n(order.producedQuantityM, 0)} m`],
          ['交期', order.dueDate ?? '-'],
          ['计划开工', order.plannedStartDate ?? '-'],
          ['状态', order.status],
        ]}
      />
      <div style={{ fontSize: 13, fontWeight: 700, margin: '6px 0 4px' }}>织造参数（供机台参考）</div>
      <DetailTable
        columns={[
          { title: '总克重', align: 'right' },
          { title: '经纱单耗', align: 'right' },
          { title: '纬纱单耗', align: 'right' },
          { title: '合计单耗', align: 'right' },
        ]}
        rows={[
          [
            s ? `${n(s.totalGsm, 1)} g/m²` : '-',
            s ? `${n(s.warpKgPer100m, 2)} kg/100m` : '-',
            s ? `${n(s.weftKgPer100m, 2)} kg/100m` : '-',
            s ? `${n(s.totalKgPer100m, 2)} kg/100m` : '-',
          ],
        ]}
      />
      <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
        <span>挡车工签字：________________</span>
        <span>检验签字：________________</span>
        <span>车间主任：________________</span>
      </div>
      {order.remark && <div style={{ marginTop: 8, fontSize: 12 }}>备注：{order.remark}</div>}
      <SheetFooter />
    </div>
  )
}
