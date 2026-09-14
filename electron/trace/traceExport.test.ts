import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRACE_CONFIG,
  type TokenUsage,
  type TraceEvent,
  type TraceHeader,
  type TraceSessionSummary,
} from '../../src/trace/contracts'
import {
  exportSessionToJson,
  exportSessionToMarkdown,
  redactForExport,
} from './traceExport'

function usage(partial: Partial<TokenUsage> = {}): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    ...partial,
  }
}

const header: TraceHeader = {
  type: 'trace-session',
  version: 1,
  sessionId: 'abcdefgh-1111',
  packageId: 'pkg',
  createdAt: 1_700_000_000_000,
  provider: { kind: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  context: { budgetCharacters: 40_000, importanceTrim: true, recentWindowChars: 28_000 },
  tools: [],
  redaction: { level: 'full', maxFieldChars: 4000 },
}

const summary: TraceSessionSummary = {
  sessionId: header.sessionId,
  packageId: 'pkg',
  createdAt: header.createdAt,
  updatedAt: header.createdAt + 5_000,
  turns: 1,
  lastStatus: 'completed',
  usage: usage({ inputTokens: 1_300, outputTokens: 140, cacheReadTokens: 400, reasoningTokens: 30 }),
  toolCalls: 1,
  toolSuccesses: 1,
  durationMs: 1_500,
}

const events: TraceEvent[] = [
  {
    type: 'user/message',
    seq: 0,
    time: header.createdAt + 1_000,
    turn: 1,
    data: { messageId: 'u1', content: '并发编程怎么学（密钥 sk-abcdefghijklmnop 泄漏测试）', characters: 30 },
  },
  {
    type: 'step/end',
    seq: 1,
    time: header.createdAt + 1_100,
    turn: 1,
    data: { node: 'recall', latencyMs: 12 },
  },
  {
    type: 'model/result',
    seq: 2,
    time: header.createdAt + 2_000,
    turn: 1,
    data: {
      kind: 'reply',
      model: 'deepseek-chat',
      ok: true,
      latencyMs: 900,
      ttftMs: 320,
      finishReason: 'stop',
      usage: usage({ inputTokens: 1_000, outputTokens: 120, cacheReadTokens: 400, reasoningTokens: 30 }),
    },
  },
  {
    type: 'tool/call',
    seq: 3,
    time: header.createdAt + 2_100,
    turn: 1,
    data: {
      callId: 'c1',
      name: 'search_knowledge',
      riskLevel: 'safe',
      args: '{"query":"并发编程","apiKey":"sk-abcdefghijklmnop"}',
    },
  },
  {
    type: 'tool/result',
    seq: 4,
    time: header.createdAt + 2_140,
    turn: 1,
    data: {
      callId: 'c1',
      name: 'search_knowledge',
      ok: true,
      latencyMs: 36,
      output: '{"hits":[{"id":"k1","score":0.9}]}',
    },
  },
  {
    type: 'assistant/message',
    seq: 5,
    time: header.createdAt + 3_000,
    turn: 1,
    data: { messageId: 'a1', content: '先看 JMM 与 happens-before', characters: 18 },
  },
  {
    type: 'turn/end',
    seq: 6,
    time: header.createdAt + 4_000,
    turn: 1,
    data: {
      status: 'completed',
      latencyMs: 1_500,
      usage: usage({ inputTokens: 1_300, outputTokens: 140 }),
      modelCalls: 1,
      toolCalls: 1,
      toolSuccesses: 1,
    },
  },
]

describe('链路导出', () => {
  it('Markdown 报告含轮次、模型与工具详情及 token 汇总，且不出现金额字段', () => {
    const markdown = exportSessionToMarkdown({ header, events, summary })
    expect(markdown).toContain('# 链路追踪报告')
    expect(markdown).toContain('## 第 1 轮 · completed · 1500ms')
    expect(markdown).toContain('| reply | deepseek-chat | 900ms | 320ms |')
    expect(markdown).toContain('in 1000 / out 120 / cache-r 400 / reasoning 30')
    expect(markdown).toContain('### 工具 · search_knowledge')
    expect(markdown).toContain('结果：成功 · 36ms')
    expect(markdown).toContain('| recall | 12ms |')
    expect(markdown).toMatch(/token 用量：未缓存输入 1300/)
    expect(markdown).not.toMatch(/cost|price|金额|单价|费用/i)
  })

  it('导出副本再次遮罩密钥', () => {
    const markdown = exportSessionToMarkdown({ header, events, summary })
    expect(markdown).not.toContain('sk-abcdefghijklmnop')
    expect(markdown).toContain('[REDACTED]')

    const json = exportSessionToJson({ header, events, summary })
    expect(json).not.toContain('sk-abcdefghijklmnop')
    const parsed = JSON.parse(json) as {
      header: TraceHeader
      summary: TraceSessionSummary
      events: TraceEvent[]
    }
    expect(parsed.events).toHaveLength(events.length)
    expect(parsed.summary.usage.inputTokens).toBe(1_300)
    expect(JSON.stringify(parsed)).not.toMatch(/cost|price|金额|单价/i)
  })

  it('redactForExport 递归遮罩且不破坏结构', () => {
    const input = { a: ['x sk-abcdefghijklmnop', { b: 'token=secret-value' }], n: 3, t: true }
    const output = redactForExport(input) as typeof input
    expect(output.n).toBe(3)
    expect(output.t).toBe(true)
    expect(String(output.a[0])).toContain('[REDACTED]')
    expect(JSON.stringify(output)).not.toContain('sk-abcdefghijklmnop')
  })
})

describe('导出读取真实日志', () => {
  it('从磁盘日志导出 Markdown（TraceStore.exportSession）', async () => {
    const { TraceStore } = await import('./traceStore')
    const root = await mkdtemp(path.join(os.tmpdir(), 'pet-trace-export-'))
    const paths = {
      root,
      sessions: path.join(root, 'sessions'),
      blobs: path.join(root, 'blobs'),
      legacy: path.join(root, 'legacy'),
    }
    const store = new TraceStore(paths, { ...DEFAULT_TRACE_CONFIG, fsync: 'never' })
    const recorder = await store.beginTurn({
      sessionId: 's-export',
      packageId: 'pkg',
      turn: 1,
      provider: { kind: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
      context: { budgetCharacters: 40_000, importanceTrim: true, recentWindowChars: 28_000 },
      tools: [],
    })
    if (!recorder) throw new Error('recorder 未创建')
    recorder.modelResult({
      kind: 'reply',
      model: 'deepseek-chat',
      ok: true,
      latencyMs: 100,
      usage: usage({ inputTokens: 42, outputTokens: 7 }),
    })
    recorder.turnEnd({ status: 'completed', latencyMs: 200 })
    await store.flush('s-export')

    const markdown = await store.exportSession('s-export', 'markdown')
    expect(markdown).toContain('s-export')
    expect(markdown).toContain('in 42 / out 7')

    const json = await store.exportSession('s-export', 'json')
    expect(json).toContain('"inputTokens": 42')

    await expect(store.exportSession('missing', 'json')).resolves.toBeNull()
    // 原始日志未被导出动作改写
    const raw = await readFile(store.logPathFor('s-export'), 'utf8')
    expect(raw).toContain('"trace-session"')
  })
})
