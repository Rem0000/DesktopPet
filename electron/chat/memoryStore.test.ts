import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installMockEmbeddingPipeline } from '../retrieval/testHelpers'
import { assertSafeMemoryContent, MemoryStore } from './memoryStore'

const directories: string[] = []

beforeEach(() => {
  installMockEmbeddingPipeline()
})

async function createStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'desktop-pet-memory-'))
  directories.push(directory)
  const store = new MemoryStore(directory)
  await store.initialize()
  return { store, directory }
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('MemoryStore', () => {
  it('按 key 覆盖 profile，并追加 fact；拒绝 preference', async () => {
    const { store } = await createStore()
    await store.writeItem({
      type: 'profile',
      key: 'user.nickname',
      content: '小明',
      importance: 3,
    })
    await store.writeItem({
      type: 'profile',
      key: 'user.nickname',
      content: '阿明',
      importance: 2,
    })
    await store.writeItem({
      type: 'fact',
      content: '用户在准备考研',
    })
    await expect(
      store.writeItem({
        type: 'preference',
        key: 'reply.length',
        content: '回答短一点',
      }),
    ).rejects.toThrow(/preference/)

    const items = store.listItems()
    expect(items.filter((item) => item.type === 'profile')).toHaveLength(1)
    expect(items.find((item) => item.key === 'user.nickname')?.content).toBe('阿明')
    expect(items.filter((item) => item.type === 'fact')).toHaveLength(1)
  })

  it('拒绝敏感内容并支持清空', async () => {
    const { store } = await createStore()
    expect(() => assertSafeMemoryContent('my api_key is sk-abcdefghijklmnop')).toThrow(
      /敏感/,
    )
    await store.writeItem({ type: 'fact', content: '喜欢咖啡' })
    expect(await store.clearItems()).toBe(1)
    expect(store.listItems()).toHaveLength(0)
  })

  it('删除会话摘要不删除长期记忆', async () => {
    const { store, directory } = await createStore()
    await store.writeItem({
      type: 'profile',
      key: 'user.nickname',
      content: '小明',
    })
    await store.upsertSummary({
      sessionId: 's1',
      summary: '聊过考研',
      coveredUntilMessageId: 'm1',
      updatedAt: new Date().toISOString(),
    })
    expect(await store.deleteSessionSummary('s1')).toBe(true)
    expect(store.getSummary('s1')).toBeNull()
    expect(store.listItems()).toHaveLength(1)

    const restored = new MemoryStore(directory)
    await restored.initialize()
    expect(restored.listItems()[0]?.content).toBe('小明')
  })

  it('损坏文件会备份并恢复空库', async () => {
    const { directory } = await createStore()
    await writeFile(path.join(directory, 'memory-data.json'), '{broken', 'utf8')
    const restored = new MemoryStore(directory)
    await restored.initialize()
    expect(restored.listItems()).toEqual([])
    const raw = await readFile(path.join(directory, 'memory-data.json'), 'utf8')
    expect(raw).toContain('"items": []')
  })

  it('过期 commitment 不会进入 active 列表', async () => {
    const { store } = await createStore()
    await store.writeItem({
      type: 'commitment',
      content: '明天提醒交报告',
      expiresAt: '2020-01-01T00:00:00.000Z',
    })
    expect(store.getActiveItems()).toHaveLength(0)
  })
})
