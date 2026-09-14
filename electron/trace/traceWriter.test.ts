import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRACE_CONFIG,
  TRACE_FORMAT_VERSION,
  type TraceConfig,
  type TraceHeader,
  type TraceTextField,
} from '../../src/trace/contracts'
import type { TraceDirPaths } from '../projectPaths'
import { shapeText } from './traceFields'
import { parseSessionLog } from './traceReader'
import { TraceStore } from './traceStore'
import { repairInterruptedSession, TraceSessionWriter } from './traceWriter'

async function tempPaths(): Promise<TraceDirPaths> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pet-trace-'))
  return {
    root,
    sessions: path.join(root, 'sessions'),
    blobs: path.join(root, 'blobs'),
    legacy: path.join(root, 'legacy'),
  }
}

function headerFacts(sessionId = 's1'): Omit<TraceHeader, 'type' | 'version'> {
  return {
    sessionId,
    packageId: 'pkg',
    createdAt: 1_700_000_000_000,
    provider: { kind: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
    context: { budgetCharacters: 40_000, importanceTrim: true, recentWindowChars: 28_000 },
    tools: [{ name: 'search_knowledge', enabled: true, riskLevel: 'safe' }],
    redaction: { level: 'full', maxFieldChars: 4000 },
  }
}

const config: TraceConfig = { ...DEFAULT_TRACE_CONFIG }

async function openWriter(
  paths: TraceDirPaths,
  sessionId = 's1',
  overrides: Partial<TraceConfig> = {},
): Promise<TraceSessionWriter> {
  const writer = new TraceSessionWriter(sessionId, paths, { ...config, ...overrides })
  await writer.open(headerFacts(sessionId))
  return writer
}

describe('TraceSessionWriter', () => {
  it('写入 header 与事件，seq 稠密递增', async () => {
    const paths = await tempPaths()
    const writer = await openWriter(paths)
    writer.append({ type: 'turn/start', turn: 1, data: {} })
    writer.append({
      type: 'user/message',
      turn: 1,
      data: { messageId: 'm1', content: '你好', characters: 2 },
    })
    writer.append({
      type: 'step/start',
      turn: 1,
      data: { node: 'recall' },
    })
    await writer.flush()

    const raw = await readFile(writer.logPath, 'utf8')
    const lines = raw.trim().split('\n')
    expect(JSON.parse(lines[0]!)).toMatchObject({
      type: 'trace-session',
      version: TRACE_FORMAT_VERSION,
      sessionId: 's1',
    })
    const scanned = parseSessionLog(raw)
    expect(scanned.events.map((event) => event.seq)).toEqual([0, 1, 2])
    expect(scanned.events.map((event) => event.type)).toEqual([
      'turn/start',
      'user/message',
      'step/start',
    ])
    expect(scanned.issues).toEqual([])
  })

  it('重新打开同一会话时 seq 从已有日志继续', async () => {
    const paths = await tempPaths()
    const first = await openWriter(paths)
    first.append({ type: 'turn/start', turn: 1, data: {} })
    first.append({ type: 'turn/end', turn: 1, data: { status: 'completed', latencyMs: 5, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }, modelCalls: 1, toolCalls: 0, toolSuccesses: 0 } })
    await first.flush()

    const second = await openWriter(paths)
    second.append({ type: 'turn/start', turn: 2, data: {} })
    await second.flush()

    const raw = await readFile(second.logPath, 'utf8')
    const scanned = parseSessionLog(raw)
    expect(scanned.events.map((event) => event.seq)).toEqual([0, 1, 2])
    expect(scanned.events.map((event) => event.turn)).toEqual([1, 1, 2])
    // header 只有一行，不被重写
    expect(raw.split('\n').filter((line) => line.includes('"trace-session"'))).toHaveLength(1)
  })

  it('超过单字段上限时外置原文到 blobs/ 且事件内不内联原文', async () => {
    const paths = await tempPaths()
    const writer = await openWriter(paths, 's1', { maxFieldChars: 50 })
    const long = 'A'.repeat(400)
    const shaped = shapeText(long, {
      level: 'full',
      maxFieldChars: 50,
      onBlob: (ref, text) => writer.addBlob(ref, text),
    })
    expect(typeof shaped).not.toBe('string')
    const field = shaped as TraceTextField
    expect(field.blobRef).toBeDefined()
    expect(field.characters).toBe(400)
    expect(field.preview.endsWith('…')).toBe(true)

    writer.append({
      type: 'tool/result',
      turn: 1,
      data: { callId: 'c1', name: 'search_knowledge', ok: true, latencyMs: 3, output: field },
    })
    await writer.flush()

    const blob = await readFile(path.join(paths.blobs, field.blobRef!), 'utf8')
    expect(blob).toBe(long)
    const raw = await readFile(writer.logPath, 'utf8')
    expect(raw).not.toContain(long)
    expect(raw).toContain(field.blobRef!)
  })

  it('meta 档只落摘要，不外置原文', async () => {
    const paths = await tempPaths()
    const writer = await openWriter(paths, 's1', { level: 'meta', maxFieldChars: 50 })
    const long = `SECRET-TAIL-${'B'.repeat(300)}`
    const shaped = shapeText(long, {
      level: 'meta',
      maxFieldChars: 50,
      onBlob: (ref, text) => writer.addBlob(ref, text),
    })
    const field = shaped as TraceTextField
    expect(field.blobRef).toBeUndefined()
    writer.append({
      type: 'tool/result',
      turn: 1,
      data: { callId: 'c1', name: 'web_fetch', ok: true, latencyMs: 3, output: field },
    })
    await writer.flush()

    const raw = await readFile(writer.logPath, 'utf8')
    expect(raw).not.toContain('SECRET-TAIL')
    await expect(readdir(paths.blobs)).resolves.toEqual([])
  })

  it('落盘前遮罩疑似密钥，明文不入日志', async () => {
    const paths = await tempPaths()
    const writer = await openWriter(paths)
    const shaped = shapeText(
      JSON.stringify({ apiKey: 'sk-abcdefghijklmnop', query: '正常查询' }),
      { level: 'full', maxFieldChars: 4000 },
    )
    writer.append({
      type: 'tool/call',
      turn: 1,
      data: { callId: 'c1', name: 'web_fetch', riskLevel: 'confirm', args: shaped },
    })
    await writer.flush()

    const raw = await readFile(writer.logPath, 'utf8')
    expect(raw).not.toContain('sk-abcdefghijklmnop')
    expect(raw).toContain('[REDACTED]')
  })

  it('写入通道不可用时 append 不抛、flush 可等待、诊断记录错误', async () => {
    const paths = await tempPaths()
    const blocked = path.join(paths.root, 'blocked-file')
    await writeFile(blocked, 'not a directory', 'utf8')
    const writer = new TraceSessionWriter(
      's1',
      { ...paths, sessions: blocked },
      config,
    )
    await writer.open(headerFacts('s1'))
    expect(() => writer.append({ type: 'turn/start', turn: 1, data: {} })).not.toThrow()
    await expect(writer.flush()).resolves.toBeUndefined()
    expect(writer.getDiagnostics().lastError).toBeTruthy()
  })
})

describe('repairInterruptedSession', () => {
  it('为停在轮次中间的日志追加合成收尾，历史事件不变', async () => {
    const paths = await tempPaths()
    const writer = await openWriter(paths)
    writer.append({ type: 'turn/start', turn: 1, data: {} })
    writer.append({ type: 'step/start', turn: 1, data: { node: 'toolBoundary' } })
    writer.append({
      type: 'tool/call',
      turn: 1,
      data: { callId: 'c1', name: 'forget_memory', riskLevel: 'confirm', args: '{}' },
    })
    writer.append({
      type: 'model/result',
      turn: 1,
      data: {
        kind: 'reply',
        model: 'deepseek-chat',
        ok: true,
        latencyMs: 120,
        usage: {
          inputTokens: 10,
          outputTokens: 4,
          cacheReadTokens: 2,
          cacheWriteTokens: 0,
          reasoningTokens: 1,
        },
      },
    })
    await writer.flush()
    const before = parseSessionLog(await readFile(writer.logPath, 'utf8'))
    expect(before.events).toHaveLength(4)

    const repaired = await repairInterruptedSession(writer.logPath, config)
    expect(repaired).toBe(true)

    const after = parseSessionLog(await readFile(writer.logPath, 'utf8'))
    // 历史事件逐条保持不变
    expect(after.events.slice(0, 4)).toEqual(before.events)
    const closers = after.events.slice(4)
    expect(closers.map((event) => event.type)).toEqual([
      'tool/result',
      'step/end',
      'turn/end',
    ])
    expect(closers[0]).toMatchObject({
      data: { callId: 'c1', ok: false, errorCode: 'interrupted_outcome_unknown' },
    })
    expect(closers[2]).toMatchObject({
      data: {
        status: 'interrupted',
        modelCalls: 1,
        toolCalls: 1,
        usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 2, reasoningTokens: 1 },
      },
    })
    // 收尾后 seq 依旧稠密
    expect(after.events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('已正常收尾的轮次不被修改', async () => {
    const paths = await tempPaths()
    const writer = await openWriter(paths)
    writer.append({ type: 'turn/start', turn: 1, data: {} })
    writer.append({
      type: 'turn/end',
      turn: 1,
      data: {
        status: 'completed',
        latencyMs: 10,
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
        },
        modelCalls: 1,
        toolCalls: 0,
        toolSuccesses: 0,
      },
    })
    await writer.flush()
    const before = await readFile(writer.logPath, 'utf8')

    expect(await repairInterruptedSession(writer.logPath, config)).toBe(false)
    expect(await readFile(writer.logPath, 'utf8')).toBe(before)
  })

  it('进程被强杀（尾部残行）时修复残行并补中断终态，摘要显示已中断', async () => {
    const paths = await tempPaths()
    const store = new TraceStore(paths, config)
    const writer = await openWriter(paths)
    writer.append({ type: 'turn/start', turn: 1, data: {} })
    writer.append({ type: 'step/start', turn: 1, data: { node: 'model' } })
    writer.append({
      type: 'tool/call',
      turn: 1,
      data: { callId: 'c-kill', name: 'search_knowledge', riskLevel: 'safe', args: '{}' },
    })
    await writer.flush()

    // 模拟被强杀时正在写一半的行（无换行结尾）
    const { appendFile } = await import('node:fs/promises')
    await appendFile(writer.logPath, '{"type":"tool/result","seq":3,"time":123,"turn":1,"dat', 'utf8')

    // 读取侧忽略残行（不报损坏），修复侧追加合成收尾
    const scanned = parseSessionLog(await readFile(writer.logPath, 'utf8'))
    expect(scanned.events).toHaveLength(3)
    expect(scanned.issues).not.toContainEqual(expect.objectContaining({ reason: 'corrupt' }))

    expect(await repairInterruptedSession(writer.logPath, config)).toBe(true)
    const after = parseSessionLog(await readFile(writer.logPath, 'utf8'))
    expect(after.events.map((event) => event.type).slice(-3)).toEqual([
      'tool/result',
      'step/end',
      'turn/end',
    ])
    const summary = await store.summarizeSession('s1')
    expect(summary).toMatchObject({ turns: 1, lastStatus: 'interrupted' })
  })
})

describe('TraceStore 实时推送', () => {
  it('提交事件时回调订阅者（追踪台 live），订阅者异常不影响写入', async () => {
    const paths = await tempPaths()
    const seen: Array<{ sessionId: string; type: string; seq: number }> = []
    const store = new TraceStore(paths, config, (sessionId, event) => {
      seen.push({ sessionId, type: event.type, seq: event.seq })
      if (seen.length === 1) throw new Error('订阅者异常')
    })
    const recorder = await store.beginTurn({
      sessionId: 's-live',
      packageId: 'pkg',
      turn: 1,
      provider: { kind: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
      context: { budgetCharacters: 40_000, importanceTrim: true, recentWindowChars: 28_000 },
      tools: [],
    })
    if (!recorder) throw new Error('recorder 未创建')
    recorder.turnStart('u1', 'req-live')
    recorder.turnEnd({ status: 'completed', latencyMs: 5 })
    await store.flush('s-live')

    expect(seen).toEqual([
      { sessionId: 's-live', type: 'turn/start', seq: 0 },
      { sessionId: 's-live', type: 'turn/end', seq: 1 },
    ])
    // 订阅者抛错不影响落盘
    const raw = await readFile(store.logPathFor('s-live'), 'utf8')
    expect(parseSessionLog(raw).events).toHaveLength(2)
  })
})
