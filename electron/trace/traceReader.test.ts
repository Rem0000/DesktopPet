import { describe, expect, it } from 'vitest'
import { TRACE_FORMAT_VERSION, type TraceEvent, type TraceHeader } from '../../src/trace/contracts'
import { paginateEvents, parseSessionLog } from './traceReader'

const header: TraceHeader = {
  type: 'trace-session',
  version: TRACE_FORMAT_VERSION,
  sessionId: 's1',
  packageId: 'pkg',
  createdAt: 1_700_000_000_000,
  provider: { kind: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  context: { budgetCharacters: 40_000, importanceTrim: true, recentWindowChars: 28_000 },
  tools: [{ name: 'search_knowledge', enabled: true, riskLevel: 'safe' }],
  redaction: { level: 'full', maxFieldChars: 4000 },
}

function event(seq: number, overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    type: 'step/start',
    seq,
    time: 1_700_000_000_000 + seq,
    turn: 1,
    data: { node: 'recall' },
    ...overrides,
  } as TraceEvent
}

function logText(events: TraceEvent[], headerLine: unknown = header): string {
  return `${JSON.stringify(headerLine)}\n${events.map((item) => JSON.stringify(item)).join('\n')}\n`
}

describe('parseSessionLog', () => {
  it('解析 header 与事件并给出 lastSeq', () => {
    const scanned = parseSessionLog(logText([event(0), event(1)]))
    expect(scanned.header?.sessionId).toBe('s1')
    expect(scanned.events).toHaveLength(2)
    expect(scanned.lastSeq).toBe(1)
    expect(scanned.issues).toEqual([])
    expect(scanned.truncatedTail).toBe(false)
  })

  it('忽略无换行的尾部残行且给出可安全截断偏移', () => {
    const complete = logText([event(0)])
    const torn = `${complete}{"type":"step/start","seq":1,"time":1,`
    const scanned = parseSessionLog(torn)
    expect(scanned.events).toHaveLength(1)
    expect(scanned.truncatedTail).toBe(true)
    expect(scanned.committedBytes).toBe(Buffer.byteLength(complete, 'utf8'))
  })

  it('seq 空洞判定为损坏并保留此前前缀', () => {
    const scanned = parseSessionLog(logText([event(0), event(2)]))
    expect(scanned.events).toHaveLength(1)
    expect(scanned.issues[0]).toMatchObject({ reason: 'corrupt' })
    expect(scanned.issues[0]?.detail).toContain('seq gap')
  })

  it('带 ignorable 的未知事件被跳过，未带标记则停止读取', () => {
    const withMarker = `${JSON.stringify(header)}\n${JSON.stringify({
      type: 'future/event',
      seq: 0,
      time: 1,
      turn: 1,
      ignorable: true,
      data: {},
    })}\n${JSON.stringify(event(0))}\n`
    const skipped = parseSessionLog(withMarker)
    expect(skipped.events).toHaveLength(1)
    expect(skipped.issues[0]).toMatchObject({ reason: 'unknown-type' })

    const withoutMarker = `${JSON.stringify(header)}\n${JSON.stringify({
      type: 'future/event',
      seq: 0,
      time: 1,
      turn: 1,
      data: {},
    })}\n${JSON.stringify(event(0))}\n`
    const blocked = parseSessionLog(withoutMarker)
    expect(blocked.events).toHaveLength(0)
    expect(blocked.issues[0]?.detail).toContain('missing ignorable marker')
  })

  it('首行不是 header 时判定损坏', () => {
    const scanned = parseSessionLog(logText([event(0)], { type: 'something-else' }))
    expect(scanned.header).toBeNull()
    expect(scanned.issues[0]).toMatchObject({ line: 1, reason: 'corrupt' })
  })

  it('格式版本不受支持时明确标记（而非判定损坏）', () => {
    const scanned = parseSessionLog(logText([event(0)], { ...header, version: 99 }))
    expect(scanned.unsupportedVersion).toBe(99)
    expect(scanned.events).toEqual([])
    expect(scanned.issues).toEqual([])
  })

  it('不可解析事件行不导致整体失败', () => {
    const text = `${JSON.stringify(header)}\n${JSON.stringify(event(0))}\n{broken\n`
    const scanned = parseSessionLog(text)
    expect(scanned.events).toHaveLength(1)
    expect(scanned.issues[0]).toMatchObject({ line: 3, reason: 'unparsable' })
  })
})

describe('paginateEvents', () => {
  const events: TraceEvent[] = [
    event(0, { turn: 1, type: 'user/message', data: { messageId: 'm1', content: 'hi', characters: 2 } }),
    event(1, { turn: 1 }),
    event(2, { turn: 2, type: 'tool/result', data: { callId: 'c1', name: 'search_knowledge', ok: true, latencyMs: 12 } }),
  ]

  it('按轮次与类型过滤并分页', () => {
    const scanned = parseSessionLog(logText(events))
    const page1 = paginateEvents(scanned, { offset: 0, limit: 2 })
    expect(page1.total).toBe(3)
    expect(page1.events).toHaveLength(2)
    expect(page1.nextOffset).toBe(2)

    const page2 = paginateEvents(scanned, { offset: 2, limit: 2 })
    expect(page2.events).toHaveLength(1)
    expect(page2.nextOffset).toBeNull()

    const byTurn = paginateEvents(scanned, { turns: [2] })
    expect(byTurn.total).toBe(1)
    expect(byTurn.events[0]?.type).toBe('tool/result')

    const byType = paginateEvents(scanned, { types: ['user/message'] })
    expect(byType.total).toBe(1)
    expect(byType.events[0]?.type).toBe('user/message')
  })
})
