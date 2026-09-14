import type { ContextUsage, ContextUsagePart } from '../../src/chat/contracts'
import type { TraceContextProjection } from '../../src/trace/contracts'

/** 上下文按来源拆分（对齐 Claude Code 的 Messages / System tools / System prompt / Memory files / Skills） */
export type ContextSectionBreakdown = {
  /** 系统提示词（人设 / 关系 / 每日状态 / 会话摘要） */
  systemPromptCharacters: number
  /** 规划期注入模型的工具目录（含记忆遗忘列表） */
  systemToolsCharacters: number
  /** 技能规则注入 */
  skillsCharacters: number
  /** 长期记忆检索块（含跨模型共享画像与事实） */
  memoryCharacters: number
  /** 近期消息窗口 */
  messagesCharacters: number
}

/** 组装观测：一次完整 recall → model 组装过程中的各来源占用 */
export type ContextObservation = ContextSectionBreakdown & {
  sessionId: string
  packageId: string
}

export const CONTEXT_USAGE_PARTS = [
  { key: 'messages', label: '消息' },
  { key: 'systemTools', label: 'System tools' },
  { key: 'systemPrompt', label: 'System prompt' },
  { key: 'memory', label: 'Memory files' },
  { key: 'skills', label: 'Skills' },
] as const satisfies ReadonlyArray<{
  key: ContextUsagePart['key']
  label: string
}>

export function emptyContextSectionBreakdown(): ContextSectionBreakdown {
  return {
    systemPromptCharacters: 0,
    systemToolsCharacters: 0,
    skillsCharacters: 0,
    memoryCharacters: 0,
    messagesCharacters: 0,
  }
}

/**
 * 将一次组装观测换算成 ContextUsage（按预算字符与拆分项渲染占比）。
 * 预算以字符计；used 的估算以「窗口可见内容」为准，供 UI 观测。
 */
export function breakdownToUsage(
  breakdown: ContextSectionBreakdown | undefined,
  budgetCharacters: number,
): ContextUsage {
  if (!breakdown) {
    return {
      budgetCharacters,
      usedCharacters: 0,
      ratio: 0,
      parts: CONTEXT_USAGE_PARTS.map((part) => ({ ...part, characters: 0 })),
      observed: false,
    }
  }
  const usedCharacters =
    breakdown.systemPromptCharacters +
    breakdown.systemToolsCharacters +
    breakdown.skillsCharacters +
    breakdown.memoryCharacters +
    breakdown.messagesCharacters
  return {
    budgetCharacters,
    usedCharacters,
    ratio: budgetCharacters > 0 ? Math.min(1, usedCharacters / budgetCharacters) : 0,
    parts: CONTEXT_USAGE_PARTS.map((part) => ({
      key: part.key,
      label: part.label,
      characters: breakdown[`${part.key}Characters` as keyof ContextSectionBreakdown],
    })),
    observed: true,
  }
}

/**
 * 把链路日志折叠出的上下文压力投影换算为聊天窗使用的 ContextUsage。
 * 与 breakdownToUsage 同构，但数据来自「按次落盘」的 `request/context` 事件而非内存快照。
 */
export function projectionToUsage(projection: TraceContextProjection): ContextUsage {
  const breakdown: ContextSectionBreakdown = {
    systemPromptCharacters: projection.parts.systemPrompt,
    systemToolsCharacters: projection.parts.systemTools,
    skillsCharacters: projection.parts.skills,
    memoryCharacters: projection.parts.memory,
    messagesCharacters: projection.parts.messages,
  }
  return breakdownToUsage(breakdown, projection.budgetCharacters)
}

/** 会话级上下文占用表：key = `${packageId}/${sessionId}`，仅最近一次组装观测 */export class ContextUsageTracker {
  private readonly bySession = new Map<string, ContextObservation>()

  private keyOf(sessionId: string, packageId: string): string {
    return `${packageId}/${sessionId}`
  }

  record(observation: ContextObservation): void {
    this.bySession.set(this.keyOf(observation.sessionId, observation.packageId), observation)
  }

  get(sessionId: string, packageId?: string): ContextObservation | undefined {
    const prefix = packageId ? `${packageId}/` : ''
    const exact = this.bySession.get(`${prefix}${sessionId}`)
    if (exact) return exact
    // 回退：仅按会话 id 查（不同包下同 id 概率极低，且删除包时整体清除）
    for (const [key, value] of this.bySession) {
      if (key.endsWith(`/${sessionId}`)) return value
    }
    return undefined
  }

  deleteSession(sessionId: string): void {
    for (const key of this.bySession.keys()) {
      if (key.endsWith(`/${sessionId}`)) this.bySession.delete(key)
    }
  }

  clearPackage(packageId: string): void {
    for (const key of this.bySession.keys()) {
      if (key.startsWith(`${packageId}/`)) this.bySession.delete(key)
    }
  }
}
