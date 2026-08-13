import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, ProviderRuntimeConfig } from '../../src/chat/contracts'
import { installMockEmbeddingPipeline } from '../retrieval/testHelpers'
import { AgentRuntime } from './agentRuntime'
import {
  fallbackSummaryFromMessages,
  MemoryService,
  scoreMemoryItem,
} from './memoryService'
import { MemoryStore } from './memoryStore'
import { ToolRegistry } from './toolRegistry'

const directories: string[] = []
const PKG = 'import-test-pkg'
const config: ProviderRuntimeConfig = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  apiKey: 'test',
}

beforeEach(() => {
  installMockEmbeddingPipeline()
})

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

async function createMemoryService() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'desktop-pet-memory-svc-'))
  directories.push(directory)
  const store = new MemoryStore(directory)
  await store.initialize()
  const tools = new ToolRegistry()
  const service = new MemoryService(store, tools)
  service.registerDefaultTools()
  return { store, tools, service }
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('MemoryService', () => {
  it('召回优先画像并按关键词补充事实，且忽略 preference', async () => {
    const { store, service } = await createMemoryService()
    await expect(
      store.writeItem({
        type: 'preference',
        key: 'tone',
        content: '回答短一点',
        importance: 3,
      }),
    ).rejects.toThrow(/preference/)
    await store.writeItem({
      type: 'profile',
      key: 'user.nickname',
      content: '小明',
      importance: 3,
    })
    await store.writeItem({
      type: 'fact',
      content: '用户喜欢咖啡',
      importance: 2,
    })
    await store.writeItem({
      type: 'fact',
      content: '用户养了一只猫',
      importance: 1,
    })

    const recalled = await service.recall('咖啡怎么冲')
    expect(recalled[0]?.type).toBe('profile')
    expect(recalled.some((item) => item.content.includes('咖啡'))).toBe(true)
    expect(recalled.every((item) => item.type !== 'preference')).toBe(true)
  })

  it('摘要失败时降级为要点列表', () => {
    const summary = fallbackSummaryFromMessages([
      message('1', 's', 'user', '我叫小明'),
      message('2', 's', 'assistant', '好的小明'),
    ])
    expect(summary).toContain('用户：我叫小明')
  })

  it('组装上下文会注入长期记忆与近期对话', async () => {
    const { store, service } = await createMemoryService()
    await store.writeItem({
      type: 'profile',
      key: 'user.nickname',
      content: '小明',
      importance: 3,
    })
    const assembled = await service.assemble({
      sessionId: 's1',
      packageId: PKG,
      messages: [
        message('1', 's1', 'user', '你好'),
        message('2', 's1', 'assistant', '嗨'),
        message('3', 's1', 'user', '还记得我吗'),
      ],
      query: '还记得我吗',
      config,
      signal: new AbortController().signal,
      budget: 4_000,
    })
    expect(assembled.systemPrompt).toContain('小明')
    expect(assembled.systemPrompt).toContain('跨模型共享')
    expect(assembled.recentMessages.at(-1)?.content).toBe('还记得我吗')
  })

  it('记忆工具可写入画像/事实并可拒绝 preference 与未注册工具', async () => {
    const { service } = await createMemoryService()
    const result = (await service.executeTool(
      'update_profile',
      { key: 'user.nickname', content: '小明' },
      new AbortController().signal,
    )) as { ok: boolean }
    expect(result.ok).toBe(true)
    await expect(
      service.executeTool(
        'remember_preference',
        { key: 'tone', content: '短一点' },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/不存在/)
    await expect(
      service.executeTool('shell_exec', { cmd: 'rm -rf /' }, new AbortController().signal),
    ).rejects.toThrow(/不存在/)
  })

  it('Agent 可通过 pendingToolCalls 写入事实并在后续召回', async () => {
    const { store, service, tools } = await createMemoryService()
    const runtime = new AgentRuntime(
      {
        stream: async (_messages, _config, _signal, onToken, systemPrompt) => {
          const reply = systemPrompt?.includes('喜欢咖啡') ? '好的，记得你喜欢咖啡' : '你好'
          onToken(reply)
          return reply
        },
      },
      tools,
      service,
    )

    await runtime.run({
      sessionId: 's1',
      packageId: PKG,
      messages: [message('1', 's1', 'user', '请记住我喜欢咖啡')],
      config,
      signal: new AbortController().signal,
      onToken: () => undefined,
      pendingToolCalls: [
        {
          name: 'remember_fact',
          input: { content: '喜欢咖啡', sourceSessionId: 's1' },
        },
      ],
    })

    expect(store.listItems().some((item) => item.content === '喜欢咖啡')).toBe(true)

    const second = await runtime.run({
      sessionId: 's2',
      packageId: PKG,
      messages: [message('2', 's2', 'user', '你还记得我喜欢什么吗')],
      config,
      signal: new AbortController().signal,
      onToken: () => undefined,
    })
    expect(second).toContain('咖啡')
  })

  it('对话中由 planToolCalls 自动写入长期记忆', async () => {
    const { store, service, tools } = await createMemoryService()
    const planToolCalls = vi.fn(async () => ({
      toolCalls: [
        {
          name: 'remember_fact',
          input: { content: '一小时后提醒喝水' },
        },
      ],
    }))
    const runtime = new AgentRuntime(
      {
        stream: async (_messages, _config, _signal, onToken, systemPrompt) => {
          // 运行时只把"remember_fact：成功"注入工具结果提示，不复述内容；
          // 模型在读到成功结果后才确认已记住
          const reply = systemPrompt?.includes('remember_fact：成功')
            ? '好的，已记住提醒喝水'
            : '你好'
          onToken(reply)
          return reply
        },
        planToolCalls,
      },
      tools,
      service,
    )

    const reply = await runtime.run({
      sessionId: 'auto-1',
      packageId: PKG,
      messages: [message('1', 'auto-1', 'user', '一小时后提醒我喝水')],
      config,
      signal: new AbortController().signal,
      onToken: () => undefined,
    })

    expect(planToolCalls).toHaveBeenCalled()
    expect(store.listItems().some((item) => item.content.includes('提醒喝水'))).toBe(true)
    expect(reply).toContain('已记住')
  })

  it('planToolCalls 失败时仍可正常回复', async () => {
    const { service, tools } = await createMemoryService()
    const events: Array<{ toolName: string; ok?: boolean; errorCode?: string }> = []
    const runtime = new AgentRuntime(
      {
        stream: async (_messages, _config, _signal, onToken) => {
          onToken('照常回复')
          return '照常回复'
        },
        planToolCalls: async () => {
          throw new Error('plan failed')
        },
      },
      tools,
      service,
    )

    await expect(
      runtime.run({
        sessionId: 's-fail',
        packageId: PKG,
        messages: [message('1', 's-fail', 'user', '你好')],
        config,
        signal: new AbortController().signal,
        onToken: () => undefined,
        onToolEvent: (event) => {
          if (event.phase === 'end') {
            events.push({
              toolName: event.toolName,
              ok: event.ok,
              errorCode: event.errorCode,
            })
          }
        },
      }),
    ).resolves.toBe('照常回复')
    expect(events.some((item) => item.toolName === 'plan_tools' && item.ok === false)).toBe(true)
  })

  it('forget_memory 注册为 confirm 风险等级', async () => {
    const { tools } = await createMemoryService()
    expect(tools.getRiskLevel('forget_memory')).toBe('confirm')
  })

  it('importance 与关键词影响排序分数', () => {
    const low = scoreMemoryItem(
      {
        id: '1',
        type: 'fact',
        content: '天气不错',
        importance: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      '咖啡',
    )
    const high = scoreMemoryItem(
      {
        id: '2',
        type: 'fact',
        content: '喜欢喝咖啡',
        importance: 3,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      '咖啡',
    )
    expect(high).toBeGreaterThan(low)
  })

  it('长历史超过预算时基于完整历史生成会话摘要（修复触发失效）', async () => {
    const { service } = await createMemoryService()
    const messages: ChatMessage[] = []
    for (let i = 0; i < 200; i += 1) {
      messages.push(
        message(
          `m${i}`,
          's1',
          i % 2 === 0 ? 'user' : 'assistant',
          `第 ${i} 轮对话内容 ${'x'.repeat(100)}`,
        ),
      )
    }
    const assembled = await service.assemble({
      sessionId: 's1',
      packageId: PKG,
      messages,
      query: '测试',
      config,
      signal: new AbortController().signal,
      budget: 6_000,
    })
    expect(assembled.sessionSummary).toBeTruthy()
    expect(assembled.systemPrompt).toContain('早期对话要点')
    expect(assembled.recentMessages.length).toBeLessThan(messages.length)
  })

  it('可见窗口刚溢出即触发摘要（总量仍未超预算，消除丢消息无摘要区）', async () => {
    const { service } = await createMemoryService()
    const messages: ChatMessage[] = []
    for (let i = 0; i < 55; i += 1) {
      messages.push(
        message(
          `m${i}`,
          's1',
          i % 2 === 0 ? 'user' : 'assistant',
          `第 ${i} 轮对话 ${'x'.repeat(100)}`,
        ),
      )
    }
    // 总量 ≈5500 仍低于预算 6000，但可见窗口余量（≈4.9k）已把最早消息挤出 →
    // 摘要应在窗口溢出时触发，而不是等总量超预算后才生成
    const total = messages.reduce((sum, m) => sum + m.content.length, 0)
    expect(total).toBeLessThan(6_000)
    const assembled = await service.assemble({
      sessionId: 's1',
      packageId: PKG,
      messages,
      query: '测试',
      config,
      signal: new AbortController().signal,
      budget: 6_000,
    })
    expect(assembled.sessionSummary).toBeTruthy()
    expect(assembled.systemPrompt).toContain('早期对话要点')
  })

  it('AgentRuntime 基于裁剪前完整历史触发会话摘要', async () => {
    const { tools, service } = await createMemoryService()
    let seenSystemPrompt = ''
    const runtime = new AgentRuntime(
      {
        stream: async (_messages, _config, _signal, onToken, systemPrompt) => {
          seenSystemPrompt = systemPrompt ?? ''
          const reply = 'ok'
          onToken(reply)
          return reply
        },
      },
      tools,
      service,
      4_000,
    )
    const longMessages: ChatMessage[] = []
    for (let i = 0; i < 120; i += 1) {
      longMessages.push(
        message(
          `m${i}`,
          's1',
          i % 2 === 0 ? 'user' : 'assistant',
          `第${i}轮 ${'x'.repeat(80)}`,
        ),
      )
    }
    await runtime.run({
      sessionId: 's1',
      packageId: PKG,
      messages: longMessages,
      config,
      signal: new AbortController().signal,
      onToken: () => undefined,
    })
    expect(seenSystemPrompt).toContain('早期对话要点')
  })

  it('新增早期内容不足时复用旧摘要，不每轮重复调用摘要 LLM', async () => {
    const { store, tools } = await createMemoryService()
    const summarize = vi.fn(async (_messages: ChatMessage[]) => '人工生成的摘要')
    const service = new MemoryService(store, tools, summarize)

    const makeMessages = (count: number): ChatMessage[] => {
      const list: ChatMessage[] = []
      for (let i = 0; i < count; i += 1) {
        list.push(
          message(
            `m${i}`,
            's1',
            i % 2 === 0 ? 'user' : 'assistant',
            `第 ${i} 轮对话 ${'x'.repeat(100)}`,
          ),
        )
      }
      return list
    }

    const base = makeMessages(200)
    await service.assemble({
      sessionId: 's1',
      packageId: PKG,
      messages: base,
      query: '测试',
      config,
      signal: new AbortController().signal,
      budget: 6_000,
    })
    expect(summarize).toHaveBeenCalledTimes(1)

    // 只追加少量内容：新增未覆盖早期内容远低于闸门，复用旧摘要，不触发 LLM
    const extended = [
      ...base,
      message('m200', 's1', 'user', '补充一句'),
      message('m201', 's1', 'assistant', '好的'),
    ]
    await service.assemble({
      sessionId: 's1',
      packageId: PKG,
      messages: extended,
      query: '测试',
      config,
      signal: new AbortController().signal,
      budget: 6_000,
    })
    expect(summarize).toHaveBeenCalledTimes(1)

    // 大量新增早期内容：超过闸门，重新生成摘要
    const more = [...extended, ...makeMessages(300).slice(202)]
    await service.assemble({
      sessionId: 's1',
      packageId: PKG,
      messages: more,
      query: '测试',
      config,
      signal: new AbortController().signal,
      budget: 6_000,
    })
    expect(summarize.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('retrieve 按关键词命中，pinned 优先，并支持冲突 profile 覆盖', async () => {
    const { store, service } = await createMemoryService()
    await store.writeItem({
      type: 'fact',
      content: '用户养了一只橘猫',
      importance: 2,
    })
    await store.writeItem({
      type: 'fact',
      content: '用户喜欢徒步',
      importance: 2,
      pinned: true,
    })
    await store.writeItem({
      type: 'profile',
      key: 'user.job',
      content: '学生',
      importance: 2,
    })
    await store.writeItem({
      type: 'profile',
      key: 'user.job',
      content: '工程师',
      importance: 3,
    })

    const jobs = store.listItems().filter((item) => item.key === 'user.job')
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.content).toBe('工程师')

    const retrieved = await service.retrieve('橘猫', 5)
    expect(retrieved.some((item) => item.content.includes('橘猫'))).toBe(true)

    const emptyQuery = await service.retrieve('', 3)
    expect(emptyQuery[0]?.pinned).toBe(true)
  })

  it('无 dailyMeet 回调时零注入', async () => {
    const { service } = await createMemoryService()
    const assembled = await service.assemble({
      sessionId: 's1',
      packageId: PKG,
      messages: [message('1', 's1', 'user', '你好')],
      query: '你好',
      config,
      signal: new AbortController().signal,
      budget: 4_000,
    })
    expect(assembled.systemPrompt).not.toContain('今日首见')
    expect(assembled.systemPrompt).not.toContain('今日状态')
  })

  it('首次对话注入今日首见引导 + 日期', async () => {
    const { store, tools } = await createMemoryService()
    let lastMeet: string | null = null
    const service = new MemoryService(
      store,
      tools,
      undefined,
      () => '',
      undefined,
      {
        getLastMeetDate: () => lastMeet,
        setMeetToday: async (_packageId, date) => {
          lastMeet = date
        },
        now: () => new Date('2026-08-05T10:00:00'),
      },
    )
    const assembled = await service.assemble({
      sessionId: 's1',
      packageId: PKG,
      messages: [message('1', 's1', 'user', '你好')],
      query: '你好',
      config,
      signal: new AbortController().signal,
      budget: 4_000,
    })
    expect(assembled.systemPrompt).toContain('今日首见')
    expect(assembled.systemPrompt).toContain('2026年8月5日')
    expect(lastMeet).toBe('2026-08-05')
  })

  it('同日后续对话注入已见引导，不重复首见', async () => {
    const { store, tools } = await createMemoryService()
    let lastMeet: string | null = '2026-08-05'
    const service = new MemoryService(
      store,
      tools,
      undefined,
      () => '',
      undefined,
      {
        getLastMeetDate: () => lastMeet,
        setMeetToday: async (_packageId, date) => {
          lastMeet = date
        },
        now: () => new Date('2026-08-05T14:00:00'),
      },
    )
    const assembled = await service.assemble({
      sessionId: 's1',
      packageId: PKG,
      messages: [message('1', 's1', 'user', '又来了')],
      query: '又来了',
      config,
      signal: new AbortController().signal,
      budget: 4_000,
    })
    expect(assembled.systemPrompt).toContain('今日状态')
    expect(assembled.systemPrompt).toContain('除非主人主动询问')
    expect(assembled.systemPrompt).not.toContain('今日首见')
  })
})
