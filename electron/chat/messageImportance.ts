import type { ChatMessage, MemoryImportance } from '../../src/chat/contracts'

/** 消息级重要性（1 低 / 2 中 / 3 高）；写入期启发式打分，超预算裁剪时窗口外高重要性优先保留 */
export type MessageImportanceMeta = {
  /** 助手消息本轮是否携带成功工具调用（加分） */
  hasToolSuccess?: boolean
}

/**
 * 关键事实/决策/约定/身份信息等「值得长期记住」的信号。
 * 命中即重要性 3；保守起见只匹配明确表达。普通闲聊默认 2，纯寒暄/空泛默认 1。
 */
export const KEY_FACT_PATTERN =
  /(我是|我的(名字|姓名|生日|职业|公司|学校|家乡|地址|电话|邮箱)|决定|约定|答应|希望|计划|目标|考研|求职|喜欢|讨厌|需要|记得|别忘了|之后|下周|明天)/

const LOW_VALUE_PATTERN = /^(哈哈|嗯嗯|好的|好呀|哦|知道了|早上好|晚安|在吗|你好|嗨|拜拜|再见|谢谢|没关系|是的|对|嗯)$/

export function scoreMessageImportance(
  text: string,
  role: ChatMessage['role'],
  meta: MessageImportanceMeta = {},
): MemoryImportance {
  const trimmed = text.trim()
  if (!trimmed) return 2
  if (role === 'user') {
    if (KEY_FACT_PATTERN.test(trimmed)) return 3
    if (trimmed.length <= 6 && LOW_VALUE_PATTERN.test(trimmed)) return 1
    // 含问号/数字/较长内容视为信息量较高
    if (trimmed.length >= 40 || /[？?]/.test(trimmed) || /\d/.test(trimmed)) return 3
    return 2
  }
  if (meta.hasToolSuccess) return 3
  if (trimmed.length >= 80) return 3
  return 2
}

export type TrimOptions = {
  /** 保留最近多少字符的逐字窗口（窗口内不看重要性，全保） */
  recentWindowChars: number
  /** true 时窗口外按 importance 3→2→1 优先补齐；false 回退纯 recency */
  importanceTrim: boolean
}

export function defaultTrimOptions(budget: number): TrimOptions {
  return {
    recentWindowChars: Math.floor(budget * 0.7),
    importanceTrim: true,
  }
}

/**
 * 重要性加权裁剪：从最新往回尽量取满近期窗口（逐字保序）；
 * 剩余预算按 importance 高→低从窗口外补齐；始终保留最新一条；输出保持原始时序。
 */
export function trimContextWeighted(
  messages: ChatMessage[],
  budget: number,
  options?: Partial<TrimOptions>,
): ChatMessage[] {
  const opts: TrimOptions = {
    recentWindowChars: options?.recentWindowChars ?? defaultTrimOptions(budget).recentWindowChars,
    importanceTrim: options?.importanceTrim ?? true,
  }
  const eligible = messages.filter(
    (message) => message.status === 'complete' && message.content.trim(),
  )
  if (eligible.length === 0) return []

  // 1) 近期窗口：从最新往回逐字取满
  const recent: ChatMessage[] = []
  let recentUsed = 0
  for (let index = eligible.length - 1; index >= 0; index -= 1) {
    const message = eligible[index]
    if (!message) continue
    if (recent.length > 0 && recentUsed + message.content.length > opts.recentWindowChars) break
    recent.unshift(message)
    recentUsed += message.content.length
  }
  if (recent.length === 0) {
    const last = eligible[eligible.length - 1]!
    recent.push(last)
    recentUsed = last.content.length
  }

  let used = recentUsed
  const keep: ChatMessage[] = [...recent]
  const budgetLeft = budget - used
  if (opts.importanceTrim && budgetLeft > 0) {
    const recentIds = new Set(recent.map((message) => message.id))
    const outside = eligible.filter((message) => !recentIds.has(message.id))
    outside.sort((a, b) => (b.importance ?? 2) - (a.importance ?? 2))
    for (const message of outside) {
      if (used + message.content.length > budget) break
      keep.push(message)
      used += message.content.length
    }
  }

  // 输出保序（按原文顺序）
  const byId = new Set(keep.map((message) => message.id))
  return eligible.filter((message) => byId.has(message.id))
}
