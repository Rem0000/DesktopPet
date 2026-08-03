import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  ChatMessage,
  ProviderRuntimeConfig,
  RelationshipState,
} from '../../src/chat/contracts'
import {
  EVOLUTION_MAX_PER_WINDOW,
  EVOLUTION_MIN_AFFINITY,
  RelationshipEvaluator,
  shouldEvaluate,
} from './relationshipEvaluator'
import { RelationshipStore } from './relationshipStore'

const directories: string[] = []

async function createStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'desktop-pet-eval-'))
  directories.push(directory)
  const store = new RelationshipStore(directory)
  await store.initialize()
  return { store, directory }
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

function state(overrides: Partial<RelationshipState>): RelationshipState {
  return {
    policy: 'layered',
    affinity: 70,
    stage: 'close',
    temperatureNote: '',
    evolutions: [],
    history: [],
    lastEvaluatedAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

function message(role: 'user' | 'assistant', content: string): ChatMessage {
  return {
    id: Math.random().toString(36).slice(2),
    sessionId: 's1',
    role,
    content,
    status: 'complete',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

const CONFIG: ProviderRuntimeConfig = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  apiKey: 'mock',
}

describe('shouldEvaluate 闸门', () => {
  const now = new Date('2026-08-08T00:00:00.000Z')

  it('达标且间隔/额度满足时放行', () => {
    expect(shouldEvaluate(state({}), now)).toEqual({ ok: true })
  })

  it('affinity 过低不放行', () => {
    expect(
      shouldEvaluate(state({ affinity: EVOLUTION_MIN_AFFINITY - 1 }), now),
    ).toEqual({ ok: false, reason: 'affinity_too_low' })
  })

  it('间隔未过不放行', () => {
    expect(
      shouldEvaluate(
        state({ lastEvaluatedAt: new Date(now.getTime() - 60_000).toISOString() }),
        now,
      ),
    ).toEqual({ ok: false, reason: 'interval_not_elapsed' })
  })

  it('窗口内已生效达到上限不放行', () => {
    const appliedAt = new Date(now.getTime() - 1000).toISOString()
    const evolutions = Array.from({ length: EVOLUTION_MAX_PER_WINDOW }, (_, i) => ({
      id: `e${i}`,
      personaQuote: 'q',
      change: 'c',
      evidence: '',
      status: 'applied' as const,
      createdAt: appliedAt,
      appliedAt,
    }))
    expect(
      shouldEvaluate(state({ evolutions }), now),
    ).toEqual({ ok: false, reason: 'limit' })
  })
})

describe('RelationshipEvaluator', () => {
  it('不达标时不触发，不调用 LLM', async () => {
    const { store } = await createStore()
    await store.patch('pkg-1', { affinity: 20 })
    let called = 0
    const evaluator = new RelationshipEvaluator(store, async () => {
      called += 1
      return '{"candidates":[]}'
    })
    const result = await evaluator.maybeEvaluate({
      packageId: 'pkg-1',
      persona: '烟瘾重',
      messages: [message('user', '我已戒烟')],
      config: CONFIG,
      signal: new AbortController().signal,
    })
    expect(result.evaluated).toBe(false)
    expect(called).toBe(0)
  })

  it('达标后反思产出候选并标记已评估', async () => {
    const { store } = await createStore()
    await store.patch('pkg-1', { affinity: 80 })
    const evaluator = new RelationshipEvaluator(
      store,
      async () =>
        '{"candidates":[{"personaQuote":"烟瘾重","change":"已经戒掉","evidence":"用户三次提到戒烟成功"}]}',
    )
    const result = await evaluator.maybeEvaluate({
      packageId: 'pkg-1',
      persona: '烟瘾重',
      messages: [message('user', '我已经戒烟三个月了')],
      config: CONFIG,
      signal: new AbortController().signal,
    })
    expect(result.evaluated).toBe(true)
    expect(result.candidates).toBe(1)
    const proposals = await store.listProposals('pkg-1')
    expect(proposals).toHaveLength(1)
    expect(proposals[0].personaQuote).toBe('烟瘾重')
    expect(proposals[0].change).toBe('已经戒掉')
    expect(proposals[0].status).toBe('proposed')
    // 已标记评估 → 立即再评估被间隔闸门拦截
    const second = await evaluator.maybeEvaluate({
      packageId: 'pkg-1',
      persona: '烟瘾重',
      messages: [message('user', '继续聊')],
      config: CONFIG,
      signal: new AbortController().signal,
    })
    expect(second.evaluated).toBe(false)
    expect(second.reason).toBe('interval_not_elapsed')
  })

  it('反思返回非法 JSON 时静默降级，不产出候选', async () => {
    const { store } = await createStore()
    await store.patch('pkg-1', { affinity: 80 })
    const evaluator = new RelationshipEvaluator(store, async () => 'not json')
    const result = await evaluator.maybeEvaluate({
      packageId: 'pkg-1',
      persona: '烟瘾重',
      messages: [message('user', 'hi')],
      config: CONFIG,
      signal: new AbortController().signal,
    })
    expect(result.evaluated).toBe(true)
    expect(result.candidates).toBe(0)
    expect(await store.listProposals('pkg-1')).toHaveLength(0)
  })

  it('无 persona 时仅记录评估时间，不产出候选', async () => {
    const { store } = await createStore()
    await store.patch('pkg-1', { affinity: 80 })
    let called = 0
    const evaluator = new RelationshipEvaluator(store, async () => {
      called += 1
      return '{"candidates":[]}'
    })
    const result = await evaluator.maybeEvaluate({
      packageId: 'pkg-1',
      persona: '  ',
      messages: [message('user', 'hi')],
      config: CONFIG,
      signal: new AbortController().signal,
    })
    expect(result.reason).toBe('no_persona')
    expect(called).toBe(0)
    const updated = await store.getState('pkg-1')
    expect(updated.lastEvaluatedAt).toBeTruthy()
  })

  it('评估中被取消时不标记已评估、不新增提案', async () => {
    const { store } = await createStore()
    await store.patch('pkg-1', { affinity: 80 })
    const controller = new AbortController()
    const evaluator = new RelationshipEvaluator(store, async () => {
      controller.abort()
      return '{"candidates":[{"personaQuote":"烟瘾重","change":"已戒掉","evidence":"三次提到"}]}'
    })
    const result = await evaluator.maybeEvaluate({
      packageId: 'pkg-1',
      persona: '烟瘾重',
      messages: [message('user', '我已戒烟')],
      config: CONFIG,
      signal: controller.signal,
    })
    expect(result.evaluated).toBe(false)
    expect(result.reason).toBe('aborted')
    const updated = await store.getState('pkg-1')
    expect(updated.lastEvaluatedAt).toBeFalsy()
    expect(await store.listProposals('pkg-1')).toHaveLength(0)
  })
})
