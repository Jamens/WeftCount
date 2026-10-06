import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import type { GreigeSpecWire, MaterialWire } from './erp'

/**
 * 物料 / 规格名称映射
 *
 * 库存批次、单据、流水只存 materialId / specId（uuid），
 * 页面展示需要可读名称。此 hook 拉一次物料与规格列表，构建 id→名称 映射。
 */
export function useLookups() {
  const [materials, setMaterials] = useState<MaterialWire[]>([])
  const [specs, setSpecs] = useState<GreigeSpecWire[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [mRes, sRes] = await Promise.all([
        api.get<MaterialWire[]>('/materials'),
        api.get<GreigeSpecWire[]>('/greige-specs'),
      ])
      setMaterials(mRes.data.data)
      setSpecs(sRes.data.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载物料/规格失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const materialName = (id: string): string => materials.find((m) => m.id === id)?.name ?? id
  const materialCode = (id: string): string => materials.find((m) => m.id === id)?.code ?? ''
  const specName = (id: string): string => specs.find((s) => s.id === id)?.name ?? id
  const specCode = (id: string): string => specs.find((s) => s.id === id)?.code ?? ''

  return { materials, specs, loading, error, refresh: load, materialName, materialCode, specName, specCode }
}
