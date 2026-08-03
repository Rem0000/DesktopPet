import { useCallback, useEffect, useState } from 'react'
import type { Live2DLibraryItem } from '../../electron/preload'
import {
  RELATIONSHIP_STAGE_LABELS,
  relationshipTemperature,
} from '../../electron/relationship/relationshipRender'
import { stageForAffinity } from '../../electron/relationship/relationshipStages'
import type {
  EvolutionProposal,
  RelationshipPanelView,
  RelationshipPatch,
  RelationshipPolicy,
} from '../chat/contracts'

const POLICY_LABELS: Array<{ value: RelationshipPolicy; label: string; desc: string }> = [
  {
    value: 'layered',
    label: '分层合成',
    desc: '人设定"底子"，动态层定"当下态度"',
  },
  {
    value: 'persona-first',
    label: '人设优先',
    desc: '以人设中的关系设定为准，动态层只补空白',
  },
  {
    value: 'dynamic-first',
    label: '动态优先',
    desc: '以动态关系状态为准，人设只当起点',
  },
]

export function ManagerApp() {
  const [items, setItems] = useState<Live2DLibraryItem[]>([])
  const [activeDir, setActiveDir] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [personaEditId, setPersonaEditId] = useState<string | null>(null)
  const [personaDraft, setPersonaDraft] = useState('')
  const [personaBusy, setPersonaBusy] = useState(false)

  const [relationshipOpenId, setRelationshipOpenId] = useState<string | null>(null)
  const [relationship, setRelationship] = useState<RelationshipPanelView | null>(null)
  const [proposals, setProposals] = useState<EvolutionProposal[]>([])
  const [affinityInput, setAffinityInput] = useState('')
  const [noteInput, setNoteInput] = useState('')
  const [relationshipBusy, setRelationshipBusy] = useState(false)

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
      if (relationshipOpenId === item.id) {
        setRelationshipOpenId(null)
        setRelationship(null)
        setProposals([])
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

  const openRelationship = async (item: Live2DLibraryItem) => {
    if (relationshipOpenId === item.id) {
      setRelationshipOpenId(null)
      setRelationship(null)
      setProposals([])
      return
    }
    setRelationshipBusy(true)
    try {
      const [state, list] = await Promise.all([
        window.petAPI.relationship.get(item.id),
        window.petAPI.relationship.proposals(item.id),
      ])
      setRelationshipOpenId(item.id)
      setRelationship(state)
      setProposals(list)
      setAffinityInput(String(state.affinity))
      setNoteInput(state.temperatureNote)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRelationshipBusy(false)
    }
  }

  const refreshRelationship = async () => {
    if (!relationshipOpenId) return
    try {
      const [state, list] = await Promise.all([
        window.petAPI.relationship.get(relationshipOpenId),
        window.petAPI.relationship.proposals(relationshipOpenId),
      ])
      setRelationship(state)
      setProposals(list)
      setAffinityInput(String(state.affinity))
      setNoteInput(state.temperatureNote)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const applyRelationshipPatch = async (patch: RelationshipPatch) => {
    if (!relationshipOpenId) return
    setRelationshipBusy(true)
    try {
      const state = await window.petAPI.relationship.patch(relationshipOpenId, patch)
      setRelationship(state)
      setAffinityInput(String(state.affinity))
      setNoteInput(state.temperatureNote)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRelationshipBusy(false)
    }
  }

  const onSetPolicy = (policy: RelationshipPolicy) => {
    void applyRelationshipPatch({ policy })
  }

  const onSaveAffinity = () => {
    const value = Number(affinityInput)
    if (!Number.isFinite(value)) {
      setError('好感温度必须是数字')
      return
    }
    void applyRelationshipPatch({ affinity: value })
  }

  const onSaveNote = () => {
    void applyRelationshipPatch({ temperatureNote: noteInput })
  }

  const onResetRelationship = async () => {
    if (!relationshipOpenId) return
    if (!window.confirm('确认重置该模型的关系状态？persona、聊天与记忆不受影响。')) return
    setRelationshipBusy(true)
    try {
      const state = await window.petAPI.relationship.reset(relationshipOpenId)
      setRelationship(state)
      setAffinityInput(String(state.affinity))
      setNoteInput('')
      setProposals([])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRelationshipBusy(false)
    }
  }

  const onRespondProposal = async (proposalId: string, accept: boolean) => {
    if (!relationshipOpenId) return
    setRelationshipBusy(true)
    try {
      await window.petAPI.relationship.respondProposal(
        relationshipOpenId,
        proposalId,
        accept,
      )
      await refreshRelationship()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRelationshipBusy(false)
    }
  }

  // 关系面板实时预览：滑块/草稿态描述即时反映到"生效描述"
  // 注意：必须按预览好感重算阶段，否则温度与阶段标签会停留在旧档
  const affinityFrozen = Boolean(
    relationship && relationship.policy === 'persona-first',
  )
  let liveAffinity = relationship?.affinity ?? 0
  let liveStageLabel = relationship?.stageLabel ?? ''
  let liveTemperature = relationship?.temperature ?? ''
  if (relationship) {
    const affinityNumber = Number(affinityInput)
    liveAffinity = Number.isFinite(affinityNumber)
      ? affinityNumber
      : relationship.affinity
    const liveStage = stageForAffinity(liveAffinity)
    liveStageLabel = RELATIONSHIP_STAGE_LABELS[liveStage]
    liveTemperature = relationshipTemperature({
      ...relationship,
      affinity: liveAffinity,
      stage: liveStage,
      temperatureNote: noteInput,
    })
  }
  const hasCustomNote = noteInput.trim() !== ''

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
            const relationshipOpen = relationshipOpenId === item.id
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
                  {relationshipOpen && relationship && (
                    <div className="manager-relationship-panel">
                      <div className="manager-rel-header">
                        <span className="manager-rel-stage">
                          关系阶段：
                          <strong>{liveStageLabel}</strong>
                        </span>
                        <span className="manager-rel-affinity">好感 {liveAffinity}</span>
                      </div>

                      <div className="manager-rel-row">
                        <label className="manager-persona-label">好感温度（0–100）</label>
                        {affinityFrozen && (
                          <div className="manager-rel-frozen-hint">
                            人设优先策略下，好感不随对话调整，已冻结；由人设既定关系驱动。
                          </div>
                        )}
                        <div className="manager-rel-affinity-edit">
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={affinityInput}
                            onChange={(e) => setAffinityInput(e.target.value)}
                            className="manager-rel-range"
                            disabled={affinityFrozen}
                          />
                          <input
                            type="number"
                            className="manager-rel-number"
                            value={affinityInput}
                            onChange={(e) => setAffinityInput(e.target.value)}
                            min={0}
                            max={100}
                            disabled={affinityFrozen}
                          />
                          <button
                            type="button"
                            className="chip"
                            disabled={relationshipBusy || affinityFrozen}
                            onClick={onSaveAffinity}
                          >
                            保存
                          </button>
                        </div>
                      </div>

                      <div className="manager-rel-row">
                        <label className="manager-persona-label">
                          当下态度描述（生效）
                        </label>
                        <div className="manager-rel-temperature">
                          <span
                            className={`manager-rel-temp-badge ${
                              hasCustomNote ? 'custom' : ''
                            }`}
                          >
                            {hasCustomNote ? '自定义' : '自动'}
                          </span>
                          <span className="manager-rel-temp-text">
                            {liveTemperature}
                          </span>
                        </div>
                        <textarea
                          className="manager-persona-textarea"
                          value={noteInput}
                          onChange={(e) => setNoteInput(e.target.value)}
                          rows={2}
                          placeholder="留空则按好感自动回退描述；填写后覆盖自动描述"
                        />
                        <div className="manager-persona-actions">
                          <button
                            type="button"
                            className="chip primary"
                            disabled={relationshipBusy}
                            onClick={onSaveNote}
                          >
                            保存态度
                          </button>
                        </div>
                      </div>

                      <div className="manager-rel-row">
                        <label className="manager-persona-label">关系优先级策略</label>
                        <div className="manager-rel-policies">
                          {POLICY_LABELS.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              className={`chip ${
                                relationship.policy === option.value ? 'primary' : ''
                              }`}
                              disabled={relationshipBusy}
                              onClick={() => onSetPolicy(option.value)}
                              title={option.desc}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {proposals.length > 0 && (
                        <div className="manager-rel-proposals">
                          <label className="manager-persona-label">
                            待审关系演化提案
                          </label>
                          {proposals.map((proposal) => (
                            <div key={proposal.id} className="manager-rel-proposal">
                              <div className="manager-rel-proposal-text">
                                <div>
                                  曾「{proposal.personaQuote}」 → {proposal.change}
                                </div>
                                <div className="manager-rel-proposal-evidence">
                                  证据：{proposal.evidence}
                                </div>
                              </div>
                              <div className="manager-persona-actions">
                                <button
                                  type="button"
                                  className="chip primary"
                                  disabled={relationshipBusy}
                                  onClick={() =>
                                    void onRespondProposal(proposal.id, true)
                                  }
                                >
                                  接受
                                </button>
                                <button
                                  type="button"
                                  className="chip danger"
                                  disabled={relationshipBusy}
                                  onClick={() =>
                                    void onRespondProposal(proposal.id, false)
                                  }
                                >
                                  拒绝
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {relationship.history.length > 0 && (
                        <div className="manager-rel-history">
                          <label className="manager-persona-label">最近记录</label>
                          <ul className="manager-rel-history-list">
                            {relationship.history
                              .slice(-5)
                              .reverse()
                              .map((entry, index) => (
                                <li key={index} className="manager-rel-history-item">
                                  <span className="manager-rel-history-at">
                                    {entry.at.slice(0, 16)}
                                  </span>
                                  <span>{entry.note ?? entry.type}</span>
                                </li>
                              ))}
                          </ul>
                        </div>
                      )}

                      <button
                        type="button"
                        className="chip danger"
                        disabled={relationshipBusy}
                        onClick={() => void onResetRelationship()}
                      >
                        重置关系
                      </button>
                    </div>
                  )}
                </div>
                <div className="manager-item-actions">
                  <button
                    type="button"
                    className="chip primary"
                    disabled={item.invalid || active || busyId === item.id}
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
                    className="chip"
                    disabled={item.invalid || (relationshipBusy && !relationshipOpen)}
                    onClick={() => void openRelationship(item)}
                  >
                    {relationshipOpen ? '收起' : '关系'}
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
