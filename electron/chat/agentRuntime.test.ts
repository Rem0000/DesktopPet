import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage, ProviderRuntimeConfig } from '../../src/chat/contracts'
import {
  AgentRuntime,
  dedupePendingToolCalls,
  formatToolResultsForModel,
  hasRememberIntent,
  hasSuccessfulMemoryWrite,
  isPersonaStyleRememberRequest,
  trimContext,
  type AgentProvider,
} from './agentRuntime'
import { PLAN_TOOL_INSTRUCTION } from './deepSeekProvider'
import { ToolRegistry } from './toolRegistry'

const config: ProviderRuntimeConfig = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  apiKey: 'test-key',
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

describe('AgentRuntime', () => {
  it('裁剪早期历史并保留当前用户消息', () => {
    const messages = [
      message('1', 'a', 'user', '12345'),
      message('2', 'a', 'assistant', '67890'),
      message('3', 'a', 'user', 'current'),
    ]
    expect(trimContext(messages, 8).map((item) => item.id)).toEqual(['3'])
  })

  it('按调用传入的会话历史运行且默认工具表为空', async () => {
    const stream = vi.fn<AgentProvider['stream']>(async (messages, _config, _signal, onToken) => {
      const reply = `回复:${messages.at(-1)?.content}`
      onToken(reply)
      return reply
    })
    const tools = new ToolRegistry()
    const runtime = new AgentRuntime({ stream }, tools)
    const controller = new AbortController()

    const first = await runtime.run({
      sessionId: 'a',
      packageId: 'pkg-a',
      messages: [message('1', 'a', 'user', '你好')],
      config,
      signal: controller.signal,
      onToken: () => undefined,
    })
    const second = await runtime.run({
      sessionId: 'b',
      packageId: 'pkg-b',
      messages: [message('2', 'b', 'user', '天气')],
      config,
      signal: controller.signal,
      onToken: () => undefined,
    })

    expect(first).toBe('回复:你好')
    expect(second).toBe('回复:天气')
    expect(stream.mock.calls[0]?.[0]).toHaveLength(1)
    expect(stream.mock.calls[1]?.[0][0]?.sessionId).toBe('b')
    expect(tools.list()).toHaveLength(0)
  })

  it('模型异常会向调用方传播而不提交伪回复', async () => {
    const runtime = new AgentRuntime(
      {
        stream: async () => {
          throw new Error('provider failed')
        },
      },
      new ToolRegistry(),
    )
    await expect(
      runtime.run({
        sessionId: 'a',
        packageId: 'pkg-a',
        messages: [message('1', 'a', 'user', '你好')],
        config,
        signal: new AbortController().signal,
        onToken: () => undefined,
      }),
    ).rejects.toThrow('provider failed')
  })

  it('执行白名单工具并上报开始/结束观测事件', async () => {
    const tools = new ToolRegistry()
    tools.register({
      name: 'remember_fact',
      description: '记住事实',
      enabled: true,
      riskLevel: 'safe',
      parameters: {
        type: 'object',
        properties: { content: { type: 'string' } },
        required: ['content'],
      },
      validate: (input) => {
        if (!input || typeof input !== 'object') throw new Error('参数无效')
        return input as { content: string }
      },
      execute: async (input) => ({ ok: true, content: (input as { content: string }).content }),
    })
    const events: Array<{ phase: string; toolName: string; ok?: boolean }> = []
    const runtime = new AgentRuntime(
      {
        stream: async (_messages, _config, _signal, onToken) => {
          onToken('记下了')
          return '记下了'
        },
      },
      tools,
    )
    const reply = await runtime.run({
      sessionId: 'a',
      packageId: 'pkg-a',
      messages: [message('1', 'a', 'user', '记住我喜欢猫')],
      config,
      signal: new AbortController().signal,
      onToken: () => undefined,
      pendingToolCalls: [{ name: 'remember_fact', input: { content: '喜欢猫' } }],
      onToolEvent: (event) => {
        events.push({
          phase: event.phase,
          toolName: event.toolName,
          ok: event.phase === 'end' ? event.ok : undefined,
        })
      },
    })
    expect(reply).toBe('记下了')
    expect(events).toEqual([
      { phase: 'start', toolName: 'remember_fact', ok: undefined },
      { phase: 'end', toolName: 'remember_fact', ok: true },
    ])
  })

  it('禁用工具时返回失败观测且不执行', async () => {
    const tools = new ToolRegistry()
    let executed = false
    tools.register({
      name: 'remember_fact',
      description: '记住事实',
      enabled: true,
      parameters: { type: 'object', properties: {} },
      validate: (input) => input,
      execute: async (input) => {
        executed = true
        return input
      },
    })
    tools.applyOverrides({ remember_fact: { enabled: false } })
    const events: Array<{ phase: string; ok?: boolean; errorCode?: string }> = []
    const runtime = new AgentRuntime(
      {
        stream: async (_m, _c, _s, onToken) => {
          onToken('ok')
          return 'ok'
        },
      },
      tools,
    )
    await runtime.run({
      sessionId: 'a',
      packageId: 'pkg-a',
      messages: [message('1', 'a', 'user', 'hi')],
      config,
      signal: new AbortController().signal,
      onToken: () => undefined,
      pendingToolCalls: [{ name: 'remember_fact', input: {} }],
      onToolEvent: (event) => {
        events.push({
          phase: event.phase,
          ok: event.phase === 'end' ? event.ok : undefined,
          errorCode: event.phase === 'end' ? event.errorCode : undefined,
        })
      },
    })
    expect(executed).toBe(false)
    expect(events.at(-1)).toMatchObject({ phase: 'end', ok: false, errorCode: 'disabled' })
  })

  it('confirm 工具在用户拒绝时不执行', async () => {
    const tools = new ToolRegistry()
    let executed = false
    tools.register({
      name: 'forget_memory',
      description: '遗忘',
      enabled: true,
      riskLevel: 'confirm',
      parameters: { type: 'object', properties: { id: { type: 'string' } } },
      validate: (input) => input,
      execute: async (input) => {
        executed = true
        return input
      },
    })
    const runtime = new AgentRuntime(
      {
        stream: async (_m, _c, _s, onToken) => {
          onToken('已取消')
          return '已取消'
        },
      },
      tools,
    )
    const events: Array<{ ok?: boolean; errorCode?: string }> = []
    await runtime.run({
      sessionId: 'a',
      packageId: 'pkg',
      messages: [message('1', 'a', 'user', '忘掉那条')],
      config,
      signal: new AbortController().signal,
      onToken: () => undefined,
      pendingToolCalls: [{ name: 'forget_memory', input: { id: 'm1' } }],
      confirmTool: async () => false,
      onToolEvent: (event) => {
        if (event.phase === 'end') {
          events.push({ ok: event.ok, errorCode: event.errorCode })
        }
      },
    })
    expect(executed).toBe(false)
    expect(events.at(-1)).toMatchObject({ ok: false, errorCode: 'cancelled' })
  })

  it('支持第二轮再规划工具（先检索再写记忆）并在超限后停止', async () => {
    const tools = new ToolRegistry()
    const executed: string[] = []
    tools.register({
      name: 'search_knowledge',
      description: '检索',
      enabled: true,
      riskLevel: 'safe',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
      validate: (input) => input,
      execute: async () => {
        executed.push('search_knowledge')
        return { hits: [{ content: '文档说喜欢猫' }] }
      },
    })
    tools.register({
      name: 'remember_fact',
      description: '记住',
      enabled: true,
      riskLevel: 'safe',
      parameters: { type: 'object', properties: { content: { type: 'string' } } },
      validate: (input) => input,
      execute: async () => {
        executed.push('remember_fact')
        return { ok: true }
      },
    })
    let planRound = 0
    const runtime = new AgentRuntime(
      {
        stream: async (_m, _c, _s, onToken) => {
          onToken('完成')
          return '完成'
        },
        planToolCalls: async () => {
          planRound += 1
          if (planRound === 1) {
            return { toolCalls: [{ name: 'search_knowledge', input: { query: '猫' } }] }
          }
          if (planRound === 2) {
            return {
              toolCalls: [{ name: 'remember_fact', input: { content: '喜欢猫' } }],
            }
          }
          return { toolCalls: [{ name: 'remember_fact', input: { content: '不应执行' } }] }
        },
      },
      tools,
    )
    await runtime.run({
      sessionId: 'a',
      packageId: 'pkg',
      messages: [message('1', 'a', 'user', '查文档并记住')],
      config,
      signal: new AbortController().signal,
      onToken: () => undefined,
    })
    expect(executed).toEqual(['search_knowledge', 'remember_fact'])
    expect(planRound).toBe(2)
  })

  it('dedupePendingToolCalls 去掉同名同参重复调用', () => {
    const calls = dedupePendingToolCalls([
      { name: 'remember_fact', input: { content: '喜欢猫', sourceSessionId: 'a' } },
      { name: 'remember_fact', input: { content: '喜欢猫', sourceSessionId: 'b' } },
      { name: 'remember_fact', input: { content: '喜欢狗' } },
    ])
    expect(calls).toHaveLength(2)
    expect(calls.map((c) => (c.input as { content: string }).content)).toEqual([
      '喜欢猫',
      '喜欢狗',
    ])
  })

  it('formatToolResultsForModel 在取消 forget 时禁止口头已忘记', () => {
    const note = formatToolResultsForModel([
      JSON.stringify({
        tool: 'forget_memory',
        ok: false,
        errorCode: 'cancelled',
        error: '用户取消确认：记忆未被删除',
      }),
    ])
    expect(note).toContain('未被删除')
    expect(note).toContain('禁止声称已经忘记')
  })

  it('formatToolResultsForModel 注入 search_history 命中原文，供模型逐字引用', () => {
    const note = formatToolResultsForModel([
      JSON.stringify({
        tool: 'search_history',
        ok: true,
        output: {
          hits: [
            { messageId: 'm1', excerpt: '我其实更喜欢喝美式咖啡' },
            { messageId: 'm2', excerpt: '上次说的那个功能还没做完' },
          ],
        },
      }),
    ])
    expect(note).toContain('找到 2 条历史记录')
    expect(note).toContain('我其实更喜欢喝美式咖啡')
    expect(note).toContain('上次说的那个功能还没做完')
    expect(note).toContain('逐字取自')
  })

  it('识别记住意图与输出规范类记住请求', () => {
    expect(hasRememberIntent('另外，记住我喜欢简洁的回答。')).toBe(true)
    expect(isPersonaStyleRememberRequest('另外，记住我喜欢简洁的回答。')).toBe(true)
    expect(isPersonaStyleRememberRequest('请记住验收结论是七项通过')).toBe(false)
    expect(hasSuccessfulMemoryWrite([])).toBe(false)
    expect(
      hasSuccessfulMemoryWrite([
        JSON.stringify({ tool: 'search_knowledge', ok: true, output: { hits: [] } }),
      ]),
    ).toBe(false)
    expect(
      hasSuccessfulMemoryWrite([
        JSON.stringify({ tool: 'remember_fact', ok: true, output: { ok: true } }),
      ]),
    ).toBe(true)
  })

  it('仅检索成功时禁止口头声称已记住（事实类）', () => {
    const note = formatToolResultsForModel(
      [JSON.stringify({ tool: 'search_knowledge', ok: true, output: { hits: [] } })],
      '验收标准是什么？另外把结论记住。',
    )
    expect(note).toContain('search_knowledge')
    expect(note).toContain('没有成功的 remember_fact')
    expect(note).toContain('禁止声称已经记住')
  })

  it('输出规范类记住请求未写记忆时引导改人设并禁止口头已记住', () => {
    const note = formatToolResultsForModel(
      [JSON.stringify({ tool: 'search_knowledge', ok: true, output: { hits: [] } })],
      'Brand端充值模块优化的验收标准是什么？另外，记住我喜欢简洁的回答。',
    )
    expect(note).toContain('编辑人设')
    expect(note).toContain('禁止声称已经记住')
    expect(note).not.toContain('没有成功的 remember_fact')
  })

  it('规划提示覆盖同轮多意图与禁止口头已记住', () => {
    expect(PLAN_TOOL_INSTRUCTION).toContain('同轮并行')
    expect(PLAN_TOOL_INSTRUCTION).toContain('禁止只用口头声称已记住')
    expect(PLAN_TOOL_INSTRUCTION).toContain('回答要简洁')
  })

  it('检索后未写记忆时注入生成侧约束到 systemPrompt', async () => {
    const tools = new ToolRegistry()
    tools.register({
      name: 'search_knowledge',
      description: '检索',
      enabled: true,
      riskLevel: 'safe',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
      validate: (input) => input,
      execute: async () => ({ hits: [] }),
    })
    tools.register({
      name: 'remember_fact',
      description: '记住',
      enabled: true,
      riskLevel: 'safe',
      parameters: { type: 'object', properties: { content: { type: 'string' } } },
      validate: (input) => input,
      execute: async () => ({ ok: true }),
    })
    let capturedSystem = ''
    let planRound = 0
    const runtime = new AgentRuntime(
      {
        stream: async (_m, _c, _s, onToken, systemPrompt) => {
          capturedSystem = systemPrompt ?? ''
          onToken('答')
          return '答'
        },
        planToolCalls: async () => {
          planRound += 1
          if (planRound === 1) {
            return { toolCalls: [{ name: 'search_knowledge', input: { query: '验收' } }] }
          }
          return { toolCalls: [] }
        },
      },
      tools,
    )
    await runtime.run({
      sessionId: 'a',
      packageId: 'pkg',
      messages: [
        message(
          '1',
          'a',
          'user',
          'Brand端充值模块优化的验收标准是什么？另外，记住我喜欢简洁的回答。',
        ),
      ],
      config,
      signal: new AbortController().signal,
      onToken: () => undefined,
    })
    expect(planRound).toBe(2)
    expect(capturedSystem).toContain('编辑人设')
    expect(capturedSystem).toContain('禁止声称已经记住')
  })

  it('再规划提示对事实类记住要求 MUST 规划记忆工具', async () => {
    const tools = new ToolRegistry()
    tools.register({
      name: 'search_knowledge',
      description: '检索',
      enabled: true,
      riskLevel: 'safe',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
      validate: (input) => input,
      execute: async () => ({ hits: [{ content: '七项验收' }] }),
    })
    tools.register({
      name: 'remember_fact',
      description: '记住',
      enabled: true,
      riskLevel: 'safe',
      parameters: { type: 'object', properties: { content: { type: 'string' } } },
      validate: (input) => input,
      execute: async () => ({ ok: true }),
    })
    let replanSystem = ''
    let planRound = 0
    const runtime = new AgentRuntime(
      {
        stream: async (_m, _c, _s, onToken) => {
          onToken('好')
          return '好'
        },
        planToolCalls: async (_messages, _config, _signal, systemPrompt) => {
          planRound += 1
          if (planRound === 1) {
            return { toolCalls: [{ name: 'search_knowledge', input: { query: '验收' } }] }
          }
          replanSystem = systemPrompt
          return {
            toolCalls: [{ name: 'remember_fact', input: { content: '验收共七项' } }],
          }
        },
      },
      tools,
    )
    await runtime.run({
      sessionId: 'a',
      packageId: 'pkg',
      messages: [message('1', 'a', 'user', '验收标准是什么？另外把结论记住。')],
      config,
      signal: new AbortController().signal,
      onToken: () => undefined,
    })
    expect(planRound).toBe(2)
    expect(replanSystem).toContain('MUST 规划对应记忆工具')
    expect(replanSystem).toContain('禁止只用口头声称已记住')
  })

  it('取消 forget_memory 时注入的 system 约束含取消语义', async () => {
    const tools = new ToolRegistry()
    tools.register({
      name: 'forget_memory',
      description: '遗忘',
      enabled: true,
      riskLevel: 'confirm',
      parameters: { type: 'object', properties: { id: { type: 'string' } } },
      validate: (input) => input,
      execute: async () => ({ ok: true }),
    })
    let capturedSystem = ''
    const runtime = new AgentRuntime(
      {
        stream: async (_m, _c, _s, onToken, systemPrompt) => {
          capturedSystem = systemPrompt ?? ''
          onToken('已取消')
          return '已取消'
        },
      },
      tools,
    )
    await runtime.run({
      sessionId: 'a',
      packageId: 'pkg',
      messages: [message('1', 'a', 'user', '忘掉')],
      config,
      signal: new AbortController().signal,
      onToken: () => undefined,
      pendingToolCalls: [{ name: 'forget_memory', input: { id: 'm1' } }],
      confirmTool: async () => false,
    })
    expect(capturedSystem).toContain('取消')
    expect(capturedSystem).toContain('未被删除')
  })

  it('仅 remember_fact 时不二次规划，避免双写', async () => {
    const tools = new ToolRegistry()
    let executed = 0
    tools.register({
      name: 'remember_fact',
      description: '记住',
      enabled: true,
      riskLevel: 'safe',
      parameters: { type: 'object', properties: { content: { type: 'string' } } },
      validate: (input) => input,
      execute: async () => {
        executed += 1
        return { ok: true }
      },
    })
    let planRound = 0
    const runtime = new AgentRuntime(
      {
        stream: async (_m, _c, _s, onToken) => {
          onToken('好')
          return '好'
        },
        planToolCalls: async () => {
          planRound += 1
          return {
            toolCalls: [
              { name: 'remember_fact', input: { content: '爱好' } },
              { name: 'remember_fact', input: { content: '爱好' } },
            ],
          }
        },
      },
      tools,
    )
    await runtime.run({
      sessionId: 'a',
      packageId: 'pkg',
      messages: [message('1', 'a', 'user', '请记住我这个爱好')],
      config,
      signal: new AbortController().signal,
      onToken: () => undefined,
    })
    expect(executed).toBe(1)
    expect(planRound).toBe(1)
  })
})
