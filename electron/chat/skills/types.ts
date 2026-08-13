import type { AgentTool } from '../../../src/chat/contracts'

/**
 * 技能索引(第一层,常驻):启动时扫描 skill.md frontmatter 得到,
 * 不读正文、不加载 script。供 skillRouter 触发判断与 skills:list 展示。
 */
export type SkillIndex = {
  id: string
  name: string
  description: string
  /** 逗号分隔的触发词,如 "累,烦,开心,难过" */
  trigger: string
  /** 优先级:数值越大越优先;情绪类技能通常设为最高 */
  priority: number
  /** skill.md 的绝对路径 */
  skillMdPath: string
  /** 技能根目录的绝对路径 */
  rootDir: string
}

/**
 * 技能模块(第二层 + 第三层):命中时动态加载。
 * rules 为 skill.md 正文,注入提示词;tools 为 script 里创建的工具(注册进 ToolRegistry)。
 */
export type SkillModule = {
  id: string
  name: string
  rules: string
  tools: AgentTool[]
}

/**
 * 技能路由钩子:由 AgentRuntime.recall 节点调用。
 * 输入最新用户消息,返回应激活的技能;无命中返回 null。
 */
export type SkillRouteHit = {
  skill: SkillIndex
  /** 注入 systemPrompt 的规则文本 */
  rulesText: string
  /** 命中技能的已加载工具,由调用方注册进 ToolRegistry */
  tools: AgentTool[]
}

export type SkillRouter = {
  route: (
    userText: string,
    signal?: AbortSignal,
  ) => Promise<SkillRouteHit | null>
}

/** skill.md 脚本模块的导出形状 */
export type SkillScriptModule = {
  createTools: () => AgentTool[]
}
