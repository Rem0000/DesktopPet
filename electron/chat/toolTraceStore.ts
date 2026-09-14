import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type {
  KnowledgeCitation,
  ToolTraceRecord,
  ToolTraceStats,
} from '../../src/chat/contracts'
import type { TraceEvent } from '../../src/trace/contracts'
import type { TraceStore } from '../trace/traceStore'
import { citationsFromToolOutput } from './knowledgeService'
import { redactSensitive } from './redact'

const LEGACY_DIR = 'legacy'

function dayKey(iso = new Date().toISOString()): string {
  return iso.slice(0, 10)
}

function parseRecord(line: string): ToolTraceRecord | null {
  try {
    const value = JSON.parse(line) as Partial<ToolTraceRecord>
    if (
      typeof value.requestId !== 'string' ||
      typeof value.sessionId !== 'string' ||
      typeof value.toolName !== 'string' ||
      typeof value.startedAt !== 'string' ||
      typeof value.endedAt !== 'string' ||
      typeof value.ok !== 'boolean' ||
      typeof value.latencyMs !== 'number'
    ) {
      return null
    }
    return value as ToolTraceRecord
  } catch {
    return null
  }
}

/** 从链路事件取文本字段的可读内容（内联原文或摘要预览） */
function textOfValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'preview' in (value as object)) {
    const preview = (value as { preview?: unknown }).preview
    if (typeof preview === 'string') return preview
  }
  return ''
}

/** 工具输出被外置时无法还原 citations；此处按可解析即解析处理 */
function citationsOfOutput(output: unknown): KnowledgeCitation[] {
  const text = textOfValue(output)
  if (!text) return []
  try {
    return citationsFromToolOutput(JSON.parse(text) as unknown)
  } catch {
    return []
  }
}

/**
 * 把某会话的链路事件折叠为既有 `ToolTraceRecord` 投影（聊天窗时间线回填与旧查询接口复用）。
 * 只统计真正尝试执行的工具（`tool/result`），与旧实现「一次调用一条记录」语义一致。
 */
export function projectEventsToToolRecords(
  sessionId: string,
  events: TraceEvent[],
): ToolTraceRecord[] {
  const requestIdByTurn = new Map<number, string>()
  const assistantMessageByTurn = new Map<number, string>()
  const argsByCallId = new Map<string, string>()

  for (const event of events) {
    switch (event.type) {
      case 'turn/start':
        if (event.data.requestId) requestIdByTurn.set(event.turn, event.data.requestId)
        break
      case 'assistant/message':
        assistantMessageByTurn.set(event.turn, event.data.messageId)
        break
      case 'tool/call':
        argsByCallId.set(event.data.callId, textOfValue(event.data.args))
        break
      default:
        break
    }
  }

  const records: ToolTraceRecord[] = []
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    const record: ToolTraceRecord = {
      requestId:
        requestIdByTurn.get(event.turn) ?? `trace:${sessionId}:${event.turn}`,
      sessionId,
      messageId: assistantMessageByTurn.get(event.turn),
      toolName: event.data.name,
      // 事件时间是结束时刻；起始时刻由耗时回推（与旧实现一致）
      startedAt: new Date(event.time - event.data.latencyMs).toISOString(),
      endedAt: new Date(event.time).toISOString(),
      ok: event.data.ok,
      errorCode: event.data.errorCode,
      latencyMs: event.data.latencyMs,
      inputSummary: summarizeArgs(argsByCallId.get(event.data.callId)),
    }
    if (event.data.output !== undefined) {
      const preview = redactSensitive(textOfValue(event.data.output), 400)
      if (preview) record.outputPreview = preview
    }
    const citations = citationsOfOutput(event.data.output)
    if (citations.length > 0) record.citations = citations
    records.push(record)
  }
  return records
}

function summarizeArgs(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  return redactSensitive(raw, 160)
}

/**
 * 工具调用记录存储（兼容层）。
 *
 * - 读取：优先从会话链路日志（`data/traces/sessions/*.jsonl`）折叠出 `ToolTraceRecord` 投影，
 *   并合并 `data/traces/legacy/`（及 traces 根）下的旧日报文件，形成双读过渡。
 * - 写入：`append()` 仅保留给遗留调用方与评测；聊天主链路已改由链路日志承载，
 *   不再产生新的日报文件，避免同一调用被统计两次。
 */
export class ToolTraceStore {
  private readonly legacyDirectory: string
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly storageDirectory: string,
    private readonly traceLog?: TraceStore,
  ) {
    this.legacyDirectory = path.join(storageDirectory, LEGACY_DIR)
  }

  async initialize(): Promise<void> {
    await mkdir(this.storageDirectory, { recursive: true })
    await mkdir(this.legacyDirectory, { recursive: true })
  }

  /** 兼容写入：日报 JSONL（遗留调用方/评测使用） */
  async append(record: ToolTraceRecord): Promise<void> {
    const filePath = path.join(this.storageDirectory, `${dayKey(record.startedAt)}.jsonl`)
    const line = `${JSON.stringify(record)}\n`
    const operation = this.writeQueue.then(async () => {
      await mkdir(this.storageDirectory, { recursive: true })
      const { appendFile } = await import('node:fs/promises')
      await appendFile(filePath, line, 'utf8')
    })
    this.writeQueue = operation.catch(() => undefined)
    await operation
  }

  /** 旧日报迁移到 traces/legacy/（幂等；目标已存在则跳过） */
  async migrateLegacyDayFiles(): Promise<number> {
    const { readdir, rename } = await import('node:fs/promises')
    await mkdir(this.legacyDirectory, { recursive: true })
    let names: string[] = []
    try {
      names = await readdir(this.storageDirectory)
    } catch {
      return 0
    }
    let moved = 0
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue
      try {
        await rename(
          path.join(this.storageDirectory, name),
          path.join(this.legacyDirectory, name),
        )
        moved += 1
      } catch {
        // 目标已存在或文件被占用：保持原状（读取仍会覆盖 traces 根）
      }
    }
    return moved
  }

  async listBySession(sessionId: string): Promise<ToolTraceRecord[]> {
    const fromEvents = await this.projectSession(sessionId)
    const fromLegacy = await this.readLegacyFiles((record) => record.sessionId === sessionId)
    return [...fromLegacy, ...fromEvents].sort(
      (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
    )
  }

  async summarize(): Promise<ToolTraceStats[]> {
    const buckets = new Map<string, { calls: number; successes: number; latencies: number[] }>()
    const add = (record: ToolTraceRecord): void => {
      const bucket = buckets.get(record.toolName) ?? { calls: 0, successes: 0, latencies: [] }
      bucket.calls += 1
      if (record.ok) bucket.successes += 1
      bucket.latencies.push(record.latencyMs)
      buckets.set(record.toolName, bucket)
    }

    for (const record of await this.readLegacyFiles(() => true)) add(record)
    for (const { sessionId, events } of await this.readAllEvents()) {
      for (const record of projectEventsToToolRecords(sessionId, events)) add(record)
    }

    return [...buckets.entries()]
      .map(([toolName, bucket]) => ({
        toolName,
        calls: bucket.calls,
        successes: bucket.successes,
        avgLatencyMs:
          bucket.calls === 0
            ? 0
            : Math.round(
                bucket.latencies.reduce((sum, value) => sum + value, 0) / bucket.calls,
              ),
      }))
      .sort((a, b) => b.calls - a.calls)
  }

  private async projectSession(sessionId: string): Promise<ToolTraceRecord[]> {
    if (!this.traceLog) return []
    try {
      const result = await this.traceLog.readSession(sessionId, { limit: 100_000 })
      return projectEventsToToolRecords(sessionId, result.events)
    } catch {
      return []
    }
  }

  private async readAllEvents(): Promise<Array<{ sessionId: string; events: TraceEvent[] }>> {
    if (!this.traceLog) return []
    try {
      return await this.traceLog.readAllSessions()
    } catch {
      return []
    }
  }

  /** 读取 legacy/ 与 traces 根下的历史日报（双读过渡期） */
  private async readLegacyFiles(
    filter: (record: ToolTraceRecord) => boolean,
  ): Promise<ToolTraceRecord[]> {
    const { readdir, readFile } = await import('node:fs/promises')
    const records: ToolTraceRecord[] = []
    for (const dir of [this.legacyDirectory, this.storageDirectory]) {
      let names: string[] = []
      try {
        names = (await readdir(dir)).filter((name) => name.endsWith('.jsonl'))
      } catch {
        continue
      }
      for (const name of names.sort()) {
        let raw: string
        try {
          raw = await readFile(path.join(dir, name), 'utf8')
        } catch {
          continue
        }
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue
          const record = parseRecord(line)
          if (record && filter(record)) records.push(record)
        }
      }
    }
    return records
  }
}
