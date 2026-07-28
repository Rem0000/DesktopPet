import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ChatStore, type SecretCipher } from './chatStore'

const temporaryDirectories: string[] = []

const cipher: SecretCipher = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
  decryptString: (value) => value.toString('utf8').replace(/^encrypted:/, ''),
}

async function createStore(customCipher = cipher) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'desktop-pet-chat-'))
  temporaryDirectories.push(directory)
  const store = new ChatStore(directory, customCipher)
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

describe('ChatStore', () => {
  it('隔离会话并持久化首条消息标题', async () => {
    const { store, directory } = await createStore()
    const first = await store.createSession('pkg-a')
    const second = await store.createSession('pkg-b')
    await store.appendMessage(first.id, 'user', '  你好，帮我规划今天的工作  ')

    expect(store.getSession(first.id)?.title).toBe('你好，帮我规划今天的工作')
    expect(store.getSession(first.id)?.packageId).toBe('pkg-a')
    expect(store.listSessions('pkg-a')).toHaveLength(1)
    expect(store.listSessions('pkg-b')).toHaveLength(1)
    expect(store.getSession(second.id)?.messages).toHaveLength(0)

    const restored = new ChatStore(directory, cipher)
    await restored.initialize()
    expect(restored.getSession(first.id)?.messages).toHaveLength(1)
  })

  it('损坏数据会备份并恢复为空数据库', async () => {
    const { directory } = await createStore()
    await writeFile(path.join(directory, 'chat-data.json'), '{broken', 'utf8')

    const restored = new ChatStore(directory, cipher)
    await restored.initialize()
    expect(restored.listSessions()).toEqual([])
  })

  it('不向公开配置或数据文件暴露明文 API Key', async () => {
    const { store, directory } = await createStore()
    const publicConfig = await store.updateProviderConfig({
      baseUrl: 'https://api.deepseek.com/',
      model: 'deepseek-chat',
      apiKey: 'secret-key',
    })

    expect(publicConfig).toMatchObject({
      hasApiKey: true,
      apiKeyStorage: 'encrypted',
    })
    expect(publicConfig).not.toHaveProperty('apiKey')
    expect(store.getRuntimeProviderConfig()?.apiKey).toBe('secret-key')
    const file = await readFile(path.join(directory, 'chat-data.json'), 'utf8')
    expect(file).not.toContain('secret-key')
  })

  it('加密不可用时仅在内存保存凭据', async () => {
    const unavailable: SecretCipher = {
      ...cipher,
      isEncryptionAvailable: () => false,
    }
    const { store, directory } = await createStore(unavailable)
    const config = await store.updateProviderConfig({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKey: 'memory-key',
    })

    expect(config.apiKeyStorage).toBe('memory')
    const restored = new ChatStore(directory, unavailable)
    await restored.initialize()
    expect(restored.getProviderConfig().hasApiKey).toBe(false)
  })
})
