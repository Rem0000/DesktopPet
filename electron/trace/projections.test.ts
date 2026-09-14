import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRACE_CONFIG,
  type TraceEvent,
  type TraceEventMap,
  type TraceEventType,
  type TraceHeader,
  type TokenUsage,
} from '../../src/trace/contracts'
import type { TraceDirPaths } from '../projectPaths'
import {
  foldContextPressure,
  foldStats,
  foldTokenUsage,
  foldToolStats,
  foldUsageByTurn,
  summarizeSession,
} from './projections'
import { TraceStore } from './traceStore'

function usage(partial: Partial<TokenUsage>): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    ...partial,
  }
}

function ev<K extends TraceEventType>(
  type: K,
  seq: number,
  turn: number,
  data: TraceEventMap[K],
): TraceEvent {
  return { type, seq, time: 1_000 + seq, turn, data } as TraceEvent
}

const header: TraceHeader = {
  type: 'trace-session',
  version: 1,
  sessionId: 's1',
  packageId: 'pkg',
  createdAt: 900,
  provider: { kind: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  context: { budgetCharacters: 40_000, importanceTrim: true, recentWindowChars: 28_000 },
  tools: [],
  redaction: { level: 'full', maxFieldChars: 4000 },
}

describe('token 用量投影', () => {
  it('只从 model/result 折叠，不重复叠加消息与轮次上的用量', () => {
    const events: TraceEvent[] = [
      ev('model/result', 0, 1, {
        kind: 'plan',
        model: 'deepseek-chat',
        ok: true,
        latencyMs: 40,
        usage: usage({ inputTokens: 100, outputTokens: 10, cacheReadTokens: 50 }),
      }),
      ev('model/result', 1, 1, {
        kind: 'reply',
        model: 'deepseek-chat',
        ok: true,
        latencyMs: 900,
        usage: usage({ inputTokens: 300, outputTokens: 80, cacheReadTokens: 120, reasoningTokens: 20 }),
      }),
      // 同一次回复的用量也出现在消息与轮次聚合上：不得再次累加
      ev('assistant/message', 2, 1, {
        messageId: 'a1',
        content: '答案',
        characters: 2,
        usage: usage({ inputTokens: 300, outputTokens: 80, cacheReadTokens: 120, reasoningTokens: 20 }),
      }),
      ev('turn/end', 3, 1, {
        status: 'completed',
        latencyMs: 1_000,
        usage: usage({ inputTokens: 400, outputTokens: 90, cacheReadTokens: 170, reasoningTokens: 20 }),
        modelCalls: 2,
        toolCalls: 0,
        toolSuccesses: 0,
      }),
    ]

    expect(foldTokenUsage(events)).toEqual({
      inputTokens: 400,
      outputTokens: 90,
      cacheReadTokens: 170,
      cacheWriteTokens: 0,
      reasoningTokens: 20,
    })

    const byTurn = foldUsageByTurn(events)
    expect(byTurn.get(1)?.inputTokens).toBe(400)
  })

  it('估算用量保留 estimated 标记', () => {
    const events = [
      ev('model/result', 0, 1, {
        kind: 'reply',
        model: 'deepseek-chat',
        ok: true,
        latencyMs: 10,
        usage: usage({ inputTokens: 5, outputTokens: 6, estimated: true }),
      }),
    ]
    expect(foldTokenUsage(events).estimated).toBe(true)
  })
})

describe('上下文压力投影', () => {
  it('取最近一次 request/context，并给出 provider 报告的提示规模', () => {
    const events: TraceEvent[] = [
      ev('request/context', 0, 1, {
        budgetCharacters: 40_000,
        usedCharacters: 10_000,
        parts: { systemPrompt: 1_000, systemTools: 2_000, skills: 0, memory: 1_000, messages: 6_000 },
      }),
      ev('request/context', 1, 2, {
        budgetCharacters: 40_000,
        usedCharacters: 20_000,
        parts: { systemPrompt: 1_000, systemTools: 2_000, skills: 500, memory: 1_500, messages: 15_000 },
      }),
      ev('model/result', 2, 2, {
        kind: 'reply',
        model: 'deepseek-chat',
        ok: true,
        latencyMs: 500,
        usage: usage({ inputTokens: 4_000, outputTokens: 200, cacheReadTokens: 1_000, cacheWriteTokens: 0 }),
      }),
    ]
    const projection = foldContextPressure(events)
    expect(projection).toMatchObject({
      budgetCharacters: 40_000,
      usedCharacters: 20_000,
      ratio: 0.5,
      observed: true,
      pressureTokens: 5_000,
    })
    expect(projection.parts.skills).toBe(500)
    expect(projection.updatedAt).toBe(1_001)
  })

  it('无任何组装观测时 observed 为 false', () => {
    expect(foldContextPressure([])).toMatchObject({ observed: false, usedCharacters: 0 })
  })
})

describe('工具与统计投影', () => {
  const toolEvents: TraceEvent[] = [
    ev('tool/result', 0, 1, {
      callId: 'c1',
      name: 'search_knowledge',
      ok: true,
      latencyMs: 10,
    }),
    ev('tool/result', 1, 1, { callId: 'c2', name: 'search_knowledge', ok: true, latencyMs: 20 }),
    ev('tool/result', 2, 1, { callId: 'c3', name: 'search_knowledge', ok: false, latencyMs: 30 }),
    ev('tool/result', 3, 1, { callId: 'c4', name: 'search_knowledge', ok: true, latencyMs: 40 }),
    ev('tool/result', 4, 2, { callId: 'c5', name: 'remember_fact', ok: true, latencyMs: 5 }),
  ]

  it('汇总次数、成功率、平均与 p95 耗时', () => {
    const stats = foldToolStats(toolEvents)
    expect(stats[0]).toEqual({
      toolName: 'search_knowledge',
      calls: 4,
      successes: 3,
      avgLatencyMs: 25,
      p95LatencyMs: 40,
    })
    expect(stats[1]).toMatchObject({ toolName: 'remember_fact', calls: 1, successes: 1 })
  })

  it('会话统计与列表摘要', () => {
    const events: TraceEvent[] = [
      ...toolEvents,
      // 每次调用的计量来源是 model/result；turn/end 上的同值聚合不得再被叠加
      ev('model/result', 5, 1, {
        kind: 'plan',
        model: 'deepseek-chat',
        ok: true,
        latencyMs: 30,
        usage: usage({ inputTokens: 60 }),
      }),
      ev('model/result', 6, 1, {
        kind: 'reply',
        model: 'deepseek-chat',
        ok: true,
        latencyMs: 700,
        usage: usage({ inputTokens: 90 }),
      }),
      ev('turn/end', 7, 1, {
        status: 'completed',
        latencyMs: 1_200,
        usage: usage({ inputTokens: 150 }),
        modelCalls: 2,
        toolCalls: 4,
        toolSuccesses: 3,
      }),
      ev('turn/end', 8, 2, {
        status: 'cancelled',
        latencyMs: 300,
        usage: usage({ inputTokens: 0 }),
        modelCalls: 0,
        toolCalls: 1,
        toolSuccesses: 1,
      }),
    ]
    const stats = foldStats(events)
    expect(stats).toMatchObject({ turns: 2, modelCalls: 2, toolCalls: 5 })
    expect(stats.usage.inputTokens).toBe(150)

    const summary = summarizeSession(header, events)
    expect(summary).toMatchObject({
      sessionId: 's1',
      packageId: 'pkg',
      createdAt: 900,
      turns: 2,
      lastStatus: 'cancelled',
      durationMs: 1_500,
      toolCalls: 5,
      toolSuccesses: 4,
    })
    expect(summary.usage.inputTokens).toBe(150)
    expect(summary.updatedAt).toBe(1_008)
  })

  it('投影不产出任何金额/成本字段（只呈现 token）', () => {
    const payload = JSON.stringify([
      foldTokenUsage(toolEvents),
      foldStats(toolEvents),
      foldContextPressure(toolEvents),
      summarizeSession(header, toolEvents),
    ])
    expect(payload).not.toMatch(/cost|price|pricing|金额|单价|费用/i)
    expect(payload).toContain('inputTokens')
  })
})

describe('TraceStore 投影入口', () => {
  it('从真实日志折叠出会话摘要、统计与上下文压力', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pet-trace-proj-'))
    const paths: TraceDirPaths = {
      root,
      sessions: path.join(root, 'sessions'),
      blobs: path.join(root, 'blobs'),
      legacy: path.join(root, 'legacy'),
    }
    const store = new TraceStore(paths, { ...DEFAULT_TRACE_CONFIG, fsync: 'never' })
    const recorder = await store.beginTurn({
      sessionId: 's-proj',
      packageId: 'pkg',
      turn: 1,
      provider: { kind: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
      context: { budgetCharacters: 40_000, importanceTrim: true, recentWindowChars: 28_000 },
      tools: [],
    })
    if (!recorder) throw new Error('recorder 未创建')
    recorder.turnStart('u1', 'req-1')
    recorder.requestContext({
      budgetCharacters: 40_000,
      parts: { systemPrompt: 100, systemTools: 200, skills: 0, memory: 300, messages: 400 },
    })
    recorder.modelResult({
      kind: 'reply',
      model: 'deepseek-chat',
      ok: true,
      latencyMs: 500,
      usage: usage({ inputTokens: 1_000, outputTokens: 100, cacheReadTokens: 400, reasoningTokens: 30 }),
    })
    recorder.toolResult({
      callId: 'c1',
      name: 'search_knowledge',
      ok: true,
      latencyMs: 12,
      hitCount: 2,
    })
    recorder.turnEnd({ status: 'completed', latencyMs: 800 })
    await store.flush('s-proj')

    const summary = await store.summarizeSession('s-proj')
    expect(summary).toMatchObject({
      sessionId: 's-proj',
      turns: 1,
      lastStatus: 'completed',
      durationMs: 800,
      toolCalls: 1,
      toolSuccesses: 1,
    })
    expect(summary?.usage).toMatchObject({
      inputTokens: 1_000,
      outputTokens: 100,
      cacheReadTokens: 400,
      reasoningTokens: 30,
    })

    const sessions = await store.listSessions()
    expect(sessions.map((item) => item.sessionId)).toEqual(['s-proj'])

    const stats = await store.stats('s-proj')
    expect(stats).toMatchObject({ turns: 1, modelCalls: 1, toolCalls: 1 })

    const projection = await store.contextPressure('s-proj')
    expect(projection).toMatchObject({
      observed: true,
      usedCharacters: 1_000,
      pressureTokens: 1_400,
    })
  })
})
