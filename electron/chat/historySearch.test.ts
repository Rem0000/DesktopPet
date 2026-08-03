import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ChatStore, type SecretCipher } from './chatStore'
import { HistorySearchService } from './historySearch'
import { ToolRegistry } from './toolRegistry'

const temporaryDirectories: string[] = []

const cipher: SecretCipher = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
  decryptString: (value) => value.toString('utf8').replace(/^encrypted:/, ''),
}

async function createStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'desktop-pet-history-'))
  temporaryDirectories.push(directory)
  const store = new ChatStore(directory, cipher)
  await store.initialize()
  return { store, directory }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

async function seedSession(
  store: ChatStore,
  packageId: string,
  lines: Array<[string, string]>,
): Promise<string> {
  const session = await store.createSession(packageId)
  for (const [role, content] of lines) {
    await store.appendMessage(session.id, role as 'user' | 'assistant', content)
  }
  return session.id
}

describe('HistorySearchService', () => {
  it('注册 search_history 为 safe 且默认启用', async () => {
    const { store } = await createStore()
    const registry = new ToolRegistry()
    const service = new HistorySearchService(store, registry, () => 'pkg-1')
    service.registerDefaultTools()
    expect(registry.get('search_history')).toBeTruthy()
    expect(registry.getRiskLevel('search_history')).toBe('safe')
    expect(registry.listForPlanning().some((tool) => tool.name === 'search_history')).toBe(true)
  })

  it('仅检索活跃包的会话，不串其他包', async () => {
    const { store } = await createStore()
    await seedSession(store, 'pkg-a', [
      ['user', '我喜欢喝美式咖啡'],
      ['assistant', '记住了，你喜欢美式咖啡'],
    ])
    await seedSession(store, 'pkg-b', [
      ['user', '我只喝抹茶拿铁'],
      ['assistant', '好的，你喜欢抹茶拿铁'],
    ])
    const registry = new ToolRegistry()
    const service = new HistorySearchService(store, registry, () => 'pkg-a')
    service.registerDefaultTools()
    const tool = registry.get('search_history')!
    const output = (await tool.execute(
      tool.validate({ query: '咖啡', topK: 8 }),
      new AbortController().signal,
    )) as { ok: boolean; hits: Array<{ excerpt: string }>; empty: boolean }
    expect(output.ok).toBe(true)
    expect(output.hits.some((hit) => hit.excerpt.includes('美式'))).toBe(true)
    expect(output.hits.every((hit) => !hit.excerpt.includes('抹茶'))).toBe(true)
  })

  it('仅返回已提交（complete）消息，结果带出处', async () => {
    const { store } = await createStore()
    const sessionId = await seedSession(store, 'pkg-1', [
      ['user', '下周想去看海'],
      ['assistant', '听起来不错'],
    ])
    await store.appendMessage(sessionId, 'assistant', '正在流式输出中', 'streaming')
    const registry = new ToolRegistry()
    const service = new HistorySearchService(store, registry, () => 'pkg-1')
    service.registerDefaultTools()
    const tool = registry.get('search_history')!
    const output = (await tool.execute(
      tool.validate({ query: '看海', topK: 8 }),
      new AbortController().signal,
    )) as { ok: boolean; hits: Array<{ messageId: string; sessionId: string; role: string; createdAt: string; excerpt: string }>; empty: boolean }
    expect(output.hits).toHaveLength(1)
    expect(output.hits[0]).toMatchObject({
      sessionId,
      role: 'user',
      excerpt: expect.stringContaining('看海') as string,
    })
    expect(output.hits[0].createdAt).toBeTruthy()
  })

  it('无命中时返回 empty=true，不抛错', async () => {
    const { store } = await createStore()
    await seedSession(store, 'pkg-1', [['user', '今天天气不错']])
    const registry = new ToolRegistry()
    const service = new HistorySearchService(store, registry, () => 'pkg-1')
    service.registerDefaultTools()
    const tool = registry.get('search_history')!
    const output = (await tool.execute(
      tool.validate({ query: '量子纠缠xyz' }),
      new AbortController().signal,
    )) as { ok: boolean; empty: boolean }
    expect(output.ok).toBe(true)
    expect(output.empty).toBe(true)
  })

  it('Embedding 无关：纯 BM25 即可检索（不依赖向量模型）', async () => {
    const { store } = await createStore()
    await seedSession(store, 'pkg-1', [['user', '我喜欢吃榴莲披萨']])
    const registry = new ToolRegistry()
    const service = new HistorySearchService(store, registry, () => 'pkg-1')
    service.registerDefaultTools()
    const tool = registry.get('search_history')!
    const output = (await tool.execute(
      tool.validate({ query: '榴莲' }),
      new AbortController().signal,
    )) as { ok: boolean; hits: Array<{ excerpt: string }> }
    expect(output.hits[0]?.excerpt).toContain('榴莲')
  })

  it('无活跃包时返回失败而非抛错', async () => {
    const { store } = await createStore()
    await seedSession(store, 'pkg-1', [['user', '你好']])
    const registry = new ToolRegistry()
    const service = new HistorySearchService(store, registry, () => null)
    service.registerDefaultTools()
    const tool = registry.get('search_history')!
    const output = (await tool.execute(
      tool.validate({ query: '你好' }),
      new AbortController().signal,
    )) as { ok: boolean; errorCode?: string }
    expect(output.ok).toBe(false)
    expect(output.errorCode).toBe('no_active_package')
  })

  it('空查询直接返回空', async () => {
    const { store } = await createStore()
    await seedSession(store, 'pkg-1', [['user', '内容']])
    const registry = new ToolRegistry()
    const service = new HistorySearchService(store, registry, () => 'pkg-1')
    service.registerDefaultTools()
    expect(await service.search('pkg-1', '   ')).toEqual([])
  })
})
