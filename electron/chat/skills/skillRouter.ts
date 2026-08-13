import type { SkillIndex, SkillRouteHit, SkillRouter } from './types'
import type { SkillRegistry } from './skillRegistry'
import type { ToolRegistry } from '../toolRegistry'

/** 用户明确结束当前技能的关键词(游戏终止、退出) */
const EXIT_KEYWORDS = ['不玩了', '算了', '结束', '退出', '不猜了', '不猜', '停一下', '够了']

/**
 * 默认技能路由:对最新用户输入做确定性触发词扫描。
 * - 无激活技能 + 命中触发词 → 激活该技能,注册其工具。
 * - 有激活技能 + 更高优先级命中(如游戏中表达情绪)→ 先卸载旧技能再切换(互斥)。
 * - 有激活技能 + 命中退出关键词 → 卸载,回到默认闲聊。
 * - 有激活技能 + 无更高优先级命中 → 保持激活(游戏延续 / 共情延续),返回其规则。
 * 工具的注册与注销由本路由负责;加载失败不抛出,按未命中处理。
 */
export function createSkillRouter(
  registry: SkillRegistry,
  toolRegistry: ToolRegistry,
): SkillRouter {
  let registeredTools: string[] = []

  function unregisterAll(): void {
    for (const name of registeredTools) toolRegistry.unregister(name)
    registeredTools = []
  }

  async function activateSkill(index: SkillIndex): Promise<SkillRouteHit | null> {
    try {
      const module = await registry.activate(index.id)
      unregisterAll()
      for (const tool of module.tools) {
        try {
          toolRegistry.register(tool)
          registeredTools.push(tool.name)
        } catch {
          // 工具重名时跳过(已有同名工具优先)
        }
      }
      return { skill: index, rulesText: buildRulesText(index, module.rules), tools: module.tools }
    } catch (error) {
      console.error('[skills] 加载技能失败:', index.id, error)
      return null
    }
  }

  return {
    async route(userText): Promise<SkillRouteHit | null> {
      const text = (userText || '').trim()
      if (!text) return null

      const active = registry.getActiveId()
      const activeIndex = active ? registry.getIndex(active) : undefined

      // 命中退出关键词 → 卸载当前技能
      if (activeIndex && EXIT_KEYWORDS.some((keyword) => text.includes(keyword))) {
        registry.deactivate(activeIndex.id)
        unregisterAll()
        return null
      }

      // 触发词扫描,按优先级降序
      const hit = registry
        .listIndices()
        .filter((index) => matchesTrigger(index, text))
        .sort((a, b) => b.priority - a.priority)[0]

      // 无激活 + 命中 → 激活
      if (!activeIndex && hit) return activateSkill(hit)
      // 有激活 + 更高优先级命中 → 切换(互斥;情绪技能优先级通常高于游戏)
      if (activeIndex && hit && hit.priority > activeIndex.priority) {
        registry.deactivate(activeIndex.id)
        unregisterAll()
        return activateSkill(hit)
      }
      // 有激活 + 无更高优先级命中 → 保持激活(返回规则让模型延续)
      if (activeIndex) {
        try {
          const module = await registry.ensureLoaded(activeIndex.id)
          return {
            skill: activeIndex,
            rulesText: buildRulesText(activeIndex, module.rules),
            tools: module.tools,
          }
        } catch {
          return null
        }
      }
      return null
    },
  }
}

function matchesTrigger(index: SkillIndex, text: string): boolean {
  if (!index.trigger) return false
  const keywords = index.trigger
    .split(/[,，]/)
    .map((keyword) => keyword.trim())
    .filter(Boolean)
  return keywords.some((keyword) => text.includes(keyword))
}

function buildRulesText(index: SkillIndex, rules: string): string {
  return [
    `【当前激活技能 — ${index.name}】`,
    rules,
    '',
    `(技能触发词:${index.trigger || '无'};若用户明确想结束本技能,立即退出回到普通闲聊)`,
  ].join('\n')
}
