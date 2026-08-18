import type {
  AgentTool,
  ToolConfigOverride,
  ToolRiskLevel,
} from '../../src/chat/contracts'

export type ToolConfigOverrides = Record<string, ToolConfigOverride>

export type RegisteredToolMeta = {
  name: string
  description: string
  enabled: boolean
  riskLevel: ToolRiskLevel
  hasParameters: boolean
}

function resolveEnabled(
  tool: AgentTool,
  overrides: ToolConfigOverrides,
): boolean {
  const override = overrides[tool.name]?.enabled
  if (typeof override === 'boolean') return override
  return tool.enabled !== false
}

function resolveRiskLevel(tool: AgentTool): ToolRiskLevel {
  return tool.riskLevel === 'confirm' ? 'confirm' : 'safe'
}

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>()
  private overrides: ToolConfigOverrides = {}

  register(tool: AgentTool): void {
    if (!tool.name.trim()) throw new Error('工具名称不能为空')
    if (this.tools.has(tool.name)) throw new Error(`工具已注册：${tool.name}`)
    if (typeof tool.renderForModel !== 'function') {
      throw new Error(`工具 ${tool.name} 缺少 renderForModel，禁止注册（fail-fast）`)
    }
    this.tools.set(tool.name, tool)
  }

  /** 用本地配置覆盖 enabled；缺失项保持代码默认 */
  applyOverrides(overrides: ToolConfigOverrides): void {
    this.overrides = { ...overrides }
  }

  getOverrides(): ToolConfigOverrides {
    return { ...this.overrides }
  }

  list(): readonly AgentTool[] {
    return [...this.tools.values()]
  }

  listMeta(): RegisteredToolMeta[] {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      enabled: resolveEnabled(tool, this.overrides),
      riskLevel: resolveRiskLevel(tool),
      hasParameters: Boolean(tool.parameters),
    }))
  }

  /** 规划阶段仅暴露已启用且带 parameters 的工具 */
  listForPlanning(): AgentTool[] {
    return this.list().filter(
      (tool) => resolveEnabled(tool, this.overrides) && tool.parameters,
    )
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name)
  }

  isEnabled(name: string): boolean {
    const tool = this.tools.get(name)
    if (!tool) return false
    return resolveEnabled(tool, this.overrides)
  }

  getRiskLevel(name: string): ToolRiskLevel | undefined {
    const tool = this.tools.get(name)
    if (!tool) return undefined
    return resolveRiskLevel(tool)
  }

  /** 注销工具(技能卸载用)。幂等:未注册时静默。 */
  unregister(name: string): void {
    this.tools.delete(name)
  }
}

export const defaultToolRegistry = new ToolRegistry()
