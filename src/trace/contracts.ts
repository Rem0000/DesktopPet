/**
 * 链路追踪契约（主进程与追踪台渲染进程共享）。
 *
 * 设计对标 DeepSeek Harness 的 `session.jsonl`：会话级 append-only 事件流，
 * 首行为不可变 header，事件带会话内稠密递增的 seq 与 epoch ms time，
 * token 用量与上下文占用等聚合值全部是从事件流折叠出的「投影」，而非另写一份聚合。
 * 详见 openspec/changes/add-agent-trace-module/design.md。
 */

/** 日志格式版本：仅在 header/信封/核心语义变化时递增 */
export const TRACE_FORMAT_VERSION = 1

/**
 * 记录等级：
 * - off：完全不写（等价于 enabled:false）
 * - meta：文本类字段只落预览与摘要，不落原文（也不外置）
 * - full：原文落入事件，超过单字段上限时外置到 blobs/
 */
export type TraceLevel = 'off' | 'meta' | 'full'

/** fsync 档位：never 不主动刷盘；checkpoint 在语义检查点刷盘（默认）；turn 在每轮结束刷盘 */
export type TraceFsyncMode = 'never' | 'checkpoint' | 'turn'

export type TraceConfig = {
  version: 1
  enabled: boolean
  level: TraceLevel
  /** 单字段内联上限（字符）；超出则外置到 blobs/ */
  maxFieldChars: number
  fsync: TraceFsyncMode
  /** 保留天数 */
  retentionDays: number
  /** 最多保留会话数 */
  maxSessions: number
  /** 单个会话日志大小上限（MB） */
  maxFileMB: number
}

export const DEFAULT_TRACE_CONFIG: TraceConfig = {
  version: 1,
  enabled: true,
  level: 'full',
  maxFieldChars: 4000,
  fsync: 'checkpoint',
  retentionDays: 30,
  maxSessions: 200,
  maxFileMB: 32,
}

/**
 * token 用量。四类计数互斥：
 * - inputTokens 只计「未缓存输入」（= prompt − 缓存读），不含缓存读
 * - cacheReadTokens / cacheWriteTokens 单列
 * - reasoningTokens 是 outputTokens 的**子集**，不得与其他桶重复累加
 * 聚合时 reasoningTokens 取各项之和仅用于展示，不参与总量计算。
 */
export type TokenUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** 推理 token（outputTokens 的子集，仅供展示） */
  reasoningTokens: number
  /** provider 未返回用量、由字符密度估算时为 true */
  estimated?: boolean
}

export const EMPTY_TOKEN_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
}

/**
 * 文本类字段的摘要形态：超限（或 meta 档）时不内联原文。
 * full 档超限时 blobRef 指向 `data/traces/blobs/<sha256>`；meta 档无 blobRef（原文不落盘）。
 */
export type TraceTextField = {
  /** 已脱敏预览 */
  preview: string
  /** 原文字节数（UTF-8） */
  bytes: number
  /** 原文字符数 */
  characters: number
  sha256: string
  /** 外置原文文件名（内容寻址）；meta 档或未外置时缺省 */
  blobRef?: string
}

/** 事件中的文本字段：小字段直接内联，大字段为摘要形态 */
export type TraceTextValue = string | TraceTextField

export type TraceTurnStatus = 'completed' | 'cancelled' | 'error' | 'interrupted'

/** 图节点名（与 agentRuntime 的 StateGraph 节点一一对应） */
export type TraceStepNode =
  | 'normalize'
  | 'recall'
  | 'plan'
  | 'toolBoundary'
  | 'maybeReplan'
  | 'model'
  | 'commit'

/** 模型调用类型 */
export type TraceModelCallKind = 'plan' | 'reply' | 'summary' | 'oneshot'

export type TraceToolSnapshot = {
  name: string
  enabled: boolean
  riskLevel: 'safe' | 'confirm'
}

/** 会话首行：不可变 header */
export type TraceHeader = {
  type: 'trace-session'
  version: number
  sessionId: string
  packageId: string
  createdAt: number
  provider: {
    kind: string
    baseUrl: string
    model: string
    plannerModel?: string
  }
  context: {
    budgetCharacters: number
    importanceTrim: boolean
    recentWindowChars: number
  }
  tools: TraceToolSnapshot[]
  redaction: {
    level: TraceLevel
    maxFieldChars: number
  }
}

/** 工具调用被丢弃的原因 */
export type TraceDroppedReason =
  | 'not_allowed'
  | 'duplicate'
  | 'already_succeeded'
  | 'over_budget'
  | 'failed'

export type TraceRetrievalSource = 'memory' | 'knowledge' | 'history'

export type TraceRetrievalHit = {
  id: string
  score?: number
  sparseScore?: number
  vectorScore?: number
  rerankScore?: number
  /** 稀疏/向量/融合来源标记（hybridSearch 的 recallSource） */
  recallSource?: 'sparse' | 'vector' | 'both'
  title?: string
}

/** 事件载荷映射：键即事件 type */
export type TraceEventMap = {
  'turn/start': {
    userMessageId?: string
    /** 一次聊天请求的标识（与 chat:stream / 旧工具 trace 的 requestId 同源） */
    requestId?: string
  }
  'turn/end': {
    status: TraceTurnStatus
    latencyMs: number
    /** 该轮全部模型调用的聚合用量 */
    usage: TokenUsage
    modelCalls: number
    toolCalls: number
    toolSuccesses: number
    errorCode?: string
    message?: string
  }
  'user/message': {
    messageId: string
    content: TraceTextValue
    characters: number
  }
  'assistant/message': {
    messageId: string
    content: TraceTextValue
    characters: number
    usage?: TokenUsage
  }
  'step/start': {
    node: TraceStepNode
    round?: number
  }
  'step/end': {
    node: TraceStepNode
    latencyMs: number
    note?: string
  }
  'request/header': {
    kind: TraceModelCallKind
    providerKind: string
    model: string
    /** 系统提示词：默认只落长度与摘要 */
    systemPrompt: {
      characters: number
      sha256: string
      preview?: string
    }
    messageCount: number
    messageCharacters: number
    tools: string[]
  }
  'request/context': {
    budgetCharacters: number
    usedCharacters: number
    parts: {
      systemPrompt: number
      systemTools: number
      skills: number
      memory: number
      messages: number
    }
  }
  'model/call': {
    kind: TraceModelCallKind
    providerKind: string
    model: string
    streaming: boolean
  }
  'model/result': {
    kind: TraceModelCallKind
    model: string
    ok: boolean
    latencyMs: number
    /** 首字延迟（流式） */
    ttftMs?: number
    finishReason?: string
    usage?: TokenUsage
    characters?: number
    errorCode?: string
    message?: string
  }
  'plan/result': {
    /** 规划轮次（1 起；maybeReplan 为第 2 轮） */
    round?: number
    candidates: number
    planned: Array<{ name: string; input: TraceTextValue }>
    dropped: Array<{ name: string; reason: TraceDroppedReason }>
    failed?: string
  }
  'tool/call': {
    callId: string
    name: string
    riskLevel: 'safe' | 'confirm'
    args: TraceTextValue
  }
  'tool/confirm': {
    callId: string
    name: string
    decision: 'approved' | 'denied' | 'timeout'
    waitedMs: number
  }
  'tool/result': {
    callId: string
    name: string
    ok: boolean
    latencyMs: number
    errorCode?: string
    message?: string
    output?: TraceTextValue
    /** 检索类工具的引用来源 */
    citations?: number
    /** 外置原文的检索命中数等轻量统计 */
    hitCount?: number
  }
  'retrieval/hits': {
    source: TraceRetrievalSource
    query: string
    topK?: number
    latencyMs: number
    hits: TraceRetrievalHit[]
  }
  'skill/route': {
    hit: boolean
    skillId?: string
    rulesCharacters?: number
  }
  error: {
    code: string
    message: string
    where: string
  }
}

export type TraceEventType = keyof TraceEventMap

/**
 * 事件信封。seq 由写入器统一分配（会话内稠密递增，出现空洞即视为日志损坏）；
 * time 为 epoch 毫秒；turn 便于按轮过滤。
 * ignorable 为前向兼容标记：读取方遇到带该标记的未知类型应跳过而非整份拒读。
 */
export type TraceEvent<T extends TraceEventType = TraceEventType> = {
  [K in TraceEventType]: {
    type: K
    seq: number
    time: number
    turn: number
    data: TraceEventMap[K]
    ignorable?: true
  }
}[T]

/** 读取损坏行/未知事件的诊断信息 */
export type TraceReadIssue = {
  line: number
  reason: 'unparsable' | 'unknown-type' | 'corrupt'
  detail?: string
}

export type TraceReadResult = {
  header: TraceHeader | null
  events: TraceEvent[]
  /** 命中的事件总数（分页前） */
  total: number
  /** 下一页偏移；为 null 表示已到末尾 */
  nextOffset: number | null
  issues: TraceReadIssue[]
  /** 按轮次折叠的用量（由主进程计算，渲染端只展示，不自行聚合） */
  usageByTurn?: Array<{ turn: number; usage: TokenUsage }>
}

export type TraceReadOptions = {
  offset?: number
  limit?: number
  turns?: number[]
  types?: TraceEventType[]
}

/** 会话列表项：仅由首行 header + 末次轮次汇总得出 */
export type TraceSessionSummary = {
  sessionId: string
  packageId: string
  createdAt: number
  updatedAt: number
  turns: number
  lastStatus?: TraceTurnStatus
  usage: TokenUsage
  toolCalls: number
  toolSuccesses: number
  durationMs: number
}

export type TraceToolStat = {
  toolName: string
  calls: number
  successes: number
  avgLatencyMs: number
  p95LatencyMs: number
}

export type TraceStats = {
  turns: number
  modelCalls: number
  toolCalls: number
  usage: TokenUsage
  tools: TraceToolStat[]
}

/** 投影：某会话最近一次请求的上下文压力与来源拆分 */
export type TraceContextProjection = {
  budgetCharacters: number
  usedCharacters: number
  ratio: number
  parts: {
    systemPrompt: number
    systemTools: number
    skills: number
    memory: number
    messages: number
  }
  /** provider 报告的最新一次提示规模（token） */
  pressureTokens?: number
  /** 是否有过至少一次组装观测 */
  observed: boolean
  updatedAt?: number
}

/** 追踪台实时推送信封 */
export type TraceLiveEvent = {
  sessionId: string
  event: TraceEvent
}
