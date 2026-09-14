import type { KnowledgeCitation, ToolTraceRecord } from './contracts'

export type ToolTimelineItem = {
  toolName: string
  phase: 'start' | 'end'
  ok?: boolean
  errorCode?: string
  latencyMs?: number
  inputSummary?: string
  /** 工具真实输出预览（来自链路投影，超限时提示查看追踪台） */
  outputPreview?: string
  hitCount?: number
}

export type HydratedToolState = {
  toolTimelines: Record<string, ToolTimelineItem[]>
  citationsByMessage: Record<string, KnowledgeCitation[]>
}

/** 将落盘的工具 trace 还原为聊天窗时间线与 RAG 引用 */
export function hydrateToolStateFromTraces(
  traces: ToolTraceRecord[],
  assistantMessageIds: ReadonlySet<string>,
): HydratedToolState {
  const toolTimelines: Record<string, ToolTimelineItem[]> = {}
  const citationsByMessage: Record<string, KnowledgeCitation[]> = {}

  for (const trace of traces) {
    if (!trace.messageId || !assistantMessageIds.has(trace.messageId)) continue

    const item: ToolTimelineItem = {
      toolName: trace.toolName,
      phase: 'end',
      ok: trace.ok,
      errorCode: trace.errorCode,
      latencyMs: trace.latencyMs,
      inputSummary: trace.inputSummary,
      outputPreview: trace.outputPreview,
      hitCount:
        trace.toolName === 'search_knowledge'
          ? (trace.citations?.length ?? 0)
          : undefined,
    }

    const list = toolTimelines[trace.messageId] ?? []
    list.push(item)
    toolTimelines[trace.messageId] = list

    if (trace.citations && trace.citations.length > 0) {
      citationsByMessage[trace.messageId] = [
        ...(citationsByMessage[trace.messageId] ?? []),
        ...trace.citations,
      ]
    }
  }

  return { toolTimelines, citationsByMessage }
}
