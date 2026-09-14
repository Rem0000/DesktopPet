import {
  EMPTY_TOKEN_USAGE,
  type TokenUsage,
  type TraceContextProjection,
  type TraceEvent,
  type TraceHeader,
  type TraceSessionSummary,
  type TraceStats,
  type TraceToolStat,
  type TraceTurnStatus,
} from '../../src/trace/contracts'

/**
 * 链路日志的**读侧投影**：纯函数（事件数组 → 聚合值），不维护任何可写聚合状态。
 * token 用量只从 `model/result` 折叠（每次调用的计量来源），
 * 不叠加 `assistant/message` 与 `turn/end` 上的用量，避免同一调用被重复累加。
 */

/** 四类互斥计数累加；reasoningTokens 为输出子集，仅累加展示值 */
export function addUsage(target: TokenUsage, add: TokenUsage | undefined): TokenUsage {
  if (!add) return target
  target.inputTokens += add.inputTokens
  target.outputTokens += add.outputTokens
  target.cacheReadTokens += add.cacheReadTokens
  target.cacheWriteTokens += add.cacheWriteTokens
  target.reasoningTokens += add.reasoningTokens
  if (add.estimated) target.estimated = true
  return target
}

/** 折叠 token 用量（provider 未返回时为估算并保留 estimated 标记） */
export function foldTokenUsage(events: TraceEvent[]): TokenUsage {
  const usage: TokenUsage = { ...EMPTY_TOKEN_USAGE }
  for (const event of events) {
    if (event.type === 'model/result') addUsage(usage, event.data.usage)
  }
  return usage
}

/** 按轮次折叠用量 */
export function foldUsageByTurn(events: TraceEvent[]): Map<number, TokenUsage> {
  const byTurn = new Map<number, TokenUsage>()
  for (const event of events) {
    if (event.type !== 'model/result') continue
    const current = byTurn.get(event.turn) ?? { ...EMPTY_TOKEN_USAGE }
    addUsage(current, event.data.usage)
    byTurn.set(event.turn, current)
  }
  return byTurn
}

/** 最新一次请求的上下文占用（按次落盘，可查历史轮次） */
export function foldContextPressure(events: TraceEvent[]): TraceContextProjection {
  let latest: Extract<TraceEvent, { type: 'request/context' }> | undefined
  let latestResult: Extract<TraceEvent, { type: 'model/result' }> | undefined
  for (const event of events) {
    if (event.type === 'request/context') latest = event
    if (event.type === 'model/result' && event.data.usage) latestResult = event
  }
  if (!latest) {
    return {
      budgetCharacters: 0,
      usedCharacters: 0,
      ratio: 0,
      parts: { systemPrompt: 0, systemTools: 0, skills: 0, memory: 0, messages: 0 },
      observed: false,
    }
  }
  const { budgetCharacters, usedCharacters, parts } = latest.data
  const usage = latestResult?.data.usage
  const pressureTokens = usage
    ? usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
    : undefined
  return {
    budgetCharacters,
    usedCharacters,
    ratio: budgetCharacters > 0 ? Math.min(1, usedCharacters / budgetCharacters) : 0,
    parts: { ...parts },
    pressureTokens,
    observed: true,
    updatedAt: latest.time,
  }
}

function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(ratio * sorted.length) - 1),
  )
  return sorted[index]!
}

/** 工具调用统计：次数、成功率、平均与 p95 耗时 */
export function foldToolStats(events: TraceEvent[]): TraceToolStat[] {
  const buckets = new Map<string, { calls: number; successes: number; latencies: number[] }>()
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    const bucket = buckets.get(event.data.name) ?? { calls: 0, successes: 0, latencies: [] }
    bucket.calls += 1
    if (event.data.ok) bucket.successes += 1
    bucket.latencies.push(event.data.latencyMs)
    buckets.set(event.data.name, bucket)
  }
  return [...buckets.entries()]
    .map(([toolName, bucket]) => {
      const sorted = [...bucket.latencies].sort((a, b) => a - b)
      const total = sorted.reduce((sum, value) => sum + value, 0)
      return {
        toolName,
        calls: bucket.calls,
        successes: bucket.successes,
        avgLatencyMs: bucket.calls === 0 ? 0 : Math.round(total / bucket.calls),
        p95LatencyMs: Math.round(percentile(sorted, 0.95)),
      }
    })
    .sort((a, b) => b.calls - a.calls)
}

/** 会话级统计（供追踪台与评测对照）：用量只呈现 token，不产出金额字段 */
export function foldStats(events: TraceEvent[]): TraceStats {
  let turns = 0
  let modelCalls = 0
  let toolCalls = 0
  for (const event of events) {
    if (event.type === 'turn/end') turns += 1
    if (event.type === 'model/result') modelCalls += 1
    if (event.type === 'tool/result') toolCalls += 1
  }
  return {
    turns,
    modelCalls,
    toolCalls,
    usage: foldTokenUsage(events),
    tools: foldToolStats(events),
  }
}

/** 会话列表项：header + 事件折叠 */
export function summarizeSession(
  header: TraceHeader,
  events: TraceEvent[],
): TraceSessionSummary {
  let turns = 0
  let lastStatus: TraceTurnStatus | undefined
  let durationMs = 0
  let toolCalls = 0
  let toolSuccesses = 0
  let updatedAt = header.createdAt
  for (const event of events) {
    updatedAt = Math.max(updatedAt, event.time)
    if (event.type === 'turn/end') {
      turns += 1
      lastStatus = event.data.status
      durationMs += event.data.latencyMs
    }
    if (event.type === 'tool/result') {
      toolCalls += 1
      if (event.data.ok) toolSuccesses += 1
    }
  }
  return {
    sessionId: header.sessionId,
    packageId: header.packageId,
    createdAt: header.createdAt,
    updatedAt,
    turns,
    lastStatus,
    usage: foldTokenUsage(events),
    toolCalls,
    toolSuccesses,
    durationMs,
  }
}
