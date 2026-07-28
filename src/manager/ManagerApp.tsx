import { useCallback, useEffect, useState } from 'react'
import type { Live2DLibraryItem } from '../../electron/preload'

export function ManagerApp() {
  const [items, setItems] = useState<Live2DLibraryItem[]>([])
  const [activeDir, setActiveDir] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [personaEditId, setPersonaEditId] = useState<string | null>(null)
  const [personaDraft, setPersonaDraft] = useState('')
  const [personaBusy, setPersonaBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [list, active] = await Promise.all([
        window.petAPI.listLive2DLibrary(),
        window.petAPI.getActiveLive2DDir(),
      ])
      setItems(list)
      setActiveDir(active)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
    return window.petAPI.onLibraryChanged(() => {
      void refresh()
    })
  }, [refresh])

  const isActive = (item: Live2DLibraryItem) => {
    if (!activeDir) return false
    const a = activeDir.replace(/\\/g, '/').toLowerCase()
    const d = item.dir.replace(/\\/g, '/').toLowerCase()
    return a === d || a.startsWith(`${d}/`)
  }

  const onApply = async (item: Live2DLibraryItem) => {
    if (item.invalid) return
    setBusyId(item.id)
    try {
      const session = await window.petAPI.applyLive2DLibraryItem(item.dir)
      if (!session) {
        setError('无法切换：模型包无效')
        return
      }
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  const onDelete = async (item: Live2DLibraryItem) => {
    if (item.isDefault) return
    const active = isActive(item)
    const ok = window.confirm(
      active
        ? `「${item.displayName}」是当前桌宠模型，删除后将切换到默认模型。确定删除？`
        : `确定删除「${item.displayName}」？\n${item.id}`,
    )
    if (!ok) return
    setBusyId(item.id)
    try {
      const result = await window.petAPI.deleteLive2DLibraryItem(item.dir)
      if (!result.ok) {
        setError(result.error ?? '删除失败')
        return
      }
      if (personaEditId === item.id) {
        setPersonaEditId(null)
        setPersonaDraft('')
      }
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  const openPersonaEditor = async (item: Live2DLibraryItem) => {
    if (personaEditId === item.id) {
      setPersonaEditId(null)
      setPersonaDraft('')
      return
    }
    setPersonaBusy(true)
    try {
      const result = await window.petAPI.getPersona(item.id)
      if (!result.ok) {
        setError(result.error ?? '读取人设失败')
        return
      }
      setPersonaEditId(item.id)
      setPersonaDraft(result.content ?? '')
      setError(null)
    } finally {
      setPersonaBusy(false)
    }
  }

  const savePersona = async (item: Live2DLibraryItem) => {
    setPersonaBusy(true)
    try {
      const result = await window.petAPI.setPersona(item.id, personaDraft)
      if (!result.ok) {
        setError(result.error ?? '保存人设失败')
        return
      }
      window.alert('人设已保存，后续对话将按新人设')
      setPersonaEditId(null)
      setPersonaDraft('')
      setError(null)
    } finally {
      setPersonaBusy(false)
    }
  }

  return (
    <div className="manager-app">
      <header className="manager-header">
        <div>
          <h1>已导入模型</h1>
          <p>管理 layer-packs/live2d-models 中的拷贝包</p>
        </div>
        <button type="button" className="chip" onClick={() => void refresh()}>
          刷新
        </button>
      </header>

      {error && <div className="manager-error">{error}</div>}

      {items.length === 0 ? (
        <div className="manager-empty">
          暂无导入包。请右键桌宠 →「导入 Live2D 文件夹」。
        </div>
      ) : (
        <ul className="manager-list">
          {items.map((item) => {
            const active = isActive(item)
            const editingPersona = personaEditId === item.id
            return (
              <li
                key={item.id}
                className={`manager-item ${active ? 'active' : ''} ${
                  item.invalid ? 'invalid' : ''
                }`}
              >
                <div className="manager-item-main">
                  <div className="manager-item-title">
                    {item.displayName}
                    {item.isDefault && (
                      <span className="manager-badge default">默认</span>
                    )}
                    {active && <span className="manager-badge">当前</span>}
                    {item.invalid && (
                      <span className="manager-badge warn">无效</span>
                    )}
                  </div>
                  <div className="manager-item-meta">{item.summary}</div>
                  <div className="manager-item-id">{item.id}</div>
                  {editingPersona && (
                    <div className="manager-persona-editor">
                      <label className="manager-persona-label">人设（Markdown）</label>
                      <textarea
                        className="manager-persona-textarea"
                        value={personaDraft}
                        onChange={(e) => setPersonaDraft(e.target.value)}
                        rows={6}
                        placeholder="描述该模型的性格、说话方式等…"
                      />
                      <div className="manager-persona-actions">
                        <button
                          type="button"
                          className="chip primary"
                          disabled={personaBusy}
                          onClick={() => void savePersona(item)}
                        >
                          保存人设
                        </button>
                        <button
                          type="button"
                          className="chip"
                          disabled={personaBusy}
                          onClick={() => {
                            setPersonaEditId(null)
                            setPersonaDraft('')
                          }}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="manager-item-actions">
                  <button
                    type="button"
                    className="chip primary"
                    disabled={
                      item.invalid || active || busyId === item.id
                    }
                    onClick={() => void onApply(item)}
                  >
                    切换
                  </button>
                  <button
                    type="button"
                    className="chip"
                    disabled={personaBusy && personaEditId !== item.id}
                    onClick={() => void openPersonaEditor(item)}
                  >
                    {editingPersona ? '收起' : '人设'}
                  </button>
                  <button
                    type="button"
                    className="chip danger"
                    disabled={item.isDefault || busyId === item.id}
                    onClick={() => void onDelete(item)}
                  >
                    删除
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
