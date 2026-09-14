import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  TokenUsage,
  TraceEvent,
  TraceSessionSummary,
} from './contracts'
import {
  SessionList,
  TurnTimeline,
  formatTime,
  formatUsage,
  groupEventsByTurn,
  statusLabel,
} from './TraceViews'

const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
}

/**
 * 链路追踪台：会话列表 + 单会话轮次时间轴 + 实时 tail。
 * 全部聚合值（按轮用量、上下文压力、统计）由主进程投影计算，渲染端只展示。
 */
export function TraceApp() {
  const [sessions, setSessions] = useState<TraceSessionSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [summary, setSummary] = useState<TraceSessionSummary | null>(null)
  const [events, setEvents] = useState<TraceEvent[]>([])
  const [usageByTurn, setUsageByTurn] = useState<Record<number, TokenUsage>>({})
  const [live, setLive] = useState(true)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const selectedRef = useRef<string | null>(null)

  const refreshSessions = useCallback(async (): Promise<TraceSessionSummary[]> => {
    const list = await window.petAPI.traces.listSessions()
    setSessions(list)
    return list
  }, [])

  const openSession = useCallback(async (sessionId: string) => {
    selectedRef.current = sessionId
    setSelectedId(sessionId)
    const [result, sessionSummary] = await Promise.all([
      window.petAPI.traces.readSession(sessionId, { limit: 5_000 }),
      window.petAPI.traces.sessionSummary(sessionId),
    ])
    setEvents(result.events)
    setSummary(sessionSummary)
    const usage: Record<number, TokenUsage> = {}
    for (const entry of result.usageByTurn ?? []) usage[entry.turn] = entry.usage
    setUsageByTurn(usage)
    if (result.issues.length > 0) {
      setNotice(`读取到 ${result.issues.length} 处异常记录（已保留可用前缀）`)
    }
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const list = await refreshSessions()
        if (!active) return
        if (list[0]) await openSession(list[0].sessionId)
      } catch {
        if (active) setNotice('链路日志读取失败')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [refreshSessions, openSession])

  // 实时 tail：订阅主进程推送的增量事件
  useEffect(() => {
    if (!live) return
    void window.petAPI.traces.subscribeLive()
    const off = window.petAPI.traces.onLive((payload) => {
      if (payload.sessionId !== selectedRef.current) return
      const event = payload.event
      setEvents((current) =>
        current.some((item) => item.seq === event.seq) ? current : [...current, event],
      )
      if (event.type === 'model/result' && event.data.usage) {
        setUsageByTurn((current) => {
          const previous = current[event.turn] ?? { ...EMPTY_USAGE }
          return {
            ...current,
            [event.turn]: {
              inputTokens: previous.inputTokens + event.data.usage!.inputTokens,
              outputTokens: previous.outputTokens + event.data.usage!.outputTokens,
              cacheReadTokens: previous.cacheReadTokens + event.data.usage!.cacheReadTokens,
              cacheWriteTokens:
                previous.cacheWriteTokens + event.data.usage!.cacheWriteTokens,
              reasoningTokens:
                previous.reasoningTokens + event.data.usage!.reasoningTokens,
              ...(previous.estimated || event.data.usage!.estimated
                ? { estimated: true }
                : {}),
            },
          }
        })
      }
      if (event.type === 'turn/end') {
        void window.petAPI.traces.sessionSummary(payload.sessionId).then(setSummary)
        void refreshSessions()
      }
    })
    return () => {
      off()
      void window.petAPI.traces.unsubscribeLive()
    }
  }, [live, refreshSessions])

  const groups = useMemo(() => groupEventsByTurn(events), [events])

  const exportSession = useCallback(
    async (format: 'json' | 'markdown') => {
      if (!selectedId) return
      const result = await window.petAPI.traces.exportSession(selectedId, format)
      if (result.canceled) return
      setNotice(
        result.error
          ? `导出失败：${result.error}`
          : `已导出到 ${result.filePath ?? '所选路径'}`,
      )
    },
    [selectedId],
  )

  const collectGarbage = useCallback(async () => {
    const result = await window.petAPI.traces.collectGarbage()
    setNotice(
      `清理完成：删除 ${result.removedSessions} 个会话日志、${result.removedBlobs} 份外置原文，释放 ${Math.round(
        result.freedBytes / 1024,
      )} KB`,
    )
    await refreshSessions()
  }, [refreshSessions])

  return (
    <div className="trace-app">
      <aside className="trace-sidebar">
        <header className="trace-sidebar-head">
          <h1>链路追踪台</h1>
          <div className="trace-actions">
            <button
              type="button"
              onClick={() => {
                void refreshSessions()
              }}
            >
              刷新
            </button>
            <label className="trace-live">
              <input
                type="checkbox"
                checked={live}
                onChange={(event) => setLive(event.target.checked)}
              />
              实时
            </label>
          </div>
        </header>
        {loading ? (
          <p className="trace-empty">正在读取链路日志…</p>
        ) : (
          <SessionList
            sessions={sessions}
            selectedId={selectedId}
            onSelect={(id) => {
              void openSession(id)
            }}
          />
        )}
        <footer className="trace-sidebar-foot">
          <button type="button" onClick={() => void collectGarbage()}>
            清理超期日志
          </button>
        </footer>
      </aside>

      <main className="trace-main">
        {notice && <p className="trace-notice">{notice}</p>}
        {!selectedId ? (
          <p className="trace-empty">从左侧选择一个会话查看完整链路。</p>
        ) : (
          <>
            <header className="trace-main-head">
              <div>
                <strong>{selectedId.slice(0, 8)}</strong>
                {summary && (
                  <span className="trace-dim">
                    {' '}
                    · {summary.turns} 轮 · {statusLabel(summary.lastStatus ?? 'running')} ·
                    累计 {summary.durationMs}ms
                  </span>
                )}
              </div>
              <div className="trace-usage trace-usage-total">
                会话累计：{formatUsage(summary?.usage)}
              </div>
              <div className="trace-actions">
                <button type="button" onClick={() => void exportSession('markdown')}>
                  导出 Markdown
                </button>
                <button type="button" onClick={() => void exportSession('json')}>
                  导出 JSON
                </button>
              </div>
            </header>

            <div className="trace-turns">
              {groups.length === 0 && <p className="trace-empty">该会话暂无事件。</p>}
              {groups.map((group) => (
                <TurnTimeline
                  key={group.turn}
                  group={group}
                  usage={usageByTurn[group.turn]}
                  headerError={
                    group.status === 'error' || group.status === 'interrupted'
                      ? `终态：${statusLabel(group.status)}`
                      : undefined
                  }
                />
              ))}
            </div>

            <footer className="trace-main-foot">
              <span className="trace-dim">
                事件时间以本地时间显示；最近事件 {formatTime(events.at(-1)?.time ?? Date.now())}
              </span>
            </footer>
          </>
        )}
      </main>
    </div>
  )
}
