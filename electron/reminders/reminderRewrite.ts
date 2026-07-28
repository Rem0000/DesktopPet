import {
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import type { ProviderRuntimeConfig } from '../../src/chat/contracts'
import { DEFAULT_SYSTEM_PROMPT } from '../chat/deepSeekProvider'
import { clampBubbleText } from './reminderText'

const REWRITE_TIMEOUT_MS = 10_000

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && 'text' in part) {
        return typeof part.text === 'string' ? part.text : ''
      }
      return ''
    })
    .join('')
}

/**
 * 按当前人设改写提醒意图为一句气泡台词。不写入任何聊天会话。
 * 失败返回 null，由调用方降级。
 */
export async function rewriteReminderInPersona(options: {
  persona: string
  intent: string
  config: ProviderRuntimeConfig
  signal?: AbortSignal
}): Promise<string | null> {
  const intent = options.intent.trim()
  if (!intent) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REWRITE_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort)

  try {
    const persona = options.persona.trim() || DEFAULT_SYSTEM_PROMPT
    const model = new ChatOpenAI({
      apiKey: options.config.apiKey,
      model: options.config.model,
      streaming: false,
      timeout: REWRITE_TIMEOUT_MS,
      maxRetries: 0,
      configuration: {
        baseURL: options.config.baseUrl,
      },
    })
    const result = await model.invoke(
      [
        new SystemMessage(
          [
            persona,
            '',
            '你现在要用自己的口吻，把下面的「提醒意图」改写成一句简短、自然的中文台词（用于桌宠气泡）。',
            '要求：只输出台词本身；不要引号；不要解释；不要列表；尽量不超过 80 字。',
          ].join('\n'),
        ),
        new HumanMessage(`提醒意图：\n${intent}`),
      ],
      { signal: controller.signal },
    )
    const text = clampBubbleText(textFromContent(result.content))
    return text || null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}
