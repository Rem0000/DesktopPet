import type {
  TokenUsage,
  TraceEvent,
  TraceSessionSummary,
} from './contracts'
import { formatUsage } from './format'

export { formatUsage }

/**
 * 链路追踪台的纯展示组件与纯函数：不访问 window.petAPI，便于用
 * `renderToStaticMarkup` 做渲染测试。数据聚合在主进程完成（见 electron/trace/projections.ts）。
 */

export type TurnGroup = {
  turn: number
  status: string
  latencyMs?: number
  events: TraceEvent[]
}

/** 按轮次分组（保持事件顺序） */
export function groupEventsByTurn(events: TraceEvent[]): TurnGroup[] {
  const groups = new Map<number, TurnGroup>()
  for (const event of events) {
    const group = groups.get(event.turn) ?? {
      turn: event.turn,
      status: 'running',
      events: [],
    }
    group.events.push(event)
    if (event.type === 'turn/end') {
      group.status = event.data.status
      group.latencyMs = event.data.latencyMs
    }
    groups.set(event.turn, group)
  }
  return [...groups.values()].sort((a, b) => a.turn - b.turn)
}

export function formatTime(epochMs: number): string {
  const date = new Date(epochMs)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function textOfValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'preview' in (value as object)) {
    const field = value as { preview?: unknown; sha256?: unknown; blobRef?: unknown }
    const preview = typeof field.preview === 'string' ? field.preview : ''
    const suffix = field.blobRef ? '（原文已外置，可按摘要查看）' : '（仅摘要）'
    return `${preview}${suffix}`
  }
  return ''
}

export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

const STATUS_LABEL: Record<string, string> = {
  completed: '完成',
  cancelled: '已取消',
  error: '失败',
  interrupted: '已中断',
  running: '进行中',
}

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status
}

export function SessionList(props: {
  sessions: TraceSessionSummary[]
  selectedId: string | null
  onSelect: (sessionId: string) => void
}) {
  if (props.sessions.length === 0) {
    return <p className="trace-empty">暂无链路记录：发一条消息后即可在此查看。</p>
  }
  return (
    <ul className="trace-session-list">
      {props.sessions.map((session) => (
        <li key={session.sessionId}>
          <button
            type="button"
            className={`trace-session-item${
              props.selectedId === session.sessionId ? ' is-selected' : ''
            }`}
            onClick={() => props.onSelect(session.sessionId)}
          >
            <span className="trace-session-id">{session.sessionId.slice(0, 8)}</span>
            <span className="trace-session-meta">
              {session.turns} 轮 · {session.durationMs}ms · 工具 {session.toolSuccesses}/
              {session.toolCalls}
            </span>
            <span className="trace-session-usage">
              in {session.usage.inputTokens} · out {session.usage.outputTokens}
            </span>
            {session.lastStatus && (
              <span className={`trace-status trace-status-${session.lastStatus}`}>
                {statusLabel(session.lastStatus)}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}

export function ModelCard(props: { event: Extract<TraceEvent, { type: 'model/result' }> }) {
  const { data } = props.event
  return (
    <div className={`trace-card trace-model${data.ok ? '' : ' is-failed'}`}>
      <div className="trace-card-head">
        <strong>模型调用 · {data.kind}</strong>
        <span>{data.model}</span>
        <span className="trace-dim">
          {data.latencyMs}ms
          {data.ttftMs === undefined ? '' : ` · 首字 ${data.ttftMs}ms`}
        </span>
        <span className="trace-usage">{formatUsage(data.usage)}</span>
        {!data.ok && <span className="trace-error">{data.errorCode ?? 'error'}</span>}
        {data.finishReason && <span className="trace-dim">{data.finishReason}</span>}
      </div>
      {data.message && <pre className="trace-pre trace-pre-error">{data.message}</pre>}
    </div>
  )
}

export function ToolCard(props: {
  call: Extract<TraceEvent, { type: 'tool/call' }>
  result?: Extract<TraceEvent, { type: 'tool/result' }>
  confirm?: Extract<TraceEvent, { type: 'tool/confirm' }>
}) {
  const { call, result, confirm } = props
  return (
    <div className={`trace-card trace-tool${result && !result.data.ok ? ' is-failed' : ''}`}>
      <div className="trace-card-head">
        <strong>工具 · {call.data.name}</strong>
        <span className={`trace-risk trace-risk-${call.data.riskLevel}`}>
          {call.data.riskLevel === 'confirm' ? '需确认' : '安全'}
        </span>
        {result ? (
          <>
            <span className={result.data.ok ? 'trace-ok' : 'trace-error'}>
              {result.data.ok ? '成功' : `失败 ${result.data.errorCode ?? ''}`}
            </span>
            <span className="trace-dim">{result.data.latencyMs}ms</span>
          </>
        ) : (
          <span className="trace-dim">未完成</span>
        )}
        {confirm && (
          <span className="trace-dim">
            确认：{confirm.data.decision === 'approved' ? '同意' : '拒绝'} ·{' '}
            {confirm.data.waitedMs}ms
          </span>
        )}
      </div>
      <details className="trace-detail">
        <summary>参数</summary>
        <pre className="trace-pre">{prettyJson(textOfValue(call.data.args))}</pre>
      </details>
      {result?.data.output !== undefined && (
        <details className="trace-detail">
          <summary>结果</summary>
          <pre className="trace-pre">{prettyJson(textOfValue(result.data.output))}</pre>
        </details>
      )}
      {result?.data.message && (
        <div className="trace-error trace-message">{result.data.message}</div>
      )}
    </div>
  )
}

export function RetrievalList(props: {
  events: Array<Extract<TraceEvent, { type: 'retrieval/hits' }>>
}) {
  if (props.events.length === 0) return null
  return (
    <div className="trace-card trace-retrieval">
      <div className="trace-card-head">
        <strong>检索命中</strong>
      </div>
      <ul>
        {props.events.map((event, index) => (
          <li key={`${event.data.source}-${index}`}>
            <span className="trace-dim">{event.data.source}</span> 「{event.data.query}」 ·{' '}
            {event.data.hits.length} 条 · {event.data.latencyMs}ms
            {event.data.hits.length > 0 && (
              <ul className="trace-hit-list">
                {event.data.hits.slice(0, 5).map((hit) => (
                  <li key={hit.id}>
                    <code>{hit.id}</code>
                    {hit.score === undefined ? '' : ` · 分数 ${hit.score.toFixed(3)}`}
                    {hit.recallSource ? ` · ${hit.recallSource}` : ''}
                    {hit.title ? ` · ${hit.title}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function NodeTimings(props: { events: TraceEvent[] }) {
  const steps = props.events.filter(
    (event): event is Extract<TraceEvent, { type: 'step/end' }> =>
      event.type === 'step/end',
  )
  if (steps.length === 0) return null
  return (
    <div className="trace-nodes">
      {steps.map((event, index) => (
        <span key={`${event.data.node}-${index}`} className="trace-node">
          {event.data.node} <span className="trace-dim">{event.data.latencyMs}ms</span>
          {event.data.note ? <span className="trace-error"> {event.data.note}</span> : null}
        </span>
      ))}
    </div>
  )
}

export function TurnTimeline(props: {
  group: TurnGroup
  usage?: TokenUsage
  headerError?: string
}) {
  const { group } = props
  const calls = group.events.filter(
    (event): event is Extract<TraceEvent, { type: 'tool/call' }> =>
      event.type === 'tool/call',
  )
  const results = group.events.filter(
    (event): event is Extract<TraceEvent, { type: 'tool/result' }> =>
      event.type === 'tool/result',
  )
  const confirms = group.events.filter(
    (event): event is Extract<TraceEvent, { type: 'tool/confirm' }> =>
      event.type === 'tool/confirm',
  )
  const models = group.events.filter(
    (event): event is Extract<TraceEvent, { type: 'model/result' }> =>
      event.type === 'model/result',
  )
  const retrievals = group.events.filter(
    (event): event is Extract<TraceEvent, { type: 'retrieval/hits' }> =>
      event.type === 'retrieval/hits',
  )
  const userMessage = group.events.find((event) => event.type === 'user/message')
  const assistantMessage = group.events.find(
    (event) => event.type === 'assistant/message',
  )

  return (
    <section className="trace-turn">
      <header className="trace-turn-head">
        <strong>第 {group.turn} 轮</strong>
        <span className={`trace-status trace-status-${group.status}`}>
          {statusLabel(group.status)}
        </span>
        {group.latencyMs !== undefined && (
          <span className="trace-dim">{group.latencyMs}ms</span>
        )}
        <span className="trace-usage">{formatUsage(props.usage)}</span>
      </header>

      {userMessage?.type === 'user/message' && (
        <div className="trace-message-block">
          <span className="trace-role">用户</span>
          <span>{textOfValue(userMessage.data.content)}</span>
        </div>
      )}

      <NodeTimings events={group.events} />

      {models.map((event, index) => (
        <ModelCard key={`model-${index}`} event={event} />
      ))}

      {calls.map((call) => (
        <ToolCard
          key={call.data.callId}
          call={call}
          result={results.find((item) => item.data.callId === call.data.callId)}
          confirm={confirms.find((item) => item.data.callId === call.data.callId)}
        />
      ))}

      <RetrievalList events={retrievals} />

      {assistantMessage?.type === 'assistant/message' && (
        <div className="trace-message-block">
          <span className="trace-role">桌宠</span>
          <span>{textOfValue(assistantMessage.data.content)}</span>
        </div>
      )}

      {props.headerError && (
        <p className="trace-error">该轮未正常收尾：{props.headerError}</p>
      )}
    </section>
  )
}
