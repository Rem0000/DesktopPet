import { readFile } from 'node:fs/promises'
import {
  TRACE_FORMAT_VERSION,
  type TraceEvent,
  type TraceEventType,
  type TraceHeader,
  type TraceReadIssue,
  type TraceReadOptions,
  type TraceReadResult,
} from '../../src/trace/contracts'

/** 日志版本不受当前实现支持（提示升级，而非判定损坏） */
export class TraceFormatUnsupportedError extends Error {
  constructor(readonly version: number) {
    super(`链路日志格式版本 ${version} 高于当前支持的 ${TRACE_FORMAT_VERSION}，请升级应用`)
    this.name = 'TraceFormatUnsupportedError'
  }
}

export type ScannedLog = {
  header: TraceHeader | null
  events: TraceEvent[]
  issues: TraceReadIssue[]
  /** 最后一个完整行之后的字节偏移：可安全截断/追加的位置 */
  committedBytes: number
  /** 最后一个已提交事件的 seq；无事件时为 -1 */
  lastSeq: number
  /** 尾部存在无换行的残行（崩溃/中断写入） */
  truncatedTail: boolean
  /** header 版本不受支持时的版本号 */
  unsupportedVersion?: number
}

const KNOWN_TYPES = new Set<string>([
  'turn/start',
  'turn/end',
  'user/message',
  'assistant/message',
  'step/start',
  'step/end',
  'request/header',
  'request/context',
  'model/call',
  'model/result',
  'plan/result',
  'tool/call',
  'tool/confirm',
  'tool/result',
  'retrieval/hits',
  'skill/route',
  'error',
])

function isHeader(value: unknown): value is TraceHeader {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<TraceHeader>
  return (
    candidate.type === 'trace-session' &&
    typeof candidate.version === 'number' &&
    typeof candidate.sessionId === 'string' &&
    typeof candidate.createdAt === 'number'
  )
}

function isEventShape(value: unknown): value is TraceEvent {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<TraceEvent> & Record<string, unknown>
  return (
    typeof candidate.type === 'string' &&
    typeof candidate.seq === 'number' &&
    Number.isSafeInteger(candidate.seq) &&
    typeof candidate.time === 'number' &&
    typeof candidate.turn === 'number' &&
    !!candidate.data &&
    typeof candidate.data === 'object'
  )
}

/**
 * 解析整份日志文本。只认完整换行行：尾部无换行的残行被忽略（崩溃写入），
 * 已提交区内出现 seq 空洞或不可解析事件即判定损坏并保留此前的完整前缀。
 */
export function parseSessionLog(text: string): ScannedLog {
  const issues: TraceReadIssue[] = []
  const lines = text.split('\n')
  let header: TraceHeader | null = null
  let committedBytes = 0
  let offset = 0
  let expectedSeq = 0
  const events: TraceEvent[] = []
  let corrupt = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const isLast = index === lines.length - 1
    // 最后一段没有换行符 → 残行，不计入 committedBytes
    if (isLast && line === '') break
    const lineBytes = Buffer.byteLength(line, 'utf8') + 1
    if (isLast) break // 无换行结尾：视为残行
    if (line.trim() === '') {
      offset += lineBytes
      committedBytes = offset
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      issues.push({ line: index + 1, reason: 'unparsable' })
      corrupt = true
      break
    }

    if (index === 0) {
      if (!isHeader(parsed)) {
        issues.push({ line: 1, reason: 'corrupt', detail: 'first line is not a session header' })
        corrupt = true
        break
      }
      header = parsed
      if (header.version !== TRACE_FORMAT_VERSION) {
        return {
          header,
          events: [],
          issues,
          committedBytes: Buffer.byteLength(line, 'utf8') + 1,
          lastSeq: -1,
          truncatedTail: false,
          unsupportedVersion: header.version,
        }
      }
      offset += lineBytes
      committedBytes = offset
      continue
    }

    if (!isEventShape(parsed)) {
      issues.push({ line: index + 1, reason: 'unparsable', detail: 'event shape invalid' })
      corrupt = true
      break
    }
    if (!KNOWN_TYPES.has(parsed.type)) {
      if (parsed.ignorable === true) {
        // 前向兼容：跳过未知类型（不占 seq 校验位，因为未知事件可能不参与本地序列）
        issues.push({ line: index + 1, reason: 'unknown-type', detail: parsed.type })
        offset += lineBytes
        committedBytes = offset
        continue
      }
      issues.push({
        line: index + 1,
        reason: 'unknown-type',
        detail: `${parsed.type} (missing ignorable marker)`,
      })
      corrupt = true
      break
    }
    if (parsed.seq !== expectedSeq) {
      issues.push({
        line: index + 1,
        reason: 'corrupt',
        detail: `seq gap: expected ${expectedSeq}, got ${parsed.seq}`,
      })
      corrupt = true
      break
    }

    events.push(parsed as TraceEvent)
    expectedSeq = parsed.seq + 1
    offset += lineBytes
    committedBytes = offset
  }

  const consumedAll = !corrupt && committedBytes >= Buffer.byteLength(text, 'utf8')
  return {
    header,
    events,
    issues,
    committedBytes,
    lastSeq: events.length > 0 ? events[events.length - 1]!.seq : -1,
    truncatedTail: !consumedAll && text.length > 0,
  }
}

/** 读取并解析日志文件；文件不存在时返回空扫描结果（不抛） */
export async function scanSessionLog(filePath: string): Promise<ScannedLog> {
  let text: string
  try {
    text = await readFile(filePath, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return {
        header: null,
        events: [],
        issues: [],
        committedBytes: 0,
        lastSeq: -1,
        truncatedTail: false,
      }
    }
    throw error
  }
  return parseSessionLog(text)
}

/** 按分页/轮次/类型过滤读取事件 */
export function paginateEvents(
  scanned: ScannedLog,
  options: TraceReadOptions = {},
): TraceReadResult {
  const turns = options.turns && options.turns.length > 0 ? new Set(options.turns) : null
  const types =
    options.types && options.types.length > 0
      ? new Set<TraceEventType>(options.types)
      : null
  const filtered = scanned.events.filter(
    (event) =>
      (!turns || turns.has(event.turn)) && (!types || types.has(event.type)),
  )
  const offset = Math.max(0, Math.floor(options.offset ?? 0))
  const limit = Math.max(1, Math.floor(options.limit ?? 500))
  const page = filtered.slice(offset, offset + limit)
  const nextOffset = offset + limit < filtered.length ? offset + limit : null
  return {
    header: scanned.header,
    events: page,
    total: filtered.length,
    nextOffset,
    issues: scanned.issues,
  }
}
