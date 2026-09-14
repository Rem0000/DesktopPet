import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatStreamEvent } from '../../src/chat/contracts'
import { DEFAULT_TRACE_CONFIG } from '../../src/trace/contracts'
import type { TraceDirPaths } from '../projectPaths'
import { TraceStore } from '../trace/traceStore'
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

async function tracePaths(): Promise<TraceDirPaths> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'desktop-pet-service-trace-'))
  directories.push(root)
  return {
    root,
    sessions: path.join(root, 'sessions'),
    blobs: path.join(root, 'blobs'),
    legacy: path.join(root, 'legacy'),
  }
}

/** 把链路追踪接到 ChatService：轮次事实由 chatController 组装，此处用测试桩替代 */
function makeBeginTrace(store: TraceStore) {
  return async (input: {
    sessionId: string
    packageId: string
    turn: number
    provider: { kind: string; baseUrl: string; model: string; plannerModel?: string }
  }) =>
    store.beginTurn({
      ...input,
      context: { budgetCharacters: 40_000, importanceTrim: true, recentWindowChars: 28_000 },
      tools: [],
    })
}

async function setup(
  provider: AgentProvider,
  options: { traceLog?: TraceStore } = {},
) {
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
    undefined,
    options.traceLog ? makeBeginTrace(options.traceLog) : undefined,
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
        return { text: '你好' }
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
        return { text: '完成' }
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

  it('链路记录轮次边界、用户与助手消息，并带 requestId', async () => {
    const log = new TraceStore(await tracePaths(), { ...DEFAULT_TRACE_CONFIG, fsync: 'never' })
    const fixture = await setup(
      {
        stream: async (_messages, _config, _signal, onToken) => {
          onToken('你好')
          return { text: '你好' }
        },
      },
      { traceLog: log },
    )
    const { requestId, userMessage } = await fixture.service.send(
      { sessionId: fixture.session.id, text: '你好' },
      fixture.sink,
    )
    await waitFor(() => fixture.events.some((event) => event.type === 'complete'))
    await log.flush(fixture.session.id)

    const result = await log.readSession(fixture.session.id, { limit: 100 })
    const types = result.events.map((event) => event.type)
    expect(types).toContain('turn/start')
    expect(types).toContain('user/message')
    expect(types).toContain('assistant/message')
    expect(types).toContain('turn/end')

    const turnStart = result.events.find((event) => event.type === 'turn/start')
    if (turnStart?.type === 'turn/start') {
      expect(turnStart.data.requestId).toBe(requestId)
      expect(turnStart.data.userMessageId).toBe(userMessage.id)
    }
    const userEvent = result.events.find((event) => event.type === 'user/message')
    if (userEvent?.type === 'user/message') {
      expect(userEvent.data.content).toBe('你好')
    }
    const turnEnd = result.events.find((event) => event.type === 'turn/end')
    if (turnEnd?.type === 'turn/end') {
      expect(turnEnd.data.status).toBe('completed')
      expect(turnEnd.data.modelCalls).toBe(1)
    }
    expect(result.events[0]?.seq).toBe(0)
  })

  it('取消生成时链路记录取消终态', async () => {
    const log = new TraceStore(await tracePaths(), { ...DEFAULT_TRACE_CONFIG, fsync: 'never' })
    const fixture = await setup(
      {
        stream: async (_messages, _config, signal) => {
          if (signal.aborted) {
            throw Object.assign(new Error('aborted'), { name: 'AbortError' })
          }
          await new Promise<void>((_, reject) => {
            signal.addEventListener(
              'abort',
              () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
              { once: true },
            )
          })
          return { text: '不应到达' }
        },
      },
      { traceLog: log },
    )
    const { requestId } = await fixture.service.send(
      { sessionId: fixture.session.id, text: '长任务' },
      fixture.sink,
    )
    expect(fixture.service.cancel(requestId, fixture.sink.id)).toBe(true)
    await waitFor(() => fixture.events.some((event) => event.type === 'complete'))
    await log.flush(fixture.session.id)

    const result = await log.readSession(fixture.session.id, { limit: 100 })
    const turnEnd = result.events.find((event) => event.type === 'turn/end')
    expect(turnEnd).toBeDefined()
    if (turnEnd?.type === 'turn/end') {
      expect(turnEnd.data.status).toBe('cancelled')
      expect(turnEnd.data.errorCode).toBe('cancelled')
    }
  })
})
