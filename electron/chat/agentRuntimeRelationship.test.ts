import { describe, expect, it, vi } from 'vitest'
import type { AgentTool, ProviderRuntimeConfig } from '../../src/chat/contracts'
import {
  AgentRuntime,
  formatToolResultsForModel,
  hasRelationshipIntent,
  hasSuccessfulRelationshipWrite,
} from './agentRuntime'
import { ToolRegistry } from './toolRegistry'

/** 测试用：给工具注入默认 renderForModel 后再注册（避开 register() 的强制校验） */
function registerTestTool(registry: ToolRegistry, tool: AgentTool): void {
  registry.register({
    ...tool,
    renderForModel: tool.renderForModel ?? (() => `- ${tool.name}：成功`),
  })
}

const CONFIG: ProviderRuntimeConfig = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  apiKey: 'k',
}

describe('relationship intent routing', () => {
  it('识别关系/好感类意图，不误伤普通闲聊', () => {
    expect(hasRelationshipIntent('我们的关系越来越好了')).toBe(true)
    expect(hasRelationshipIntent('我更喜欢你了')).toBe(true)
    expect(hasRelationshipIntent('你对我态度变冷淡了')).toBe(true)
    expect(hasRelationshipIntent('今天天气不错')).toBe(false)
    expect(hasRelationshipIntent('帮我记住明天开会')).toBe(false)
  })

  it('识别成功的 update_relationship 写入', () => {
    expect(
      hasSuccessfulRelationshipWrite([
        JSON.stringify({ tool: 'update_relationship', ok: true, output: { affinity: 40 } }),
      ]),
    ).toBe(true)
    expect(
      hasSuccessfulRelationshipWrite([
        JSON.stringify({ tool: 'remember_fact', ok: true }),
      ]),
    ).toBe(false)
    expect(
      hasSuccessfulRelationshipWrite([
        JSON.stringify({ tool: 'update_relationship', ok: false, error: 'x' }),
      ]),
    ).toBe(false)
  })

  it('关系意图未写好感时强制据实说明', () => {
    const note = formatToolResultsForModel(
      [JSON.stringify({ tool: 'search_knowledge', ok: true })],
      '我们的关系越来越好了',
    )
    expect(note).toContain('update_relationship')
    expect(note).toContain('禁止声称已改变好感或关系状态')
  })

  it('关系已写成功时不追加约束', () => {
    const note = formatToolResultsForModel(
      [JSON.stringify({ tool: 'update_relationship', ok: true })],
      '我更喜欢你了',
    )
    expect(note).not.toContain('禁止声称已改变好感或关系状态')
  })

  it('普通闲聊不触发关系约束', () => {
    const note = formatToolResultsForModel(
      [JSON.stringify({ tool: 'search_knowledge', ok: true })],
      '今天天气不错',
    )
    expect(note).not.toContain('update_relationship')
  })

  it('planToolFilter 从规划集合剔除 update_relationship', async () => {
    const tools = new ToolRegistry()
    registerTestTool(tools, {
      name: 'update_relationship',
      description: 'r',
      enabled: true,
      riskLevel: 'safe',
      parameters: {
        type: 'object',
        properties: { delta: { type: 'number' } },
      },
      validate: (input) => input as never,
      execute: async () => ({ ok: true }),
    })
    registerTestTool(tools, {
      name: 'search_knowledge',
      description: 'k',
      enabled: true,
      riskLevel: 'safe',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
      },
      validate: (input) => input as never,
      execute: async () => ({ ok: true }),
    })
    const planToolCalls = vi.fn(async () => ({ toolCalls: [] }))
    const runtime = new AgentRuntime(
      { stream: async () => ({ text: '' }), planToolCalls },
      tools,
      undefined,
      24_000,
      (tool) => tool.name !== 'update_relationship',
    )
    await runtime.run({
      sessionId: 's',
      packageId: 'pkg',
      messages: [
        {
          id: '1',
          sessionId: 's',
          role: 'user',
          content: 'hi',
          status: 'complete',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      config: CONFIG,
      signal: new AbortController().signal,
      onToken: () => undefined,
    })
    const firstCall = planToolCalls.mock.calls[0] as unknown as
      | unknown[]
      | undefined
    const offered = (firstCall?.[4] ?? []) as Array<{ name: string }>
    expect(offered.map((tool) => tool.name).sort()).toEqual(['search_knowledge'])
    expect(offered.some((tool) => tool.name === 'update_relationship')).toBe(false)
  })

  it('无过滤时 update_relationship 仍进入规划集合', async () => {
    const tools = new ToolRegistry()
    registerTestTool(tools, {
      name: 'update_relationship',
      description: 'r',
      enabled: true,
      riskLevel: 'safe',
      parameters: {
        type: 'object',
        properties: { delta: { type: 'number' } },
      },
      validate: (input) => input as never,
      execute: async () => ({ ok: true }),
    })
    const planToolCalls = vi.fn(async () => ({ toolCalls: [] }))
    const runtime = new AgentRuntime(
      { stream: async () => ({ text: '' }), planToolCalls },
      tools,
    )
    await runtime.run({
      sessionId: 's',
      packageId: 'pkg',
      messages: [
        {
          id: '1',
          sessionId: 's',
          role: 'user',
          content: 'hi',
          status: 'complete',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      config: CONFIG,
      signal: new AbortController().signal,
      onToken: () => undefined,
    })
    const firstCall = planToolCalls.mock.calls[0] as unknown as
      | unknown[]
      | undefined
    const offered = (firstCall?.[4] ?? []) as Array<{ name: string }>
    expect(offered.some((tool) => tool.name === 'update_relationship')).toBe(true)
  })
})
