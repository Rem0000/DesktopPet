import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatStreamEvent } from '../../src/chat/contracts'
import { AgentRuntime, type AgentProvider } from './agentRuntime'
import { ChatService, ChatServiceError } from './chatService'
import { ChatStore, type SecretCipher } from './chatStore'
import { ToolRegistry } from './toolRegistry'

const directories: string[] = []
const cipher: SecretCipher = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value),
  decryptString: (value) => value.toString(),
}

async function setup(provider: AgentProvider) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'desktop-pet-service-'))
  directories.push(directory)
  const store = new ChatStore(directory, cipher)
  await store.initialize()
  await store.updateProviderConfig({
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    apiKey: 'key',
  })
  const session = await store.createSession('pkg-test')
  const states: string[] = []
  const service = new ChatService(
    store,
    new AgentRuntime(provider, new ToolRegistry()),
    (state) => states.push(state),
    () => 'pkg-test',
  )
  const events: ChatStreamEvent[] = []
  return {
    store,
    session,
    states,
    events,
    service,
    sink: { id: 7, send: (event: ChatStreamEvent) => events.push(event) },
  }
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3_000,
): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('等待测试条件超时')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('ChatService', () => {
  it('路由流事件并在完成后复位桌宠状态', async () => {
    const fixture = await setup({
      stream: async (_messages, _config, _signal, onToken) => {
        onToken('你')
        onToken('好')
        return '你好'
      },
    })
    await fixture.service.send(
      { sessionId: fixture.session.id, text: '你好' },
      fixture.sink,
    )
    await waitFor(() => fixture.events.some((event) => event.type === 'complete'))

    expect(fixture.events.map((event) => event.type)).toEqual([
      'chunk',
      'chunk',
      'complete',
    ])
    expect(fixture.states).toEqual(['thinking', 'speaking', 'idle'])
    expect(fixture.store.getSession(fixture.session.id)?.messages).toHaveLength(2)
  })

  it('拒绝同一会话并发生成且允许按发送方取消', async () => {
    const fixture = await setup({
      stream: async (_messages, _config, signal) => {
        if (signal.aborted) {
          throw Object.assign(new Error('aborted'), { name: 'AbortError' })
        }
        await new Promise<void>((_, reject) => {
          signal.addEventListener(
            'abort',
            () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            { once: true },
          )
        })
        return '完成'
      },
    })
    const first = await fixture.service.send(
      { sessionId: fixture.session.id, text: '第一条' },
      fixture.sink,
    )
    await expect(
      fixture.service.send(
        { sessionId: fixture.session.id, text: '第二条' },
        fixture.sink,
      ),
    ).rejects.toBeInstanceOf(ChatServiceError)
    expect(fixture.service.cancel(first.requestId, 999)).toBe(false)
    expect(fixture.service.cancel(first.requestId, fixture.sink.id)).toBe(true)
    await waitFor(() => fixture.events.some((event) => event.type === 'complete'))
    expect(fixture.events.at(-1)?.type).toBe('complete')
    expect(fixture.states.at(-1)).toBe('idle')
  })

  it('校验空消息和不存在的会话', async () => {
    const fixture = await setup({ stream: vi.fn() })
    await expect(
      fixture.service.send({ sessionId: fixture.session.id, text: '  ' }, fixture.sink),
    ).rejects.toMatchObject({ detail: { code: 'validation' } })
    await expect(
      fixture.service.send({ sessionId: 'missing', text: '你好' }, fixture.sink),
    ).rejects.toMatchObject({ detail: { code: 'validation' } })
  })
})
