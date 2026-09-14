import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { TokenUsage, TraceEvent } from './contracts'
import {
  SessionList,
  ToolCard,
  TurnTimeline,
  formatUsage,
  groupEventsByTurn,
  prettyJson,
  statusLabel,
  textOfValue,
} from './TraceViews'

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

function ev<K extends TraceEvent['type']>(
  type: K,
  seq: number,
  turn: number,
  data: Extract<TraceEvent, { type: K }>['data'],
): TraceEvent {
  return { type, seq, time: 1_000 + seq, turn, data } as TraceEvent
}

describe('链路追踪台展示组件', () => {
  it('按轮分组并从 turn/end 取终态与耗时', () => {
    const groups = groupEventsByTurn([
      ev('turn/start', 0, 1, {}),
      ev('turn/end', 1, 1, {
        status: 'completed',
        latencyMs: 1_200,
        usage: usage(),
        modelCalls: 1,
        toolCalls: 0,
        toolSuccesses: 0,
      }),
      ev('turn/start', 2, 2, {}),
    ])
    expect(groups.map((group) => group.turn)).toEqual([1, 2])
    expect(groups[0]).toMatchObject({ status: 'completed', latencyMs: 1_200 })
    expect(groups[1]?.status).toBe('running')
    expect(statusLabel('interrupted')).toBe('已中断')
  })

  it('用量展示中标注估算且隐藏为 0 的缓存写', () => {
    expect(formatUsage(usage({ inputTokens: 1_296, outputTokens: 151, cacheReadTokens: 800, reasoningTokens: 36 }))).toBe(
      'in 1296 · out 151 · cache-r 800 · reasoning 36',
    )
    expect(formatUsage(usage({ inputTokens: 1, estimated: true }))).toContain('（估算）')
    expect(formatUsage(usage({ cacheWriteTokens: 12 }))).toContain('cache-w 12')
    expect(formatUsage(undefined)).toBe('—')
  })

  it('外置原文提示与 JSON 美化', () => {
    expect(
      textOfValue({ preview: '前 240 字…', bytes: 9_000, characters: 9_000, sha256: 'a'.repeat(64), blobRef: 'a'.repeat(64) }),
    ).toContain('原文已外置')
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}')
    expect(prettyJson('not json')).toBe('not json')
  })

  it('渲染一轮完整时间轴：用户消息、节点耗时、模型卡、工具卡与检索命中', () => {
    const group = groupEventsByTurn([
      ev('turn/start', 0, 1, { userMessageId: 'u1', requestId: 'req-1' }),
      ev('user/message', 1, 1, { messageId: 'u1', content: '并发编程怎么学', characters: 7 }),
      ev('step/end', 2, 1, { node: 'recall', latencyMs: 12 }),
      ev('model/result', 3, 1, {
        kind: 'plan',
        model: 'deepseek-chat',
        ok: true,
        latencyMs: 40,
        usage: usage({ inputTokens: 300, outputTokens: 20, cacheReadTokens: 100 }),
      }),
      ev('tool/call', 4, 1, {
        callId: 'c1',
        name: 'search_knowledge',
        riskLevel: 'safe',
        args: '{"query":"并发编程"}',
      }),
      ev('tool/result', 5, 1, {
        callId: 'c1',
        name: 'search_knowledge',
        ok: true,
        latencyMs: 36,
        output: '{"hits":[{"id":"k1"}]}',
      }),
      ev('retrieval/hits', 6, 1, {
        source: 'knowledge',
        query: '并发编程',
        latencyMs: 36,
        hits: [{ id: 'k1', score: 0.9, recallSource: 'both', title: '面试要点' }],
      }),
      ev('model/result', 7, 1, {
        kind: 'reply',
        model: 'deepseek-chat',
        ok: true,
        latencyMs: 900,
        ttftMs: 320,
        finishReason: 'stop',
        usage: usage({ inputTokens: 1_000, outputTokens: 120, cacheReadTokens: 400, reasoningTokens: 30 }),
      }),
      ev('assistant/message', 8, 1, { messageId: 'a1', content: '先看 JMM', characters: 6 }),
      ev('turn/end', 9, 1, {
        status: 'completed',
        latencyMs: 1_500,
        usage: usage(),
        modelCalls: 2,
        toolCalls: 1,
        toolSuccesses: 1,
      }),
    ])[0]!

    const html = renderToStaticMarkup(
      <TurnTimeline group={group} usage={usage({ inputTokens: 1_300, outputTokens: 140 })} />,
    )
    expect(html).toContain('第 1 轮')
    expect(html).toContain('完成')
    expect(html).toContain('并发编程怎么学')
    expect(html).toContain('recall')
    expect(html).toContain('模型调用 · plan')
    expect(html).toContain('首字 320ms')
    expect(html).toContain('工具 · search_knowledge')
    expect(html).toContain('&quot;query&quot;: &quot;并发编程&quot;')
    expect(html).toContain('k1')
    expect(html).toContain('面试要点')
    expect(html).toContain('先看 JMM')
    expect(html).toContain('in 1300 · out 140')
  })

  it('失败工具与未完成工具都能正确渲染', () => {
    const call = ev('tool/call', 0, 1, {
      callId: 'c1',
      name: 'web_fetch',
      riskLevel: 'confirm',
      args: '{"url":"https://x.test"}',
    })
    const htmlMissing = renderToStaticMarkup(
      <ToolCard call={call as Extract<TraceEvent, { type: 'tool/call' }>} />,
    )
    expect(htmlMissing).toContain('未完成')
    expect(htmlMissing).toContain('需确认')

    const htmlFailed = renderToStaticMarkup(
      <ToolCard
        call={call as Extract<TraceEvent, { type: 'tool/call' }>}
        result={
          ev('tool/result', 1, 1, {
            callId: 'c1',
            name: 'web_fetch',
            ok: false,
            latencyMs: 20,
            errorCode: 'cancelled',
            message: '用户取消工具：web_fetch',
          }) as Extract<TraceEvent, { type: 'tool/result' }>
        }
        confirm={
          ev('tool/confirm', 2, 1, {
            callId: 'c1',
            name: 'web_fetch',
            decision: 'denied',
            waitedMs: 1_500,
          }) as Extract<TraceEvent, { type: 'tool/confirm' }>
        }
      />,
    )
    expect(htmlFailed).toContain('is-failed')
    expect(htmlFailed).toContain('cancelled')
    expect(htmlFailed).toContain('确认：拒绝')
    expect(htmlFailed).toContain('用户取消工具：web_fetch')
  })

  it('会话列表展示轮数、用量与终态，空列表给出提示', () => {
    const html = renderToStaticMarkup(
      <SessionList
        sessions={[
          {
            sessionId: 'abcdefgh-1234',
            packageId: 'pkg',
            createdAt: 1,
            updatedAt: 2,
            turns: 3,
            lastStatus: 'interrupted',
            usage: usage({ inputTokens: 10, outputTokens: 5 }),
            toolCalls: 2,
            toolSuccesses: 1,
            durationMs: 4_000,
          },
        ]}
        selectedId="abcdefgh-1234"
        onSelect={() => undefined}
      />,
    )
    expect(html).toContain('abcdefgh')
    expect(html).toContain('3 轮')
    expect(html).toContain('工具 1/2')
    expect(html).toContain('已中断')
    expect(html).toContain('is-selected')

    expect(renderToStaticMarkup(<SessionList sessions={[]} selectedId={null} onSelect={() => undefined} />)).toContain(
      '暂无链路记录',
    )
  })
})
