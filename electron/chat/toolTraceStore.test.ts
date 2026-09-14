import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TRACE_CONFIG } from '../../src/trace/contracts'
import type { TraceDirPaths } from '../projectPaths'
import { TraceStore } from '../trace/traceStore'
import { classifyToolError, redactSensitive, summarizeToolInput } from './redact'
import { ToolTraceStore } from './toolTraceStore'

describe('redact', () => {
  it('遮罩疑似密钥并截断过长文本', () => {
    expect(redactSensitive('my api_key is sk-abcdefghijklmnop')).toContain('[REDACTED]')
    expect(redactSensitive('a'.repeat(300), 40).endsWith('…')).toBe(true)
  })

  it('汇总工具入参时脱敏', () => {
    expect(summarizeToolInput({ token: 'secret-value', note: 'ok' })).toContain('[REDACTED]')
  })

  it('归类工具错误码', () => {
    expect(classifyToolError(new Error('工具不存在：x')).errorCode).toBe('not_found')
    expect(classifyToolError(new Error('需要 content')).errorCode).toBe('validation')
    expect(classifyToolError(new Error('拒绝写入敏感')).errorCode).toBe('rejected')
  })
})

describe('ToolTraceStore', () => {
  it('落盘 JSONL 并按会话查询与汇总', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'pet-traces-'))
    const store = new ToolTraceStore(dir)
    await store.initialize()
    await store.append({
      requestId: 'r1',
      sessionId: 's1',
      toolName: 'remember_fact',
      startedAt: '2026-07-27T10:00:00.000Z',
      endedAt: '2026-07-27T10:00:00.050Z',
      ok: true,
      latencyMs: 50,
      inputSummary: '{"content":"喜欢猫"}',
    })
    await store.append({
      requestId: 'r2',
      sessionId: 's1',
      toolName: 'remember_fact',
      startedAt: '2026-07-27T10:01:00.000Z',
      endedAt: '2026-07-27T10:01:00.080Z',
      ok: false,
      errorCode: 'validation',
      latencyMs: 80,
    })
    await store.append({
      requestId: 'r3',
      sessionId: 's2',
      toolName: 'schedule_reminder',
      startedAt: '2026-07-27T10:02:00.000Z',
      endedAt: '2026-07-27T10:02:00.020Z',
      ok: true,
      latencyMs: 20,
    })

    const bySession = await store.listBySession('s1')
    expect(bySession).toHaveLength(2)

    const stats = await store.summarize()
    const remember = stats.find((item) => item.toolName === 'remember_fact')
    expect(remember).toMatchObject({ calls: 2, successes: 1, avgLatencyMs: 65 })

    const filePath = path.join(dir, '2026-07-27.jsonl')
    const raw = await readFile(filePath, 'utf8')
    expect(raw.trim().split('\n')).toHaveLength(3)
  })
})

async function tracePaths(): Promise<TraceDirPaths> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pet-traces-proj-'))
  return {
    root,
    sessions: path.join(root, 'sessions'),
    blobs: path.join(root, 'blobs'),
    legacy: path.join(root, 'legacy'),
  }
}

/** 用真实记录器写出一轮含工具调用的链路，作为投影来源 */
async function seedTraceLog(paths: TraceDirPaths): Promise<TraceStore> {
  const log = new TraceStore(paths, { ...DEFAULT_TRACE_CONFIG, fsync: 'never' })
  const recorder = await log.beginTurn({
    sessionId: 's1',
    packageId: 'pkg',
    turn: 1,
    provider: { kind: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
    context: { budgetCharacters: 40_000, importanceTrim: true, recentWindowChars: 28_000 },
    tools: [],
  })
  if (!recorder) throw new Error('recorder 未创建')
  recorder.turnStart('user-1', 'req-1')
  recorder.toolCall({
    callId: 'c1',
    name: 'search_knowledge',
    riskLevel: 'safe',
    args: { query: '并发编程' },
  })
  recorder.toolResult({
    callId: 'c1',
    name: 'search_knowledge',
    ok: true,
    latencyMs: 12,
    output: {
      hits: [
        {
          documentId: 'd1',
          chunkId: 'k1',
          title: '面试要点',
          sourceName: 'kb.md',
          excerpt: '真实片段',
          score: 0.9,
        },
      ],
    },
  })
  recorder.assistantMessage({ messageId: 'a1', content: '答案' })
  recorder.turnEnd({ status: 'completed', latencyMs: 30 })
  await log.flush('s1')
  return log
}

describe('ToolTraceStore 链路投影', () => {
  it('从链路事件折叠出与旧格式等价的工具记录（含真实入参摘要与引用）', async () => {
    const paths = await tracePaths()
    const log = await seedTraceLog(paths)
    const store = new ToolTraceStore(paths.root, log)
    await store.initialize()

    const records = await store.listBySession('s1')
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      requestId: 'req-1',
      sessionId: 's1',
      messageId: 'a1',
      toolName: 'search_knowledge',
      ok: true,
      latencyMs: 12,
    })
    expect(records[0]!.inputSummary).toContain('并发编程')
    expect(records[0]!.citations?.[0]).toMatchObject({
      documentId: 'd1',
      chunkId: 'k1',
      excerpt: '真实片段',
    })
    // startedAt 由结束时刻按耗时回推
    expect(
      Date.parse(records[0]!.endedAt) - Date.parse(records[0]!.startedAt),
    ).toBe(12)

    const stats = await store.summarize()
    expect(stats[0]).toMatchObject({
      toolName: 'search_knowledge',
      calls: 1,
      successes: 1,
      avgLatencyMs: 12,
    })
  })

  it('旧日报迁移到 legacy/ 后仍可读取（双读过渡）', async () => {
    const paths = await tracePaths()
    const store = new ToolTraceStore(paths.root)
    await store.initialize()
    await store.append({
      requestId: 'legacy-req',
      sessionId: 's-legacy',
      toolName: 'remember_fact',
      startedAt: '2026-07-27T10:00:00.000Z',
      endedAt: '2026-07-27T10:00:00.050Z',
      ok: true,
      latencyMs: 50,
      inputSummary: '{"content":"喜欢猫"}',
    })

    const moved = await store.migrateLegacyDayFiles()
    expect(moved).toBe(1)
    expect(await readdir(paths.legacy)).toEqual(['2026-07-27.jsonl'])

    const records = await store.listBySession('s-legacy')
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ requestId: 'legacy-req', ok: true })

    const stats = await store.summarize()
    expect(stats.find((item) => item.toolName === 'remember_fact')).toMatchObject({
      calls: 1,
      successes: 1,
    })
  })

  it('没有链路来源时投影为空且不抛', async () => {
    const paths = await tracePaths()
    const store = new ToolTraceStore(paths.root)
    await store.initialize()
    await expect(store.listBySession('missing')).resolves.toEqual([])
    await expect(store.summarize()).resolves.toEqual([])
  })
})
