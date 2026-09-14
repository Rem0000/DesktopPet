import type { TokenUsage } from './contracts'

/**
 * 用量展示格式化（聊天窗与追踪台共用）。
 * 只呈现 token 计数；provider 未返回用量时带「估算」标注。
 */
export function formatUsage(usage: TokenUsage | undefined): string {
  if (!usage) return '—'
  const parts = [
    `in ${usage.inputTokens}`,
    `out ${usage.outputTokens}`,
    `cache-r ${usage.cacheReadTokens}`,
    `reasoning ${usage.reasoningTokens}`,
  ]
  if (usage.cacheWriteTokens > 0) parts.push(`cache-w ${usage.cacheWriteTokens}`)
  return `${parts.join(' · ')}${usage.estimated ? '（估算）' : ''}`
}
