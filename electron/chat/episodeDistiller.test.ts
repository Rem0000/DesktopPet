import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChatMessage, ProviderRuntimeConfig } from '../../src/chat/contracts'
import { installMockEmbeddingPipeline } from '../retrieval/testHelpers'
import { EpisodeDistiller, hasKeyFactIntent, parseEpisodes } from './episodeDistiller'
import { MemoryStore } from './memoryStore'

const directories: string[] = []
const config: ProviderRuntimeConfig = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  apiKey: 'test',
}

beforeEach(() => {
  installMockEmbeddingPipeline()
})

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function createStore(): Promise<MemoryStore> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'desktop-pet-episode-'))
  directories.push(directory)
  const store = new MemoryStore(directory)
  await store.initialize()
  return store
}

function message(
  id: string,
  sessionId: string,
  role: ChatMessage['role'],
  content: string,
): ChatMessage {
  return {
    id,
    sessionId,
    role,
    content,
    status: 'complete',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const DEFAULT_CONFIG = { version: 1 } as const

function makeDistiller(
  store: MemoryStore,
  complete: (text: string) => string,
  cfg = DEFAULT_CONFIG,
) {
  return new EpisodeDistiller(
    store,
    async (_system, _user, _cfg, signal) => {
      if (signal.aborted) throw new Error('aborted')
      return complete('')
    },
    cfg,
  )
}

describe('hasKeyFactIntent', () => {
  it('识别关键事实意图', () => {
    expect(hasKeyFactIntent('我决定明天开始学习英语')).toBe(true)
    expect(hasKeyFactIntent('我的名字是小明')).toBe(true)
  })
  it('普通闲聊不命中', () => {
    expect(hasKeyFactIntent('今天天气不错')).toBe(false)
    expect(hasKeyFactIntent('嗯嗯')).toBe(false)
  })
})

describe('parseEpisodes', () => {
  it('解析合法 JSON', () => {
    const text = '{"episodes":[{"content":"用户决定学英语","importance":3}]}'
    expect(parseEpisodes(text)).toEqual([{ content: '用户决定学英语', importance: 3 }])
  })
  it('解析代码围栏包裹的 JSON', () => {
    const text = '```json\n{"episodes":[{"content":"用户养了一只猫","importance":2}]}\n```'
    expect(parseEpisodes(text)).toEqual([{ content: '用户养了一只猫', importance: 2 }])
  })
  it('非法形状返回空', () => {
    expect(parseEpisodes('不是 JSON')).toEqual([])
    expect(parseEpisodes('{"foo":1}')).toEqual([])
  })
})

describe('EpisodeDistiller', () => {
  it('关键事实触发写入 episode', async () => {
    const store = await createStore()
    const distiller = makeDistiller(
      store,
      () => '{"episodes":[{"content":"用户决定明年考研","importance":3}]}',
    )
    const result = await distiller.maybeDistill({
      packageId: 'p',
      sessionId: 's1',
      messages: [message('1', 's1', 'user', '我决定明年考研')],
      config,
      signal: new AbortController().signal,
    })
    expect(result.triggered).toBe(true)
    expect(result.episodesWritten).toBe(1)
    const episode = store.listItems().find((item) => item.type === 'episode')
    expect(episode?.content).toContain('考研')
    expect(episode?.importance).toBe(3)
    expect(episode?.sourceSessionId).toBe('s1')
  })

  it('平凡闲聊不触发抽取', async () => {
    const store = await createStore()
    let called = false
    const distiller = new EpisodeDistiller(
      store,
      async () => {
        called = true
        return '{"episodes":[]}'
      },
      { version: 1, minMessages: 6, intervalMessages: 6 },
    )
    const result = await distiller.maybeDistill({
      packageId: 'p',
      sessionId: 's1',
      messages: [message('1', 's1', 'user', '今天天气不错')],
      config,
      signal: new AbortController().signal,
    })
    expect(result.triggered).toBe(false)
    expect(called).toBe(false)
    expect(store.listItems()).toHaveLength(0)
  })

  it('disabled 配置不触发', async () => {
    const store = await createStore()
    let called = false
    const distiller = new EpisodeDistiller(
      store,
      async () => {
        called = true
        return '{"episodes":[]}'
      },
      { version: 1, enabled: false },
    )
    const result = await distiller.maybeDistill({
      packageId: 'p',
      sessionId: 's1',
      messages: [message('1', 's1', 'user', '我决定明年考研')],
      config,
      signal: new AbortController().signal,
    })
    expect(result.triggered).toBe(false)
    expect(called).toBe(false)
  })

  it('累计未沉淀消息达到阈值时触发', async () => {
    const store = await createStore()
    let called = false
    const distiller = new EpisodeDistiller(
      store,
      async () => {
        called = true
        return '{"episodes":[{"content":"用户喜欢喝咖啡","importance":2}]}'
      },
      { version: 1, minMessages: 3, intervalMessages: 3 },
    )
    const messages = Array.from({ length: 3 }, (_, i) =>
      message(`m${i}`, 's1', i % 2 === 0 ? 'user' : 'assistant', `闲聊第${i}条`),
    )
    const result = await distiller.maybeDistill({
      packageId: 'p',
      sessionId: 's1',
      messages,
      config,
      signal: new AbortController().signal,
    })
    expect(called).toBe(true)
    expect(result.episodesWritten).toBe(1)
  })

  it('非法 JSON 返回空结果不写入', async () => {
    const store = await createStore()
    const distiller = makeDistiller(store, () => '不是 JSON')
    const result = await distiller.maybeDistill({
      packageId: 'p',
      sessionId: 's1',
      messages: [message('1', 's1', 'user', '我决定明年考研')],
      config,
      signal: new AbortController().signal,
    })
    expect(result.triggered).toBe(true)
    expect(result.episodesWritten).toBe(0)
    expect(store.listItems()).toHaveLength(0)
  })

  it('与既有记忆高度相似时不重复写入', async () => {
    const store = await createStore()
    await store.writeItem({
      type: 'fact',
      content: '用户喜欢喝咖啡',
      importance: 2,
    })
    const distiller = makeDistiller(
      store,
      () => '{"episodes":[{"content":"用户喜欢喝咖啡","importance":2}]}',
    )
    await distiller.maybeDistill({
      packageId: 'p',
      sessionId: 's1',
      messages: [message('1', 's1', 'user', '我决定明年考研')],
      config,
      signal: new AbortController().signal,
    })
    const episodes = store.listItems().filter((item) => item.type === 'episode')
    expect(episodes).toHaveLength(0)
  })

  it('敏感内容被拒绝写入', async () => {
    const store = await createStore()
    const distiller = makeDistiller(
      store,
      () => '{"episodes":[{"content":"我的 API Key 是 sk-abcdef1234567890","importance":3}]}',
    )
    await distiller.maybeDistill({
      packageId: 'p',
      sessionId: 's1',
      messages: [message('1', 's1', 'user', '我决定明年考研')],
      config,
      signal: new AbortController().signal,
    })
    const episodes = store.listItems().filter((item) => item.type === 'episode')
    expect(episodes).toHaveLength(0)
  })

  it('冷启动加载旧会话时跳过抽取，避免把历史当新消息', async () => {
    const store = await createStore()
    let called = false
    const distiller = new EpisodeDistiller(
      store,
      async () => {
        called = true
        return '{"episodes":[]}'
      },
      { version: 1 },
    )
    // 模拟应用重启后首次遇到一个已有 10 条消息的旧会话
    const history = Array.from({ length: 10 }, (_, i) =>
      message(`h${i}`, 's-old', i % 2 === 0 ? 'user' : 'assistant', `旧会话第${i}条`),
    )
    const result = await distiller.maybeDistill({
      packageId: 'p',
      sessionId: 's-old',
      messages: history,
      config,
      signal: new AbortController().signal,
    })
    expect(result.triggered).toBe(false)
    expect(result.reason).toBe('cold_start_history')
    expect(called).toBe(false)

    // 后续新增一条关键事实仍可正常触发（基准线已预置）
    const after = [...history, message('h10', 's-old', 'user', '我决定明年考研')]
    const next = await distiller.maybeDistill({
      packageId: 'p',
      sessionId: 's-old',
      messages: after,
      config,
      signal: new AbortController().signal,
    })
    expect(next.triggered).toBe(true)
  })
})
