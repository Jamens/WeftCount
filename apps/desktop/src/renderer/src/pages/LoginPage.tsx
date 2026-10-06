import { useState } from 'react'
import { App as AntdApp, Button, Form, Input, Tag, Typography, theme } from 'antd'
import {
  UserOutlined,
  LockOutlined,
  LoginOutlined,
  DeploymentUnitOutlined,
  BarcodeOutlined,
  LineChartOutlined,
} from '@ant-design/icons'
import { api, authStore } from '../lib/api'

const { Title, Text } = Typography

interface LoginForm {
  username: string
  password: string
}

/** 演示账号：点一下直接填充，省去手输（密码统一 weft2026） */
const DEMO_ACCOUNTS = [
  { u: 'factory', label: '王厂长', role: '厂长 · 全部权限' },
  { u: 'warehouse', label: '张仓管', role: '仓管 · 出入库/打印' },
  { u: 'craft', label: '李工艺', role: '工艺 · 系数/成本' },
  { u: 'loom', label: '刘挡车', role: '挡车工 · 仅报工' },
  { u: 'owner', label: '集团管理员', role: '租户管理员' },
]

/** 平纹组织意象：经纬交织的织纹标 */
function WeaveMark({ size = 52 }: { size?: number }) {
  const n = 4
  const cell = size / n
  const bar = cell * 0.46
  const cells: React.ReactElement[] = []
  // 交错填充：奇偶格明暗交替，形成平纹组织的经纬交替视觉
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const on = (r + c) % 2 === 0
      cells.push(
        <rect
          key={`${r}-${c}`}
          x={c * cell + (cell - bar) / 2}
          y={r * cell + (cell - bar) / 2}
          width={bar}
          height={bar}
          rx={bar * 0.32}
          fill={on ? '#E3B04B' : '#E3B04B'}
          opacity={on ? 0.95 : 0.34}
        />,
      )
    }
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {cells}
    </svg>
  )
}

const FEATURES = [
  { icon: <DeploymentUnitOutlined />, title: '三算闭环', desc: '采购入库 · 生产领用 · 销售出库，恒等式对账' },
  { icon: <BarcodeOutlined />, title: '按匹追溯', desc: '每匹布可倒查到工单、机台与供应商' },
  { icon: <LineChartOutlined />, title: '损耗算清', desc: '损耗精确到匹，核价与排产辅助决策' },
]

export default function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const { message } = AntdApp.useApp()
  const { token } = theme.useToken()
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm<LoginForm>()

  const onLogin = async () => {
    const v = await form.validateFields()
    setLoading(true)
    try {
      const data = await api.post<{ accessToken: string; tenant: { id: string }; currentCompanyId: string }>(
        '/auth/login',
        v,
      )
      authStore.setSession(data.accessToken, data.tenant.id, data.currentCompanyId)
      message.success('登录成功')
      onSuccess()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  const fillDemo = (username: string) => {
    form.setFieldsValue({ username, password: 'weft2026' })
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexWrap: 'wrap' }}>
      {/* ── 品牌区：藏青 dye 底 + 平纹织纹，突出织造主题 ── */}
      <div
        style={{
          flex: '1 1 460px',
          position: 'relative',
          overflow: 'hidden',
          background: 'linear-gradient(150deg, #1c2c4c 0%, #16233d 42%, #0d1a2c 78%, #10222c 100%)',
          display: 'flex',
          alignItems: 'center',
          padding: '48px 56px',
        }}
      >
        {/* 织纹：经纱(竖) × 纬纱(横) 叠加 */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: 0.5,
            backgroundImage:
              'repeating-linear-gradient(90deg, rgba(255,255,255,0.055) 0 1px, transparent 1px 15px),' +
              'repeating-linear-gradient(0deg, rgba(255,255,255,0.045) 0 1px, transparent 1px 15px)',
          }}
        />
        {/* 暖光晕，增加层次 */}
        <div
          style={{
            position: 'absolute',
            width: 460,
            height: 460,
            right: -140,
            top: -120,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(227,176,75,0.20) 0%, rgba(227,176,75,0) 68%)',
          }}
        />

        <div style={{ position: 'relative', maxWidth: 460 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 26 }}>
            <WeaveMark />
            <div>
              <Title level={2} style={{ color: '#fff', margin: 0, lineHeight: 1.15, letterSpacing: 1 }}>
                纬数 WeftCount
              </Title>
              <Text style={{ color: 'rgba(255,255,255,0.62)', fontSize: 13, letterSpacing: 2 }}>
                织造厂进销存 · 车间工作台
              </Text>
            </div>
          </div>

          <Text
            style={{
              display: 'block',
              color: 'rgba(255,255,255,0.80)',
              fontSize: 15,
              lineHeight: 1.85,
              marginBottom: 34,
              maxWidth: 400,
            }}
          >
            把织造工艺的<b style={{ color: '#E3B04B' }}>计量与损耗</b>算清楚。
            <br />
            不是「有个 AI」，而是每一匹布的来路、去向与损耗都对得上账。
          </Text>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {FEATURES.map((f) => (
              <div key={f.title} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div
                  style={{
                    flex: '0 0 auto',
                    width: 34,
                    height: 34,
                    borderRadius: 9,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#E3B04B',
                    background: 'rgba(227,176,75,0.13)',
                    border: '1px solid rgba(227,176,75,0.26)',
                  }}
                >
                  {f.icon}
                </div>
                <div>
                  <Text strong style={{ color: '#fff', display: 'block', fontSize: 14 }}>
                    {f.title}
                  </Text>
                  <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12.5 }}>{f.desc}</Text>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 登录区 ── */}
      <div
        style={{
          flex: '1 1 380px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '48px 40px',
          background: token.colorBgContainer,
        }}
      >
        <div style={{ width: '100%', maxWidth: 348 }}>
          <Title level={3} style={{ marginBottom: 4 }}>
            登录
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            挡车工 / 仓管 / 工艺 日常操作台
          </Text>

          <Form<LoginForm> form={form} layout="vertical" style={{ marginTop: 26 }} onFinish={() => void onLogin()}>
            <Form.Item name="username" rules={[{ required: true, message: '请输入账号' }]}>
              <Input prefix={<UserOutlined />} placeholder="账号" size="large" autoFocus />
            </Form.Item>
            <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="密码"
                size="large"
                onPressEnter={() => void onLogin()}
              />
            </Form.Item>
            <Button type="primary" size="large" block icon={<LoginOutlined />} loading={loading} onClick={() => void onLogin()}>
              登录
            </Button>
          </Form>

          <div style={{ marginTop: 26 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              演示账号（点击填充，密码 weft2026）
            </Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              {DEMO_ACCOUNTS.map((d) => (
                <Tag
                  key={d.u}
                  onClick={() => fillDemo(d.u)}
                  style={{
                    cursor: 'pointer',
                    margin: 0,
                    padding: '4px 10px',
                    borderRadius: 7,
                    background: token.colorFillQuaternary,
                    border: `1px solid ${token.colorBorderSecondary}`,
                  }}
                >
                  <b>{d.label}</b>
                  <span style={{ color: token.colorTextSecondary, marginLeft: 6, fontSize: 11 }}>{d.role}</span>
                </Tag>
              ))}
            </div>
          </div>

          <Text type="secondary" style={{ display: 'block', marginTop: 22, fontSize: 11.5 }}>
            需后端服务已启动（本机 3180）
          </Text>
        </div>
      </div>
    </div>
  )
}