import { mkdir, open, readdir, truncate, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  TRACE_FORMAT_VERSION,
  type TraceConfig,
  type TraceEvent,
  type TraceEventMap,
  type TraceEventType,
  type TraceHeader,
  type TraceStepNode,
  type TokenUsage,
} from '../../src/trace/contracts'
import { encodeTraceSegment, type TraceDirPaths } from '../projectPaths'
import { scanSessionLog, parseSessionLog } from './traceReader'

/** 落盘失败等内部异常的诊断（不抛出，避免影响聊天主链路） */
export type TraceWriterDiagnostics = {
  sessionId: string
  droppedEvents: number
  lastError?: string
}

function sumUsage(target: TokenUsage, add: TokenUsage | undefined): void {
  if (!add) return
  target.inputTokens += add.inputTokens
  target.outputTokens += add.outputTokens
  target.cacheReadTokens += add.cacheReadTokens
  target.cacheWriteTokens += add.cacheWriteTokens
  target.reasoningTokens += add.reasoningTokens
  if (add.estimated) target.estimated = true
}

/**
 * 单会话事件流写入器。
 *
 * 关键约定：
 * - `append()` 同步、零 await、不抛：只分配 seq、序列化入队并调度异步落盘，
 *   因此观测绝不会拖慢聊天，也不会因落盘失败中断回复。
 * - 首行为不可变 header；已存在文件时由扫描恢复 seq 与余量，不重写历史。
 * - fsync 档位：never / checkpoint（默认）/ turn。
 */
export class TraceSessionWriter {
  readonly sessionId: string
  private readonly filePath: string
  private readonly blobsDir: string
  private readonly config: TraceConfig
  private readonly onEvent?: (sessionId: string, event: TraceEvent) => void
  private readonly diagnostics: TraceWriterDiagnostics

  private seq = 0
  private opened = false
  private opening: Promise<void> | null = null
  private pendingLines: string[] = []
  private pendingBlobs = new Map<string, string>()
  private draining: Promise<void> | null = null
  private needsFsync = false

  constructor(
    sessionId: string,
    paths: TraceDirPaths,
    config: TraceConfig,
    onEvent?: (sessionId: string, event: TraceEvent) => void,
  ) {
    this.sessionId = sessionId
    this.filePath = path.join(paths.sessions, `${encodeTraceSegment(sessionId)}.jsonl`)
    this.blobsDir = paths.blobs
    this.config = config
    this.onEvent = onEvent
    this.diagnostics = { sessionId, droppedEvents: 0 }
  }

  get logPath(): string {
    return this.filePath
  }

  getDiagnostics(): TraceWriterDiagnostics {
    return { ...this.diagnostics }
  }

  /** 确保首行 header 已写入；已存在日志时恢复 seq。可安全重复调用。 */
  async open(headerFacts: Omit<TraceHeader, 'type' | 'version'>): Promise<void> {
    if (this.opened) return
    if (this.opening) return this.opening
    this.opening = (async () => {
      try {
        await mkdir(path.dirname(this.filePath), { recursive: true })
        await mkdir(this.blobsDir, { recursive: true })
        const existing = await scanSessionLog(this.filePath)
        if (existing.header) {
          this.seq = existing.lastSeq + 1
          this.opened = true
          return
        }
        const header: TraceHeader = {
          type: 'trace-session',
          version: TRACE_FORMAT_VERSION,
          ...headerFacts,
        }
        const handle = await open(this.filePath, 'wx')
        try {
          await handle.writeFile(`${JSON.stringify(header)}\n`, 'utf8')
          await handle.sync().catch(() => undefined)
        } finally {
          await handle.close()
        }
        this.seq = 0
        this.opened = true
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'EEXIST') {
          // 竞态：文件刚被创建，按已存在处理
          const existing = await scanSessionLog(this.filePath).catch(() => null)
          this.seq = existing ? existing.lastSeq + 1 : 0
          this.opened = true
          return
        }
        this.recordError(error)
      } finally {
        this.opening = null
      }
    })()
    return this.opening
  }

  /**
   * 提交一个事件。同步返回已分配 seq 的事件（便于实时推送）；日志被禁用或写入不可用时返回 null。
   */
  append<K extends TraceEventType>(input: {
    type: K
    turn: number
    data: TraceEventMap[K]
    time?: number
  }): TraceEvent<K> | null {
    if (!this.config.enabled || this.config.level === 'off') return null
    try {
      const event = {
        type: input.type,
        seq: this.seq,
        time: input.time ?? Date.now(),
        turn: input.turn,
        data: input.data,
      } as TraceEvent<K>
      this.seq += 1
      this.pendingLines.push(JSON.stringify(event))
      if (this.config.fsync === 'turn' && input.type === 'turn/end') this.needsFsync = true
      try {
        this.onEvent?.(this.sessionId, event as TraceEvent)
      } catch {
        // 订阅者异常不得影响写入
      }
      void this.scheduleDrain()
      return event
    } catch (error) {
      this.recordError(error)
      return null
    }
  }

  /** 登记待外置原文（内容寻址，重复内容只写一次） */
  addBlob(ref: string, text: string): void {
    if (this.pendingBlobs.has(ref)) return
    this.pendingBlobs.set(ref, text)
  }

  /** 语义检查点：立即把已入队事件与原文刷盘（模型请求前 / 工具派发前 / 节点结束） */
  checkpoint(): void {
    if (this.config.fsync === 'never') {
      void this.scheduleDrain()
      return
    }
    this.needsFsync = true
    void this.scheduleDrain()
  }

  /** 等待当前队列全部落盘 */
  async flush(): Promise<void> {
    await this.scheduleDrain()
    await this.draining
  }

  private scheduleDrain(): Promise<void> {
    this.draining = (this.draining ?? Promise.resolve()).then(() => this.drain())
    return this.draining
  }

  private async drain(): Promise<void> {
    if (!this.opened) {
      // header 尚未写入：本轮 drain 只等 open 完成，事件仍在队列中保持顺序
      return
    }
    const lines = this.pendingLines
    const blobs = this.pendingBlobs
    const shouldSync = this.needsFsync
    if (lines.length === 0 && blobs.size === 0 && !shouldSync) return
    this.pendingLines = []
    this.pendingBlobs = new Map()
    this.needsFsync = false
    try {
      if (blobs.size > 0) {
        await mkdir(this.blobsDir, { recursive: true })
        for (const [ref, text] of blobs) {
          await writeFile(path.join(this.blobsDir, ref), text, {
            encoding: 'utf8',
            flag: 'wx',
          }).catch((error: unknown) => {
            const code = (error as NodeJS.ErrnoException).code
            if (code !== 'EEXIST') throw error
          })
        }
      }
      if (lines.length === 0) return
      const handle = await open(this.filePath, 'a')
      try {
        await handle.writeFile(`${lines.join('\n')}\n`, 'utf8')
        if (shouldSync) await handle.sync().catch(() => undefined)
      } finally {
        await handle.close()
      }
    } catch (error) {
      this.diagnostics.droppedEvents += lines.length
      this.recordError(error)
    }
  }

  private recordError(error: unknown): void {
    this.diagnostics.lastError =
      error instanceof Error ? error.message : String(error)
  }
}

/** 合成收尾：被中断的轮次补写「结果未知」的工具结果、节点结束与中断终态 */
export function buildInterruptedClosers(events: TraceEvent[]): Array<{
  type: TraceEventType
  turn: number
  data: TraceEventMap[TraceEventType]
}> {
  if (events.length === 0) return []
  const lastTurnEnd = [...events].reverse().find((event) => event.type === 'turn/end')
  const openEvents = lastTurnEnd
    ? events.filter((event) => event.seq > lastTurnEnd.seq)
    : events
  if (openEvents.length === 0) return []
  const turn = openEvents[openEvents.length - 1]!.turn

  const calls = new Map<string, string>()
  const closedCalls = new Set<string>()
  const openSteps: TraceStepNode[] = []
  const closedSteps = new Set<TraceStepNode>()
  const usage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  }
  let modelCalls = 0
  let toolCalls = 0
  let toolSuccesses = 0

  for (const event of openEvents) {
    if (event.type === 'tool/call') calls.set(event.data.callId, event.data.name)
    if (event.type === 'tool/result') {
      closedCalls.add(event.data.callId)
      toolCalls += 1
      if (event.data.ok) toolSuccesses += 1
    }
    if (event.type === 'step/start') openSteps.push(event.data.node)
    if (event.type === 'step/end') closedSteps.add(event.data.node)
    if (event.type === 'model/result') {
      modelCalls += 1
      sumUsage(usage, event.data.usage)
    }
    if (event.type === 'assistant/message') sumUsage(usage, event.data.usage)
  }

  const closers: Array<{
    type: TraceEventType
    turn: number
    data: TraceEventMap[TraceEventType]
  }> = []
  for (const [callId, name] of calls) {
    if (closedCalls.has(callId)) continue
    closers.push({
      type: 'tool/result',
      turn,
      data: {
        callId,
        name,
        ok: false,
        latencyMs: 0,
        errorCode: 'interrupted_outcome_unknown',
        message: '进程中断，工具是否已生效未知',
      },
    })
    toolCalls += 1
  }
  for (const node of openSteps) {
    if (closedSteps.has(node)) continue
    closers.push({
      type: 'step/end',
      turn,
      data: { node, latencyMs: 0, note: 'interrupted' },
    })
  }
  closers.push({
    type: 'turn/end',
    turn,
    data: {
      status: 'interrupted',
      latencyMs: 0,
      usage,
      modelCalls,
      toolCalls,
      toolSuccesses,
      message: '进程中断，轮次未正常收尾',
    },
  })
  return closers
}

/**
 * 启动修复：日志停在轮次中间时**追加**合成收尾事件（绝不截断已完成轮次）。
 * 若尾部存在无换行的残行（进程被强杀），先截断到最后一个完整行之后再追加，
 * 否则追加内容会被并入残行而变成不可解析的一行。
 * 返回是否发生了修复。
 */
export async function repairInterruptedSession(
  filePath: string,
  config: TraceConfig,
): Promise<boolean> {
  if (!config.enabled || config.level === 'off') return false
  let scanned
  try {
    scanned = await scanSessionLog(filePath)
  } catch {
    return false
  }
  if (!scanned.header || scanned.unsupportedVersion !== undefined) return false

  // 丢弃崩溃时写了一半的残行（只动未提交区，不触碰已完成轮次）
  if (scanned.truncatedTail) {
    try {
      await truncate(filePath, scanned.committedBytes)
    } catch {
      return false
    }
  }
  if (scanned.events.length === 0) return false
  const last = scanned.events[scanned.events.length - 1]!
  if (last.type === 'turn/end') return false

  const closers = buildInterruptedClosers(scanned.events)
  if (closers.length === 0) return false
  let seq = scanned.lastSeq + 1
  const now = Date.now()
  const lines = closers.map((closer) =>
    JSON.stringify({
      type: closer.type,
      seq: seq++,
      time: now,
      turn: closer.turn,
      data: closer.data,
    }),
  )
  try {
    const handle = await open(filePath, 'a')
    try {
      await handle.writeFile(`${lines.join('\n')}\n`, 'utf8')
      await handle.sync().catch(() => undefined)
    } finally {
      await handle.close()
    }
    return true
  } catch {
    return false
  }
}

/** 扫描目录下全部会话日志并逐一修复（应用启动时调用） */
export async function repairAllSessions(
  paths: TraceDirPaths,
  config: TraceConfig,
): Promise<number> {
  if (!config.enabled || config.level === 'off') return 0
  let names: string[]
  try {
    names = await readdir(paths.sessions)
  } catch {
    return 0
  }
  let repaired = 0
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue
    const ok = await repairInterruptedSession(path.join(paths.sessions, name), config)
    if (ok) repaired += 1
  }
  return repaired
}

/** 纯文本解析入口（供测试与外部诊断复用） */
export const parseTraceLogText = parseSessionLog
