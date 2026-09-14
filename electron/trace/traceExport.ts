import type {
  TokenUsage,
  TraceEvent,
  TraceHeader,
  TraceSessionSummary,
} from '../../src/trace/contracts'
import { redactFull } from './traceFields'

export type TraceExportFormat = 'json' | 'markdown'

/**
 * 导出副本再遮罩（纵深防御）：写入侧已遮罩，导出仍对全部字符串再跑一遍遮罩，
 * 避免历史日志（例如旧格式或人工改动过的文件）把明文带出去。
 */
export function redactForExport(value: unknown, depth = 0): unknown {
  if (depth > 12) return value
  if (typeof value === 'string') return redactFull(value)
  if (Array.isArray(value)) return value.map((item) => redactForExport(item, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactForExport(item, depth + 1)
    }
    return out
  }
  return value
}

/** 结构化导出：header + 事件 + 会话摘要（供二次分析或归档） */
export function exportSessionToJson(input: {
  header: TraceHeader
  events: TraceEvent[]
  summary: TraceSessionSummary
}): string {
  return `${JSON.stringify(
    redactForExport({
      header: input.header,
      summary: input.summary,
      events: input.events,
    }),
    null,
    2,
  )}\n`
}

function formatUsage(usage: TokenUsage): string {
  const estimated = usage.estimated ? '（估算）' : ''
  return `未缓存输入 ${usage.inputTokens} / 输出 ${usage.outputTokens} / 缓存读 ${usage.cacheReadTokens} / 缓存写 ${usage.cacheWriteTokens} / 推理 ${usage.reasoningTokens}${estimated}`
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'preview' in (value as object)) {
    const preview = (value as { preview?: unknown }).preview
    if (typeof preview === 'string') return `${preview}（原文已外置）`
  }
  return ''
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

/**
 * 可读报告导出：按轮次展开时间轴、模型调用与工具调用，并给出累计 token 汇总。
 * 只呈现 token 用量，不产出金额/成本字段。
 */
export function exportSessionToMarkdown(input: {
  header: TraceHeader
  events: TraceEvent[]
  summary: TraceSessionSummary
}): string {
  const { header, events, summary } = input
  const lines: string[] = []
  lines.push(`# 链路追踪报告 · ${redactFull(header.sessionId)}`)
  lines.push('')
  lines.push(`- 模型包：${redactFull(header.packageId)}`)
  lines.push(`- 创建时间：${new Date(header.createdAt).toISOString()}`)
  lines.push(`- 最近更新：${new Date(summary.updatedAt).toISOString()}`)
  lines.push(
    `- 轮数：${summary.turns}${summary.lastStatus ? `（最后状态：${summary.lastStatus}）` : ''}`,
  )
  lines.push(`- 累计耗时：${summary.durationMs}ms`)
  lines.push(`- 工具调用：${summary.toolCalls}（成功 ${summary.toolSuccesses}）`)
  lines.push(`- token 用量：${formatUsage(summary.usage)}`)
  lines.push(`- 模型：${redactFull(header.provider.model)}（${header.provider.kind}）`)
  lines.push('')

  const turns = [...new Set(events.map((event) => event.turn))].sort((a, b) => a - b)
  for (const turn of turns) {
    const turnEvents = events.filter((event) => event.turn === turn)
    const turnEnd = turnEvents.find((event) => event.type === 'turn/end')
    const status =
      turnEnd?.type === 'turn/end' ? turnEnd.data.status : 'running'
    const latency = turnEnd?.type === 'turn/end' ? `${turnEnd.data.latencyMs}ms` : '—'
    lines.push(`## 第 ${turn} 轮 · ${status} · ${latency}`)
    lines.push('')

    const modelCalls = turnEvents.filter((event) => event.type === 'model/result')
    if (modelCalls.length > 0) {
      lines.push('| 模型调用 | 模型 | 耗时 | 首字 | token | 结束原因 |')
      lines.push('| --- | --- | --- | --- | --- | --- |')
      for (const event of modelCalls) {
        if (event.type !== 'model/result') continue
        const usage = event.data.usage
        lines.push(
          `| ${event.data.kind}${event.data.ok ? '' : '（失败）'} | ${redactFull(event.data.model)} | ${event.data.latencyMs}ms | ${
            event.data.ttftMs === undefined ? '—' : `${event.data.ttftMs}ms`
          } | ${
            usage
              ? `in ${usage.inputTokens} / out ${usage.outputTokens} / cache-r ${usage.cacheReadTokens} / reasoning ${usage.reasoningTokens}${usage.estimated ? '（估算）' : ''}`
              : '—'
          } | ${event.data.finishReason ?? event.data.errorCode ?? '—'} |`,
        )
      }
      lines.push('')
    }

    for (const event of turnEvents) {
      if (event.type !== 'tool/call') continue
      const result = turnEvents.find(
        (candidate) =>
          candidate.type === 'tool/result' && candidate.data.callId === event.data.callId,
      )
      lines.push(`### 工具 · ${redactFull(event.data.name)}`)
      lines.push('')
      lines.push(`- 风险等级：${event.data.riskLevel}`)
      lines.push(`- 参数：\`${escapeCell(redactFull(textOf(event.data.args)))}\``)
      if (result?.type === 'tool/result') {
        lines.push(
          `- 结果：${result.data.ok ? '成功' : `失败（${result.data.errorCode ?? 'error'}）`} · ${result.data.latencyMs}ms`,
        )
        if (result.data.output !== undefined) {
          lines.push(`- 输出：\`${escapeCell(redactFull(textOf(result.data.output)))}\``)
        }
        if (result.data.message) lines.push(`- 说明：${redactFull(result.data.message)}`)
      } else {
        lines.push('- 结果：未完成（轮次中断或未执行）')
      }
      lines.push('')
    }

    const retrieval = turnEvents.filter((event) => event.type === 'retrieval/hits')
    if (retrieval.length > 0) {
      lines.push('### 检索命中')
      lines.push('')
      for (const event of retrieval) {
        if (event.type !== 'retrieval/hits') continue
        lines.push(
          `- ${event.data.source} · 查询「${redactFull(event.data.query)}」 · 命中 ${event.data.hits.length} 条 · ${event.data.latencyMs}ms`,
        )
      }
      lines.push('')
    }

    const steps = turnEvents.filter((event) => event.type === 'step/end')
    if (steps.length > 0) {
      lines.push('### 节点耗时')
      lines.push('')
      lines.push('| 节点 | 耗时 |')
      lines.push('| --- | --- |')
      for (const event of steps) {
        if (event.type !== 'step/end') continue
        lines.push(`| ${event.data.node}${event.data.note ? `（${redactFull(event.data.note)}）` : ''} | ${event.data.latencyMs}ms |`)
      }
      lines.push('')
    }
  }

  return `${lines.join('\n')}\n`
}
