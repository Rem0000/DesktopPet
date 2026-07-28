export type ChatRole = 'user' | 'assistant'

export type ChatMessageStatus = 'streaming' | 'complete' | 'cancelled' | 'error'

export type ChatMessage = {
  id: string
  sessionId: string
  role: ChatRole
  content: string
  status: ChatMessageStatus
  createdAt: string
  updatedAt: string
  error?: ChatError
}

export type ChatSession = {
  id: string
  /** Live2D 导入包目录名；会话仅在该模型下可见 */
  packageId: string
  title: string
  createdAt: string
  updatedAt: string
  messages: ChatMessage[]
}

export type ChatSessionSummary = Omit<ChatSession, 'messages'> & {
  messageCount: number
}

export type ChatErrorCode =
  | 'configuration'
  | 'authentication'
  | 'rate_limit'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'server'
  | 'busy'
  | 'validation'
  | 'unknown'

export type ChatError = {
  code: ChatErrorCode
  message: string
  retryable: boolean
}

export type ProviderPublicConfig = {
  baseUrl: string
  model: string
  hasApiKey: boolean
  apiKeyStorage: 'encrypted' | 'memory' | 'none'
}

export type ProviderConfigInput = {
  baseUrl: string
  model: string
  apiKey?: string
}

export type ProviderRuntimeConfig = {
  baseUrl: string
  model: string
  apiKey: string
}

export type SendChatInput = {
  sessionId: string
  text: string
}

export type SendChatResult = {
  requestId: string
  userMessage: ChatMessage
  assistantMessage: ChatMessage
}

export type KnowledgeCitation = {
  documentId: string
  chunkId: string
  title: string
  sourceName: string
  excerpt: string
  score?: number
  headingPath?: string[]
  recallSource?: 'sparse' | 'vector' | 'both'
}

export type ToolCallPhase = 'start' | 'end'

export type ChatStreamEvent =
  | {
      type: 'chunk'
      requestId: string
      sessionId: string
      messageId: string
      chunk: string
    }
  | {
      type: 'tool_call'
      requestId: string
      sessionId: string
      messageId: string
      toolName: string
      phase: ToolCallPhase
      ok?: boolean
      errorCode?: string
      latencyMs?: number
      inputSummary?: string
      citations?: KnowledgeCitation[]
    }
  | {
      type: 'complete'
      requestId: string
      sessionId: string
      message: ChatMessage
    }
  | {
      type: 'error'
      requestId: string
      sessionId: string
      message: ChatMessage
      error: ChatError
    }

/** 主进程请求渲染进程确认 confirm 级工具 */
export type ToolConfirmRequest = {
  confirmId: string
  toolName: string
  inputSummary: string
  requestId: string
  sessionId: string
  messageId: string
}

export type PetAgentState = 'thinking' | 'speaking' | 'idle'

export type AgentToolParameters = {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

/** safe：白名单直接执行；confirm：执行前需用户确认（P3） */
export type ToolRiskLevel = 'safe' | 'confirm'

export type AgentTool<Input = unknown, Output = unknown> = {
  name: string
  description: string
  /** OpenAI-compatible JSON Schema；供模型规划工具调用时使用 */
  parameters?: AgentToolParameters
  /** 默认 true；可被本地 tool-config 覆盖 */
  enabled?: boolean
  /** 默认 safe */
  riskLevel?: ToolRiskLevel
  validate: (input: unknown) => Input
  execute: (input: Input, signal: AbortSignal) => Promise<Output>
}

export type ToolConfigOverride = {
  enabled?: boolean
}

export type ToolConfigFile = {
  version: 1
  tools: Record<string, ToolConfigOverride>
}

export type ToolTraceRecord = {
  requestId: string
  sessionId: string
  messageId?: string
  toolName: string
  startedAt: string
  endedAt: string
  ok: boolean
  errorCode?: string
  latencyMs: number
  inputSummary?: string
  /** search_knowledge 命中时的引用，用于重开聊天窗后恢复 */
  citations?: KnowledgeCitation[]
}

export type ToolTraceStats = {
  toolName: string
  calls: number
  successes: number
  avgLatencyMs: number
}

export type KnowledgeDocumentSummary = {
  id: string
  title: string
  sourceName: string
  createdAt: string
  updatedAt: string
}

export type TtsProvider = {
  readonly id: string
  synthesize: (
    messageId: string,
    text: string,
    voiceId: string,
    signal: AbortSignal,
  ) => Promise<ArrayBuffer>
}

export type MemoryType =
  | 'profile'
  | 'preference'
  | 'fact'
  | 'commitment'
  | 'episode'

export type MemoryImportance = 1 | 2 | 3

export type MemoryItem = {
  id: string
  type: MemoryType
  key?: string
  content: string
  importance: MemoryImportance
  /** 置顶记忆在预算内优先注入 */
  pinned?: boolean
  /** 最近一次被召回/访问的时间 */
  lastAccessedAt?: string
  sourceSessionId?: string
  sourceMessageIds?: string[]
  createdAt: string
  updatedAt: string
  expiresAt?: string
}

export type SessionMemorySummary = {
  sessionId: string
  summary: string
  coveredUntilMessageId: string
  updatedAt: string
}

export type MemoryWriteInput = {
  type: MemoryType
  content: string
  key?: string
  importance?: MemoryImportance
  pinned?: boolean
  sourceSessionId?: string
  sourceMessageIds?: string[]
  expiresAt?: string
}

export type MemoryUpdateInput = {
  content?: string
  key?: string
  importance?: MemoryImportance
  pinned?: boolean
  expiresAt?: string | null
}

/** 本地定时提醒；与记忆 commitment 分离，不绑定 packageId */
export type ReminderStatus = 'pending' | 'fired' | 'cancelled'

export type Reminder = {
  id: string
  content: string
  fireAt: string
  status: ReminderStatus
  createdAt: string
  sourceSessionId?: string
  firedAt?: string
}

export type ReminderCreateInput = {
  content: string
  fireAt?: string
  delayMinutes?: number
  sourceSessionId?: string
}

export type SpeechBubblePayload = {
  text: string
  durationMs?: number
}
