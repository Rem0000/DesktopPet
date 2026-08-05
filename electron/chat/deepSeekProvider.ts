import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import type {
  AgentTool,
  ChatError,
  ChatMessage,
  ProviderConfigInput,
  ProviderRuntimeConfig,
} from '../../src/chat/contracts'
import type { PendingToolCall } from './agentRuntime'

export const DEFAULT_SYSTEM_PROMPT =
  '你是运行在 Windows 桌面的虚拟桌宠助手。请始终使用简洁、自然、友善的中文回答；不知道时坦诚说明，不虚构已执行的工具或系统操作。'

export const PLAN_TOOL_INSTRUCTION = [
  '你正在决定是否需要调用工具（长期记忆、本地提醒或知识库检索）。',
  '当用户询问本地文档、项目说明、已导入资料或知识库细节时，优先调用 search_knowledge；不要编造文档内容。',
  '当用户询问最新新闻、实时数据、外部网站或本地知识库没有的实时/外部信息时，调用 web_search 搜索互联网；搜索结果引用 MUST 逐字取自工具返回内容，禁止编造。普通闲聊不要调用。',
  '当用户需要特定网页的正文内容、且 web_search 已返回该 URL 时，调用 web_fetch 抓取（执行前需用户确认）；通常先 web_search 拿到 URL 再抓取，不要凭记忆编造网页内容。',
  '当用户引用更早的对话（如「我之前说过…」「上次你说…」）且当前上下文中缺少该细节时，调用 search_history 检索本模型的历史会话；普通闲聊不要调用。',
  '同一条用户消息若同时包含知识库问题与明确的记忆写入请求：记忆内容不依赖检索结果时可同轮并行调用 search_knowledge 与 remember_fact/update_profile；需根据检索结果再写时先调用 search_knowledge。',
  '仅当用户明确表达了应跨模型长期保留的画像（update_profile）或事实/约定（remember_fact）时才调用记忆工具；同一事实不要重复调用多次；禁止只用口头声称已记住。',
  '当用户明确要求「N 分钟后提醒」「到某时刻提醒」等到点主动提醒时，调用 schedule_reminder；不要仅用 remember_fact 代替。',
  '取消未触发的提醒时调用 cancel_reminder。',
  '当用户明确要求「忘记/忘掉/删除」某条记忆或爱好时，MUST 调用 forget_memory，并从下方【可遗忘记忆列表】中选择匹配条目的 id；禁止只用口头声称已忘记。',
  '若列表中没有匹配项，不要调用 forget_memory，并如实告知找不到对应记忆。',
  '模型口吻、称呼方式、输出规范（如说话结尾加喵、回答要简洁）不要写入记忆，应提示用户在「管理已导入模型」中编辑人设；此类请求禁止调用记忆工具，也禁止口头声称已记住。',
  '当对话明显增进或损害你与用户的好感/关系（相互理解加深、闹矛盾、说难听话等）时，调用 update_relationship 记录关系温度变化与笔记；口吻/输出规范类不要调用，普通闲聊不要调用。',
  '普通闲聊、一次性问题、临时情绪不要写入记忆，也不要创建提醒。',
  '不要编造用户未说过的信息；一次最多调用 3 个工具，且同类工具不要重复。',
  '若无需工具操作，不要调用任何工具。',
].join('')

/** @deprecated 兼容旧名 */
const MEMORY_PLAN_INSTRUCTION = PLAN_TOOL_INSTRUCTION

export function validateProviderConfig(input: ProviderConfigInput): ProviderConfigInput {
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, '')
  const model = input.model.trim()
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new Error('服务地址格式无效')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('服务地址仅支持 HTTP(S)')
  }
  if (!model || model.length > 120 || !/^[\w./:-]+$/u.test(model)) {
    throw new Error('模型名称无效')
  }
  if (input.apiKey && input.apiKey.length > 512) {
    throw new Error('API Key 长度无效')
  }
  return { baseUrl, model, apiKey: input.apiKey?.trim() }
}

function toLangChainMessages(messages: ChatMessage[]): BaseMessage[] {
  return messages
    .filter((message) => message.status === 'complete' && message.content.trim())
    .map((message) =>
      message.role === 'user'
        ? new HumanMessage(message.content)
        : new AIMessage(message.content),
    )
}

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

function toOpenAiTools(tools: AgentTool[]) {
  return tools
    .filter((tool) => tool.parameters)
    .map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters!,
      },
    }))
}

function parseToolCalls(raw: unknown, allowed: Set<string>): PendingToolCall[] {
  if (!Array.isArray(raw)) return []
  const calls: PendingToolCall[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const value = item as {
      name?: unknown
      args?: unknown
      input?: unknown
    }
    if (typeof value.name !== 'string' || !allowed.has(value.name)) continue
    const input =
      value.args && typeof value.args === 'object'
        ? value.args
        : value.input && typeof value.input === 'object'
          ? value.input
          : {}
    calls.push({ name: value.name, input })
    if (calls.length >= 3) break
  }
  return calls
}

export function normalizeProviderError(error: unknown): ChatError {
  const candidate = error as {
    status?: number
    name?: string
    code?: string
    message?: string
  }
  const status = candidate?.status
  const name = candidate?.name ?? ''
  const code = candidate?.code ?? ''

  if (name === 'AbortError' || code === 'ABORT_ERR') {
    return { code: 'cancelled', message: '已停止生成', retryable: true }
  }
  if (status === 401 || status === 403) {
    return { code: 'authentication', message: 'DeepSeek API Key 无效或无权限', retryable: false }
  }
  if (status === 429) {
    return { code: 'rate_limit', message: '请求过于频繁，请稍后重试', retryable: true }
  }
  if (name.includes('Timeout') || code.includes('TIMEOUT')) {
    return { code: 'timeout', message: 'DeepSeek 请求超时', retryable: true }
  }
  if (typeof status === 'number' && status >= 500) {
    return { code: 'server', message: 'DeepSeek 服务暂时不可用', retryable: true }
  }
  if (
    ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'].includes(code) ||
    name.includes('Connection')
  ) {
    return { code: 'network', message: '无法连接 DeepSeek 服务', retryable: true }
  }
  return { code: 'unknown', message: '生成回复失败，请稍后重试', retryable: true }
}

export class DeepSeekProvider {
  async stream(
    messages: ChatMessage[],
    config: ProviderRuntimeConfig,
    signal: AbortSignal,
    onToken: (token: string) => void,
    systemPrompt: string = DEFAULT_SYSTEM_PROMPT,
  ): Promise<string> {
    const model = new ChatOpenAI({
      apiKey: config.apiKey,
      model: config.model,
      streaming: true,
      timeout: 60_000,
      maxRetries: 1,
      configuration: {
        baseURL: config.baseUrl,
      },
    })

    let reply = ''
    const stream = await model.stream(
      [new SystemMessage(systemPrompt), ...toLangChainMessages(messages)],
      { signal },
    )
    for await (const chunk of stream) {
      const token = textFromContent(chunk.content)
      if (!token) continue
      reply += token
      onToken(token)
    }
    return reply.trim()
  }

  async planToolCalls(
    messages: ChatMessage[],
    config: ProviderRuntimeConfig,
    signal: AbortSignal,
    systemPrompt: string,
    tools: AgentTool[],
  ): Promise<{ toolCalls: PendingToolCall[]; text?: string }> {
    const openAiTools = toOpenAiTools(tools)
    if (openAiTools.length === 0) return { toolCalls: [] }

    const model = new ChatOpenAI({
      apiKey: config.apiKey,
      model: config.model,
      streaming: false,
      timeout: 30_000,
      maxRetries: 0,
      configuration: {
        baseURL: config.baseUrl,
      },
    }).bindTools(openAiTools, { tool_choice: 'auto' })

    const recent = messages.slice(-8)
    const result = await model.invoke(
      [
        new SystemMessage(`${systemPrompt}\n\n${MEMORY_PLAN_INSTRUCTION}`),
        ...toLangChainMessages(recent),
      ],
      { signal },
    )

    const allowed = new Set(tools.map((tool) => tool.name))
    const toolCalls = parseToolCalls(result.tool_calls, allowed)
    const text = textFromContent(result.content).trim()
    return { toolCalls, text: text || undefined }
  }

  async summarize(
    messages: ChatMessage[],
    config: ProviderRuntimeConfig,
    signal: AbortSignal,
  ): Promise<string> {
    const model = new ChatOpenAI({
      apiKey: config.apiKey,
      model: config.model,
      streaming: false,
      timeout: 45_000,
      maxRetries: 0,
      configuration: {
        baseURL: config.baseUrl,
      },
    })
    const fullTranscript = messages
      .filter((message) => message.status === 'complete' && message.content.trim())
      .map((message) => `${message.role === 'user' ? '用户' : '桌宠'}：${message.content}`)
      .join('\n')
    // head + tail 采样：覆盖最老设定与被挤出窗口的近期内容，避免只概括最开头
    const HEAD_CHARS = 4_000
    const TAIL_CHARS = 4_000
    const transcript =
      fullTranscript.length <= HEAD_CHARS + TAIL_CHARS
        ? fullTranscript
        : `${fullTranscript.slice(0, HEAD_CHARS)}\n…（中段省略）…\n${fullTranscript.slice(-TAIL_CHARS)}`
    const result = await model.invoke(
      [
        new SystemMessage(
          '请将下列早期对话压缩为简洁中文要点摘要，保留稳定事实与偏好，不要编造。',
        ),
        new HumanMessage(transcript || '（无内容）'),
      ],
      { signal },
    )
    return textFromContent(result.content).trim()
  }

  /** 非流式单轮补全：供关系演化反思等一次性结构化调用复用 */
  async completeText(
    systemPrompt: string,
    userPrompt: string,
    config: ProviderRuntimeConfig,
    signal: AbortSignal,
  ): Promise<string> {
    const model = new ChatOpenAI({
      apiKey: config.apiKey,
      model: config.model,
      streaming: false,
      timeout: 60_000,
      maxRetries: 1,
      configuration: {
        baseURL: config.baseUrl,
      },
    })
    const result = await model.invoke(
      [new SystemMessage(systemPrompt), new HumanMessage(userPrompt)],
      { signal },
    )
    return textFromContent(result.content).trim()
  }
}
