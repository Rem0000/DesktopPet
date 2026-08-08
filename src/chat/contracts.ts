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
  /** 消息级重要性（1 低 / 2 中 / 3 高）；写入期启发式打分，裁剪时窗口外高重要性优先保留 */
  importance?: 1 | 2 | 3
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
  /** 提供方标识（如 'deepseek'）；为多 Provider 扩展预留，默认 'deepseek' */
  providerKind?: string
}

/** 工具规划输出：pendingToolCalls 由 plan 节点消费 */
export type PendingToolCall = {
  name: string
  input: unknown
}

/**
 * 统一的大模型 Provider 接口（Chat 主链路由 AgentRuntime 消费）。
 * planToolCalls 可选：不支持的实现返回 { toolCalls: [] }（AgentRuntime 已防御）。
 * 新增 Provider 时实现本接口并在 providerFactory.createProvider 注册分支即可。
 */
export type ChatProvider = {
  readonly kind: string
  stream: (
    messages: ChatMessage[],
    config: ProviderRuntimeConfig,
    signal: AbortSignal,
    onToken: (token: string) => void,
    systemPrompt?: string,
  ) => Promise<string>
  planToolCalls?: (
    messages: ChatMessage[],
    config: ProviderRuntimeConfig,
    signal: AbortSignal,
    systemPrompt: string,
    tools: AgentTool[],
  ) => Promise<{ toolCalls: PendingToolCall[]; text?: string }>
  summarize: (
    messages: ChatMessage[],
    config: ProviderRuntimeConfig,
    signal: AbortSignal,
  ) => Promise<string>
  completeText: (
    systemPrompt: string,
    userPrompt: string,
    config: ProviderRuntimeConfig,
    signal: AbortSignal,
  ) => Promise<string>
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

/** search_history 逐字命中：带出处，供模型引用与观测 */
export type HistoryHit = {
  messageId: string
  sessionId: string
  role: ChatRole
  createdAt: string
  excerpt: string
  score: number
}

export type HistorySearchInput = {
  query: string
  topK: number
}

/** Tavily /search 命中：供 web_search 工具输出与硬约束 */
export type WebSearchHit = {
  title: string
  url: string
  content: string
  score?: number
  publishedDate?: string
}

export type WebSearchOutput = {
  ok: boolean
  hits: WebSearchHit[]
  answer?: string
  empty: boolean
}

export type WebFetchOutput = {
  ok: boolean
  url: string
  content: string
  empty: boolean
}

export type TavilyConfigFile = {
  version: 1
  apiKey?: string
}

/** 每日首次见面状态：按包记录最近一次"首次见面"的本地日期 */
export type DailyMeetRecord = {
  lastMeetDate: string
}

export type DailyMeetDatabase = {
  version: 1
  byPackage: Record<string, DailyMeetRecord>
}

/** 上下文占用观测：预算、已用估算与占比 */
export type ContextUsage = {
  budgetCharacters: number
  usedCharacters: number
  ratio: number
}

/** 对话关键事实自动 episode 沉淀配置（data/config/episode-config.json） */
export type EpisodeConfig = {
  version: 1
  enabled?: boolean
  /** 关键事实意图未命中时，累计未沉淀 complete 用户消息达到该条数才触发抽取 */
  minMessages?: number
  /** 距上次成功抽取至少间隔多少条未沉淀消息才再次抽取 */
  intervalMessages?: number
  /** 单次抽取最多写入的 episode 条数 */
  maxEpisodes?: number
}

/**
 * Prompt 注入防护配置（data/config/guard-config.json）。
 * 把「外部内容」（web 结果/检索命中/用户可写的记忆）与系统指令在 prompt 里显式隔离——
 * 提示层面的纵深防御，非沙箱。
 */
export type GuardConfig = {
  version: 1
  enabled?: boolean
  /** 单块外部内容长度上限（字符） */
  maxChars?: number
  /** 单块最多条目数 */
  maxItems?: number
  /** 边界头文案 */
  label?: string
}

/** episode 抽取遥测：观察触发/写入/跳过原因 */
export type EpisodeDistillEvent = {
  packageId: string
  sessionId: string
  triggered: boolean
  reason?: string
  episodesWritten: number
  totalMessages: number
  newMessages: number
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

/** 工具执行上下文：由运行时注入当前请求的会话归属，避免工具回退到环境活跃包 */
export type AgentToolContext = {
  /** 当前请求所属会话的模型包；按包落盘/检索应优先使用它 */
  packageId: string
}

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
  execute: (input: Input, signal: AbortSignal, ctx?: AgentToolContext) => Promise<Output>
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

/** 关系优先级策略：人设中的关系表述如何与动态关系层协同 */
export type RelationshipPolicy = 'layered' | 'persona-first' | 'dynamic-first'

/** 好感温度对应的关系阶段 */
export type RelationshipStage =
  | 'stranger'
  | 'acquaintance'
  | 'friendly'
  | 'close'
  | 'intimate'

export type EvolutionStatus = 'proposed' | 'applied' | 'rejected'

/** 慢速演化候选/已生效覆盖：对 persona 固有设定的"从→到"建议 */
export type EvolutionProposal = {
  id: string
  /** 引用的人设原文片段 */
  personaQuote: string
  /** 建议的现状变化描述 */
  change: string
  /** 近期对话证据摘要 */
  evidence: string
  status: EvolutionStatus
  createdAt: string
  appliedAt?: string
  sessionId?: string
}

export type RelationshipHistoryEntry = {
  at: string
  type: 'affinity' | 'stage' | 'manual' | 'reset' | 'evolution'
  delta?: number
  beforeStage?: RelationshipStage
  afterStage?: RelationshipStage
  note?: string
  sessionId?: string
}

/** 每包关系状态；持久化于 data/relationships/<packageId>.json */
export type RelationshipState = {
  policy: RelationshipPolicy
  /** 好感温度 0–100 */
  affinity: number
  stage: RelationshipStage
  /** 当下态度描述（空则按阶段回退默认） */
  temperatureNote: string
  evolutions: EvolutionProposal[]
  history: RelationshipHistoryEntry[]
  lastEvaluatedAt?: string
  updatedAt: string
}

/** update_relationship 工具的写入载荷 */
export type RelationshipWriteInput = {
  /** 好感温度增减，钳制在 [-10, +10] */
  delta?: number
  /** 简短关系笔记（≤120 字） */
  note?: string
  sessionId?: string
}

/** 面板手工修正关系状态 */
export type RelationshipPatch = {
  affinity?: number
  temperatureNote?: string
  policy?: RelationshipPolicy
}

/** 面板展示用视图：附上生效描述与阶段中文标签 */
export type RelationshipPanelView = RelationshipState & {
  /** 生效的"当下态度描述"（自定义或按阶段+好感自动回退） */
  temperature: string
  /** 关系阶段中文标签 */
  stageLabel: string
}
