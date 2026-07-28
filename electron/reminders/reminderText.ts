import type { Reminder } from '../../src/chat/contracts'

/** 同批提醒合并为改写输入意图文案 */
export function mergeReminderIntent(items: Reminder[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]!.content
  return items.map((item, index) => `${index + 1}. ${item.content}`).join('\n')
}

/** LLM 失败时的气泡降级文案 */
export function fallbackBubbleText(items: Reminder[]): string {
  if (items.length === 0) return '该提醒你啦'
  if (items.length === 1) return `提醒你：${items[0]!.content}`
  const joined = items.map((item) => item.content).join('；')
  const text = `该提醒你啦：${joined}`
  return text.length > 120 ? `${text.slice(0, 117)}…` : text
}

export function clampBubbleText(text: string, max = 120): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (!trimmed) return ''
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}
