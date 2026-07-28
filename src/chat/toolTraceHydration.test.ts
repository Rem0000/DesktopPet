import { describe, expect, it } from 'vitest'
import type { ToolTraceRecord } from './contracts'
import { hydrateToolStateFromTraces } from './toolTraceHydration'

describe('hydrateToolStateFromTraces', () => {
  it('按 messageId 还原时间线与引用', () => {
    const messageId = 'msg-assistant-1'
    const traces: ToolTraceRecord[] = [
      {
        requestId: 'r1',
        sessionId: 's1',
        messageId,
        toolName: 'remember_fact',
        startedAt: '2026-07-27T10:00:00.000Z',
        endedAt: '2026-07-27T10:00:00.050Z',
        ok: true,
        latencyMs: 50,
        inputSummary: '{"content":"喜欢猫"}',
      },
      {
        requestId: 'r2',
        sessionId: 's1',
        messageId,
        toolName: 'search_knowledge',
        startedAt: '2026-07-27T10:00:01.000Z',
        endedAt: '2026-07-27T10:00:01.020Z',
        ok: true,
        latencyMs: 20,
        citations: [
          {
            documentId: 'd1',
            chunkId: 'c1',
            title: 'demo',
            sourceName: 'demo.md',
            excerpt: '秋招智能体路线',
          },
        ],
      },
      {
        requestId: 'r3',
        sessionId: 's1',
        messageId: 'other-msg',
        toolName: 'remember_fact',
        startedAt: '2026-07-27T10:00:02.000Z',
        endedAt: '2026-07-27T10:00:02.010Z',
        ok: true,
        latencyMs: 10,
      },
    ]

    const hydrated = hydrateToolStateFromTraces(traces, new Set([messageId]))
    expect(hydrated.toolTimelines[messageId]).toHaveLength(2)
    expect(hydrated.toolTimelines[messageId]?.[1]?.hitCount).toBe(1)
    expect(hydrated.citationsByMessage[messageId]).toHaveLength(1)
    expect(hydrated.toolTimelines['other-msg']).toBeUndefined()
  })
})
