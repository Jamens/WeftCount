import { useCallback, useEffect, useMemo, useState } from 'react'
import { App as AntdApp, Button, Card, Col, Empty, Row, Select, Space, Table, Tag, Typography } from 'antd'
import { PrinterOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '../lib/api'
import { buildLabelHtml, type LabelData } from '../lib/label'
import { fmt, type BatchWire, type GreigeSpecWire, type MaterialWire, type WarehouseWire } from '../lib/types'

const { Title, Text } = Typography

/** 布匹标签打印（仓管员，离线打印：条码与版式均在本地生成） */
export default function LabelPage() {
  const { message } = AntdApp.useApp()
  const [warehouses, setWarehouses] = useState<WarehouseWire[]>([])
  const [batches, setBatches] = useState<BatchWire[]>([])
  const [materials, setMaterials] = useState<MaterialWire[]>([])
  const [specs, setSpecs] = useState<GreigeSpecWire[]>([])
  const [warehouseId, setWarehouseId] = useState<string | undefined>()
  const [target, setTarget] = useState<BatchWire | null>(null)
  const [printing, setPrinting] = useState(false)

  const load = useCallback(async () => {
    try {
      const [w, b, m, s] = await Promise.all([
        api.get<WarehouseWire[]>('/warehouses'),
        api.get<BatchWire[]>('/inventory/batches'),
        api.get<MaterialWire[]>('/materials'),
        api.get<GreigeSpecWire[]>('/greige-specs'),
      ])
      setWarehouses(w)
      setBatches(b)
      setMaterials(m)
      setSpecs(s)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载数据失败（标签打印需仓管权限）')
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(
    () => (warehouseId ? batches.filter((b) => b.warehouseId === warehouseId) : batches),
    [batches, warehouseId],
  )

  const labelData: LabelData | null = useMemo(() => {
    if (!target) return null
    return {
      batchNo: target.batchNo,
      materialName: materials.find((m) => m.id === target.materialId)?.name ?? '-',
      specName: specs.find((s) => s.id === target.specId)?.name ?? '-',
      quantityM: fmt(target.quantity, 1),
      weightKg: fmt(target.weightKg, 1),
      warehouseName: target.warehouseId ? (warehouses.find((w) => w.id === target.warehouseId)?.name ?? '-') : '未指定',
      date: dayjs(target.inboundAt).format('YYYY-MM-DD'),
    }
  }, [target, materials, specs, warehouses])

  const labelHtml = useMemo(() => (labelData ? buildLabelHtml(labelData) : ''), [labelData])

  const onPrint = async () => {
    if (!labelHtml) return
    setPrinting(true)
    try {
      const res = await window.weftDesktop?.printLabel(labelHtml)
      if (res?.ok) message.success('已发送到打印机')
      else message.error(res?.reason ?? '打印失败或被取消')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '打印失败')
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <Row gutter={[12, 12]}>
        <Col span={14}>
          <Card
            size="small"
            title="选择批次打印布匹标签"
            extra={
              <Space>
                <Select
                  allowClear
                  style={{ width: 180 }}
                  placeholder="按仓库筛选"
                  value={warehouseId}
                  onChange={setWarehouseId}
                  options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
                />
                <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
              </Space>
            }
          >
            {filtered.length === 0 ? (
              <Empty description="暂无批次（标签打印需仓管权限，请用仓管员账号登录）" />
            ) : (
              <Table<BatchWire>
                rowKey="id"
                size="small"
                pagination={{ pageSize: 8, showSizeChanger: false }}
                dataSource={filtered}
                onRow={(r) => ({ onClick: () => setTarget(r), style: { cursor: 'pointer', background: target?.id === r.id ? '#e6f4ea' : undefined } })}
                columns={[
                  { title: '批次号', dataIndex: 'batchNo', width: 140 },
                  { title: '物料', dataIndex: 'materialId', width: 130, render: (v: string) => materials.find((m) => m.id === v)?.name ?? '-' },
                  { title: '规格', dataIndex: 'specId', width: 120, render: (v: string) => specs.find((s) => s.id === v)?.name ?? '-' },
                  { title: '数量(米)', dataIndex: 'quantity', width: 90, align: 'right', render: (v: string) => fmt(v, 0) },
                  { title: '状态', dataIndex: 'status', width: 80, render: (s: string) => <Tag>{s}</Tag> },
                ]}
              />
            )}
          </Card>
        </Col>

        <Col span={10}>
          <Card
            size="small"
            title="标签预览"
            extra={
              <Button type="primary" icon={<PrinterOutlined />} loading={printing} disabled={!target} onClick={() => void onPrint()}>
                打印
              </Button>
            }
          >
            {labelHtml ? (
              <>
                <iframe
                  title="label-preview"
                  srcDoc={labelHtml}
                  style={{ width: '100%', height: 380, border: '1px solid #eee', borderRadius: 4 }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  打印走本地系统打印机（离线可用）；扫标签上的条码可在「扫码查询」查这批布的档案与来源。
                </Text>
              </>
            ) : (
              <Empty description="点击左侧批次预览标签" />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  )
}
