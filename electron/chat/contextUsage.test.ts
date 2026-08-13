import { describe, expect, it } from 'vitest'
import type { ContextSectionBreakdown } from './contextUsage'
import {
  breakdownToUsage,
  ContextUsageTracker,
  emptyContextSectionBreakdown,
} from './contextUsage'

describe('contextUsage', () => {
  it('未观测时返回 observed=false 且各拆分项为 0', () => {
    const usage = breakdownToUsage(undefined, 24_000)
    expect(usage.observed).toBe(false)
    expect(usage.usedCharacters).toBe(0)
    expect(usage.ratio).toBe(0)
    expect(usage.parts.every((part) => part.characters === 0)).toBe(true)
    expect(usage.parts.map((part) => part.key)).toEqual([
      'messages',
      'systemTools',
      'systemPrompt',
      'memory',
      'skills',
    ])
  })

  it('按来源拆分并合计、计算占比', () => {
    const breakdown: ContextSectionBreakdown = {
      systemPromptCharacters: 500,
      systemToolsCharacters: 300,
      skillsCharacters: 200,
      memoryCharacters: 100,
      messagesCharacters: 900,
    }
    const usage = breakdownToUsage(breakdown, 4_000)
    expect(usage.observed).toBe(true)
    expect(usage.usedCharacters).toBe(2_000)
    expect(usage.ratio).toBe(0.5)
    expect(usage.parts).toEqual([
      { key: 'messages', label: '消息', characters: 900 },
      { key: 'systemTools', label: 'System tools', characters: 300 },
      { key: 'systemPrompt', label: 'System prompt', characters: 500 },
      { key: 'memory', label: 'Memory files', characters: 100 },
      { key: 'skills', label: 'Skills', characters: 200 },
    ])
  })

  it('超出预算时占比钳制为 1', () => {
    const usage = breakdownToUsage(
      { ...emptyContextSectionBreakdown(), messagesCharacters: 5_000 },
      4_000,
    )
    expect(usage.ratio).toBe(1)
  })

  it('按 packageId/sessionId 记录并可精确/回退查询', () => {
    const tracker = new ContextUsageTracker()
    tracker.record({
      sessionId: 's1',
      packageId: 'pkg-a',
      ...emptyContextSectionBreakdown(),
    })
    tracker.record({
      sessionId: 's2',
      packageId: 'pkg-a',
      ...emptyContextSectionBreakdown(),
      messagesCharacters: 10,
    })

    expect(tracker.get('s1', 'pkg-a')).toMatchObject({ sessionId: 's1', packageId: 'pkg-a' })
    // 未提供包时回退按会话 id 查找
    expect(tracker.get('s2')).toMatchObject({ sessionId: 's2' })
    // 未观测的会话返回 undefined
    expect(tracker.get('missing', 'pkg-a')).toBeUndefined()
    // 同 id 不同包互不干扰
    tracker.record({
      sessionId: 's1',
      packageId: 'pkg-b',
      ...emptyContextSectionBreakdown(),
      skillsCharacters: 7,
    })
    expect(tracker.get('s1', 'pkg-b')).toMatchObject({ packageId: 'pkg-b', skillsCharacters: 7 })
    expect(tracker.get('s1', 'pkg-a')).toMatchObject({ packageId: 'pkg-a' })
  })

  it('删除会话/清空包会移除对应观测', () => {
    const tracker = new ContextUsageTracker()
    tracker.record({ sessionId: 's1', packageId: 'pkg-a', ...emptyContextSectionBreakdown() })
    tracker.record({ sessionId: 's2', packageId: 'pkg-a', ...emptyContextSectionBreakdown() })
    tracker.record({ sessionId: 's3', packageId: 'pkg-b', ...emptyContextSectionBreakdown() })

    tracker.deleteSession('s1')
    expect(tracker.get('s1', 'pkg-a')).toBeUndefined()
    expect(tracker.get('s2', 'pkg-a')).toBeDefined()

    tracker.clearPackage('pkg-a')
    expect(tracker.get('s2', 'pkg-a')).toBeUndefined()
    expect(tracker.get('s3', 'pkg-b')).toBeDefined()
  })
})
