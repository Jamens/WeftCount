import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import { PlusOutlined, PrinterOutlined, ReloadOutlined, SearchOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { api } from '../lib/api'
import { usePrint } from '../lib/print'
import { SpecSheet } from '../components/print-docs'
import {
  COUNT_SYSTEM_LABEL,
  COUNT_SYSTEM_OPTIONS,
  WEAVE_TYPE_LABEL,
  dec,
  fmt,
  PERM,
  type GreigeSpecWire,
} from '../lib/erp'
import type { CountSystem, SpecCalculationSnapshot, WeaveType } from '@weftcount/shared'
import { useAuthStore } from '../stores/auth.store'

const { Title, Text } = Typography

interface SpecForm {
  name: string
  finishedWidth: number
  warpDensity: number
  weftDensity: number
  warpCount: { value: number; system: CountSystem }
  weftCount: { value: number; system: CountSystem }
  weaveType?: WeaveType
  widthAllowance?: number
  warpLossRate?: number
  weftLossRate?: number
  machineRunRate?: number
  picksPerMinute?: number
  overheadCostPerMeter?: number
  measuredGsm?: number
  remark?: string
}

const DEFAULTS = {
  widthAllowance: 10,
  warpLossRate: 0.055,
  weftLossRate: 0.05,
  machineRunRate: 0.85,
}

export default function SpecPage() {
  const { message } = AntdApp.useApp()
  const canEdit = useAuthStore((s) => s.hasPermission(PERM.MATERIAL_EDIT))

  const [data, setData] = useState<GreigeSpecWire[]>([])
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [detail, setDetail] = useState<GreigeSpecWire | null>(null)
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [preview, setPreview] = useState<SpecCalculationSnapshot | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [form] = Form.useForm<SpecForm>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (keyword) params.set('keyword', keyword)
      const res = await api.get<GreigeSpecWire[]>(`/greige-specs?${params.toString()}`)
      setData(res.data.data)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载规格失败')
    } finally {
      setLoading(false)
    }
  }, [keyword, message])

  const print = usePrint()
  const printSpec = async (spec: GreigeSpecWire) => {
    try {
      const res = await api.get<SpecCalculationSnapshot>(`/greige-specs/${spec.id}/snapshot`)
      print(<SpecSheet spec={spec} snapshot={res.data.data} />)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '取工艺快照失败，无法打印')
    }
  }

  useEffect(() => {
    void load()
  }, [load])

  const onPreview = async () => {
    try {
      const v = await form.validateFields([
        'name',
        'finishedWidth',
        'warpDensity',
        'weftDensity',
        'warpCount',
        'weftCount',
      ])
      setPreviewing(true)
      try {
        const res = await api.post<SpecCalculationSnapshot>('/greige-specs/calculate', {
          finishedWidth: v.finishedWidth,
          warpDensity: v.warpDensity,
          weftDensity: v.weftDensity,
          weaveType: v.weaveType ?? 'plain',
          warpCount: v.warpCount,
          weftCount: v.weftCount,
          widthAllowance: v.widthAllowance ?? DEFAULTS.widthAllowance,
          warpLossRate: v.warpLossRate ?? DEFAULTS.warpLossRate,
          weftLossRate: v.weftLossRate ?? DEFAULTS.weftLossRate,
          machineRunRate: v.machineRunRate ?? DEFAULTS.machineRunRate,
          picksPerMinute: v.picksPerMinute ?? null,
        })
        setPreview(res.data.data)
      } finally {
        setPreviewing(false)
      }
    } catch (e) {
      if (e instanceof Error && !e.message.includes('验证')) {
        message.error(e.message)
      }
    }
  }

  const onCreate = async () => {
    const v = await form.validateFields()
    setSubmitting(true)
    try {
      await api.post('/greige-specs', {
        name: v.name,
        finishedWidth: v.finishedWidth,
        warpDensity: v.warpDensity,
        weftDensity: v.weftDensity,
        weaveType: v.weaveType ?? 'plain',
        warpCount: v.warpCount,
        weftCount: v.weftCount,
        widthAllowance: v.widthAllowance ?? DEFAULTS.widthAllowance,
        warpLossRate: v.warpLossRate ?? DEFAULTS.warpLossRate,
        weftLossRate: v.weftLossRate ?? DEFAULTS.weftLossRate,
        machineRunRate: v.machineRunRate ?? DEFAULTS.machineRunRate,
        picksPerMinute: v.picksPerMinute ?? null,
        overheadCostPerMeter: v.overheadCostPerMeter ?? 0,
        measuredGsm: v.measuredGsm ?? null,
        remark: v.remark ?? null,
      })
      message.success('坯布规格已创建（克重由工艺内核自动计算）')
      setOpen(false)
      form.resetFields()
      setPreview(null)
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <Space align="center" style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            坯布规格
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            克重与用纱量由工艺内核计算，只录工艺参数；实测克重仅用于校准
          </Text>
        </div>
        <Space>
          {canEdit && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
              新建规格
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            刷新
          </Button>
        </Space>
      </Space>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Input
            placeholder="名称 / 编码"
            allowClear
            style={{ width: 220 }}
            prefix={<SearchOutlined />}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={() => void load()}
          />
          <Button type="primary" onClick={() => void load()}>
            查询
          </Button>
        </Space>
      </Card>

      <Card size="small">
        <Table<GreigeSpecWire>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={data}
          onRow={(r) => ({ onClick: () => setDetail(r) })}
          pagination={{ showTotal: (t) => `共 ${t} 条`, showSizeChanger: false, defaultPageSize: 20 }}
          columns={[
            { title: '编码', dataIndex: 'code', width: 90 },
            { title: '名称', dataIndex: 'name', width: 180 },
            {
              title: '门幅',
              dataIndex: 'finishedWidth',
              width: 90,
              align: 'right',
              render: (v: string) => `${fmt(v, 1)}cm`,
            },
            {
              title: '经纬密',
              width: 130,
              render: (_, r) =>
                `${fmt(r.warpDensity, 1)}×${fmt(r.weftDensity, 1)} 根/英寸`,
            },
            {
              title: '经/纬纱支',
              width: 170,
              render: (_, r) =>
                `${dec(r.warpCountValue)}${r.warpCountSystem} / ${dec(r.weftCountValue)}${r.weftCountSystem}`,
            },
            {
              title: '组织',
              dataIndex: 'weaveType',
              width: 80,
              render: (v: WeaveType) => WEAVE_TYPE_LABEL[v] ?? v,
            },
            {
              title: '计算克重',
              dataIndex: 'calculatedGsm',
              width: 100,
              align: 'right',
              render: (v: string) => <Text strong>{fmt(v, 2)} g/m²</Text>,
            },
            {
              title: '实测克重',
              dataIndex: 'measuredGsm',
              width: 100,
              align: 'right',
              render: (v: string | null) => (v == null ? '-' : `${fmt(v, 2)} g/m²`),
            },
            {
              title: '版本',
              dataIndex: 'specVersion',
              width: 70,
              align: 'center',
              render: (v: number) => <Tag>{`v${v}`}</Tag>,
            },
          ]}
        />
      </Card>

      <Drawer
        title="规格详情"
        width={520}
        open={detail !== null}
        onClose={() => setDetail(null)}
        extra={
          detail && (
            <Button icon={<PrinterOutlined />} onClick={() => void printSpec(detail)}>
              打印规格单
            </Button>
          )
        }
      >
        {detail && (
          <Descriptions column={2} size="small" bordered>
            <Descriptions.Item label="编码">{detail.code}</Descriptions.Item>
            <Descriptions.Item label="名称">{detail.name}</Descriptions.Item>
            <Descriptions.Item label="门幅">{fmt(detail.finishedWidth, 2)} cm</Descriptions.Item>
            <Descriptions.Item label="组织">{WEAVE_TYPE_LABEL[detail.weaveType] ?? detail.weaveType}</Descriptions.Item>
            <Descriptions.Item label="经密">{fmt(detail.warpDensity, 2)} 根/英寸</Descriptions.Item>
            <Descriptions.Item label="纬密">{fmt(detail.weftDensity, 2)} 根/英寸</Descriptions.Item>
            <Descriptions.Item label="经纱支数">
              {dec(detail.warpCountValue)} {COUNT_SYSTEM_LABEL[detail.warpCountSystem]}
            </Descriptions.Item>
            <Descriptions.Item label="纬纱支数">
              {dec(detail.weftCountValue)} {COUNT_SYSTEM_LABEL[detail.weftCountSystem]}
            </Descriptions.Item>
            <Descriptions.Item label="计算克重">{fmt(detail.calculatedGsm, 2)} g/m²</Descriptions.Item>
            <Descriptions.Item label="实测克重">
              {detail.measuredGsm == null ? '-' : `${fmt(detail.measuredGsm, 2)} g/m²`}
            </Descriptions.Item>
            <Descriptions.Item label="版本">v{detail.specVersion}</Descriptions.Item>
            <Descriptions.Item label="备注" span={2}>
              {detail.remark ?? '-'}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>

      <Drawer
        title="新建坯布规格"
        width={560}
        open={open}
        onClose={() => setOpen(false)}
        extra={
          <Space>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button type="primary" loading={submitting} onClick={() => void onCreate()}>
              保存
            </Button>
          </Space>
        }
      >
        <Form<SpecForm>
          form={form}
          layout="vertical"
          initialValues={{
            weaveType: 'plain',
            widthAllowance: DEFAULTS.widthAllowance,
            warpLossRate: DEFAULTS.warpLossRate,
            weftLossRate: DEFAULTS.weftLossRate,
            machineRunRate: DEFAULTS.machineRunRate,
            warpCount: { system: 'NeS' },
            weftCount: { system: 'NeS' },
          }}
        >
          <Form.Item name="name" label="规格名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：全棉府绸 120×72" maxLength={128} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="finishedWidth" label="成品门幅(cm)" rules={[{ required: true }]}>
                <InputNumber style={{ width: '100%' }} min={1} precision={1} placeholder="如 150" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="weaveType" label="基础组织">
                <Select
                  options={(Object.keys(WEAVE_TYPE_LABEL) as WeaveType[]).map((k) => ({
                    value: k,
                    label: WEAVE_TYPE_LABEL[k],
                  }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="warpDensity" label="经密(根/英寸)" rules={[{ required: true }]}>
                <InputNumber style={{ width: '100%' }} min={1} precision={1} placeholder="如 120" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="weftDensity" label="纬密(根/英寸)" rules={[{ required: true }]}>
                <InputNumber style={{ width: '100%' }} min={1} precision={1} placeholder="如 72" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="经纱支数" required>
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item name={['warpCount', 'value']} noStyle rules={[{ required: true }]}>
                    <InputNumber style={{ width: '60%' }} min={0.01} precision={2} placeholder="40" />
                  </Form.Item>
                  <Form.Item name={['warpCount', 'system']} noStyle>
                    <Select style={{ width: '40%' }} options={COUNT_SYSTEM_OPTIONS} />
                  </Form.Item>
                </Space.Compact>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="纬纱支数" required>
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item name={['weftCount', 'value']} noStyle rules={[{ required: true }]}>
                    <InputNumber style={{ width: '60%' }} min={0.01} precision={2} placeholder="40" />
                  </Form.Item>
                  <Form.Item name={['weftCount', 'system']} noStyle>
                    <Select style={{ width: '40%' }} options={COUNT_SYSTEM_OPTIONS} />
                  </Form.Item>
                </Space.Compact>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="widthAllowance" label="上机加放量(cm)">
                <InputNumber style={{ width: '100%' }} min={0} precision={1} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="warpLossRate" label="经向损耗率">
                <InputNumber style={{ width: '100%' }} min={0} max={1} precision={4} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="weftLossRate" label="纬向损耗率">
                <InputNumber style={{ width: '100%' }} min={0} max={1} precision={4} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="machineRunRate" label="织机运转率">
                <InputNumber style={{ width: '100%' }} min={0} max={1} precision={4} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="picksPerMinute" label="织机转速(纬/分)">
                <InputNumber style={{ width: '100%' }} min={1} precision={0} placeholder="可选" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="overheadCostPerMeter" label="加工费(元/米)" extra="制造成本 = 纱线成本 + 加工费；按电费/人工/折旧核定">
                <InputNumber style={{ width: '100%' }} min={0} precision={4} placeholder="如 0.5" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="measuredGsm" label="出厂实测克重(g/m²)" extra="仅用于校准内核的坯布→成品换算系数，不影响计算值">
            <InputNumber style={{ width: '100%' }} min={0} precision={2} placeholder="可选" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={255} />
          </Form.Item>

          <Button icon={<ThunderboltOutlined />} loading={previewing} onClick={() => void onPreview()} block>
            试算预览（克重 / 用纱量 / 日产量）
          </Button>
        </Form>

        {preview && (
          <Alert
            style={{ marginTop: 16 }}
            type="success"
            showIcon
            message="工艺内核计算结果（落库即锁死为该快照）"
            description={
              <Descriptions column={2} size="small" style={{ marginTop: 8 }}>
                <Descriptions.Item label="坯布克重">
                  <Text strong>{fmt(preview.totalGsm, 2)} g/m²</Text>
                </Descriptions.Item>
                <Descriptions.Item label="每米重量">{fmt(preview.kgPerMeter, 4)} kg/m</Descriptions.Item>
                <Descriptions.Item label="每平米重量">{fmt(preview.kgPerM2, 4)} kg/m²</Descriptions.Item>
                <Descriptions.Item label="百米用纱">{fmt(preview.totalKgPer100m, 3)} kg</Descriptions.Item>
                <Descriptions.Item label="日产量" span={2}>
                  {fmt(preview.dailyOutputM, 1)} 米/天
                </Descriptions.Item>
              </Descriptions>
            }
          />
        )}
      </Drawer>
    </div>
  )
}
