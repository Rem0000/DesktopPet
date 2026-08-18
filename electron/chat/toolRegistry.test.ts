import { describe, expect, it } from 'vitest'
import { ToolRegistry } from './toolRegistry'
import type { AgentTool } from '../../src/chat/contracts'

function makeTool(
  name: string,
  options: Partial<Pick<AgentTool, 'enabled' | 'riskLevel' | 'parameters' | 'renderForModel'>> & {
    omitParameters?: boolean
    omitRenderForModel?: boolean
  } = {},
): AgentTool {
  return {
    name,
    description: `${name} tool`,
    enabled: options.enabled,
    riskLevel: options.riskLevel,
    parameters: options.omitParameters
      ? undefined
      : (options.parameters ?? {
          type: 'object',
          properties: {},
          additionalProperties: false,
        }),
    renderForModel: options.omitRenderForModel
      ? undefined
      : (options.renderForModel ?? (() => `- ${name}：成功`)),
    validate: (input) => input,
    execute: async (input) => input,
  }
}

describe('ToolRegistry', () => {
  it('注册工具并拒绝重名与空名', () => {
    const registry = new ToolRegistry()
    registry.register(makeTool('alpha'))
    expect(() => registry.register(makeTool('alpha'))).toThrow(/已注册/)
    expect(() => registry.register(makeTool('  '))).toThrow(/不能为空/)
    expect(registry.list()).toHaveLength(1)
  })

  it('默认启用；配置覆盖可禁用，禁用工具不进入规划列表', () => {
    const registry = new ToolRegistry()
    registry.register(makeTool('remember_fact'))
    registry.register(makeTool('draft_only', { omitParameters: true }))
    expect(registry.isEnabled('remember_fact')).toBe(true)
    expect(registry.listForPlanning().map((tool) => tool.name)).toEqual(['remember_fact'])

    registry.applyOverrides({ remember_fact: { enabled: false } })
    expect(registry.isEnabled('remember_fact')).toBe(false)
    expect(registry.listForPlanning()).toHaveLength(0)
    expect(registry.listMeta().find((item) => item.name === 'remember_fact')?.enabled).toBe(
      false,
    )
  })

  it('注册缺 renderForModel 的工具抛错（fail-fast，不静默退化）', () => {
    const registry = new ToolRegistry()
    expect(() =>
      registry.register(makeTool('no_renderer', { omitRenderForModel: true })),
    ).toThrow(/renderForModel/)
    expect(registry.get('no_renderer')).toBeUndefined()
    expect(registry.list()).toHaveLength(0)
  })

  it('代码默认 enabled=false 时配置可重新打开', () => {
    const registry = new ToolRegistry()
    registry.register(makeTool('experimental', { enabled: false, riskLevel: 'confirm' }))
    expect(registry.isEnabled('experimental')).toBe(false)
    registry.applyOverrides({ experimental: { enabled: true } })
    expect(registry.isEnabled('experimental')).toBe(true)
    expect(registry.getRiskLevel('experimental')).toBe('confirm')
  })
})
