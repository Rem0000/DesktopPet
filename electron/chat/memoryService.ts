import type {
  ChatMessage,
  MemoryImportance,
  MemoryItem,
  MemoryWriteInput,
  ProviderRuntimeConfig,
  AgentTool,
} from '../../src/chat/contracts'
import { embedQuery } from '../retrieval/embeddingService'
import { hybridSearch } from '../retrieval/hybridSearch'
import { DEFAULT_SYSTEM_PROMPT } from './deepSeekProvider'
import type { MemoryStore } from './memoryStore'
import { assertSafeMemoryContent } from './memoryStore'
import type { ToolRegistry } from './toolRegistry'

export type AssembledContext = {
  systemPrompt: string
  recentMessages: ChatMessage[]
  recalledItems: MemoryItem[]
  sessionSummary?: string
}

const DEFAULT_BUDGET = 24_000
const MEMORY_BUDGET_RATIO = 0.18
const SUMMARY_BUDGET_RATIO = 0.12

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2)
}

function daysSince(iso: string, now: Date): number {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 365
  return Math.max(0, (now.getTime() - then) / (24 * 60 * 60 * 1000))
}

/** 关键词重叠 + 整句/子串命中（改善中文连续文本） */
export function scoreMemoryItem(
  item: MemoryItem,
  query: string,
  now = new Date(),
): number {
  const normalizedQuery = query.toLowerCase().trim()
  const haystack = `${item.key ?? ''} ${item.content}`.toLowerCase()
  const queryTokens = tokenize(query)
  const querySet = new Set(queryTokens)
  const contentTokens = tokenize(haystack)
  let overlap = 0
  let tf = 0
  for (const token of contentTokens) {
    if (querySet.has(token)) {
      overlap += 1
      tf += 1
    }
  }
  for (const token of queryTokens) {
    if (token.length >= 2 && haystack.includes(token)) overlap += 1
  }
  const substringBoost =
    normalizedQuery.length >= 2 && haystack.includes(normalizedQuery) ? 6 : 0
  const bm25Like = queryTokens.length === 0 ? 0 : (tf * 2.2) / (tf + 1.2) + overlap
  const importanceBoost = item.importance * 3
  const typeBoost = item.type === 'profile' ? 4 : 0
  const pinBoost = item.pinned ? 12 : 0
  const decay = Math.max(0.2, 1 - daysSince(item.updatedAt, now) / 180)
  return bm25Like * 2 + substringBoost + importanceBoost + typeBoost * decay + pinBoost
}

function memoryMetadataBoost(item: MemoryItem, now = new Date()): number {
  const decay = Math.max(0.2, 1 - daysSince(item.updatedAt, now) / 180)
  const pinBoost = item.pinned ? 1 : 0
  const importanceBoost = item.importance / 3
  const typeBoost = item.type === 'profile' ? 0.4 : 0
  return pinBoost + importanceBoost * decay + typeBoost
}

/** Hybrid 检索：BM25 + 向量 + pin/importance/衰减加权 */
export async function retrieveMemories(
  items: MemoryItem[],
  query: string,
  topK = 8,
  now = new Date(),
  getVector: (id: string) => number[] | undefined,
): Promise<MemoryItem[]> {
  const active = items.filter(
    (item) =>
      item.type !== 'preference' &&
      (!item.expiresAt || item.expiresAt > now.toISOString()),
  )
  if (!query.trim()) {
    return [...active]
      .sort((a, b) => {
        const pin = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
        if (pin !== 0) return pin
        return (
          b.importance - a.importance || b.updatedAt.localeCompare(a.updatedAt)
        )
      })
      .slice(0, topK)
  }

  const byId = new Map(active.map((item) => [item.id, item]))
  const hits = await hybridSearch(
    query,
    active.map((item) => ({
      id: item.id,
      text: `${item.key ?? ''} ${item.content}`,
      metadata: { item },
    })),
    {
      topK,
      embedQuery,
      getVector,
      metadataBoost: (entry) => {
        const item = entry.metadata?.item as MemoryItem | undefined
        return item ? memoryMetadataBoost(item, now) : 0
      },
    },
  )

  return hits
    .map((hit) => byId.get(hit.id))
    .filter((item): item is MemoryItem => Boolean(item))
}

export function fallbackSummaryFromMessages(messages: ChatMessage[]): string {
  const points = messages
    .filter((message) => message.status === 'complete' && message.content.trim())
    .slice(0, 8)
    .map((message) => {
      const prefix = message.role === 'user' ? '用户' : '桌宠'
      const text = message.content.replace(/\s+/g, ' ').trim().slice(0, 48)
      return `- ${prefix}：${text}`
    })
  return points.length ? `早期对话要点：\n${points.join('\n')}` : '（暂无可用摘要）'
}

export class MemoryService {
  constructor(
    private readonly store: MemoryStore,
    private readonly tools: ToolRegistry,
    private readonly summarize?: (
      messages: ChatMessage[],
      config: ProviderRuntimeConfig,
      signal: AbortSignal,
    ) => Promise<string>,
    private readonly readPersona: (packageId: string) => string = () => '',
  ) {}

  /** 供工具规划注入：近期可遗忘条目（不含 preference） */
  listForPlanning(limit = 24): Array<{ id: string; type: string; content: string }> {
    return this.store
      .listItems()
      .filter((item) => item.type !== 'preference')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map((item) => ({
        id: item.id,
        type: item.type,
        content: item.content.length > 80 ? `${item.content.slice(0, 80)}…` : item.content,
      }))
  }

  registerDefaultTools(): void {
    const write =
      (type: MemoryWriteInput['type']) =>
      async (input: {
        content: string
        key?: string
        importance?: MemoryImportance
        sourceSessionId?: string
        expiresAt?: string
      }) => {
        assertSafeMemoryContent(input.content)
        const item = await this.store.writeItem({
          type,
          content: input.content,
          key: input.key,
          importance: input.importance,
          sourceSessionId: input.sourceSessionId,
          expiresAt: input.expiresAt,
        })
        return { ok: true as const, item }
      }

    const importanceSchema = {
      type: 'number',
      enum: [1, 2, 3],
      description: '重要性，1 低 / 2 中 / 3 高，默认 2',
    }

    const tools = [
      {
        name: 'update_profile',
        enabled: true,
        riskLevel: 'safe' as const,
        description:
          '当用户告知稳定身份信息（称呼、名字、职业等）时更新跨模型共享画像。仅在明确值得长期记住时调用。模型口吻/输出规范请勿使用本工具，应提示用户在管理窗写入人设。',
        parameters: {
          type: 'object' as const,
          properties: {
            key: {
              type: 'string',
              description: '画像字段键，如 user.nickname、user.job',
            },
            content: { type: 'string', description: '画像内容' },
            importance: importanceSchema,
          },
          required: ['key', 'content'],
          additionalProperties: false,
        },
        validate: (input: unknown) => {
          if (!input || typeof input !== 'object') throw new Error('参数无效')
          const value = input as Record<string, unknown>
          if (typeof value.content !== 'string' || typeof value.key !== 'string') {
            throw new Error('update_profile 需要 key 与 content')
          }
          return {
            content: value.content,
            key: value.key,
            importance: value.importance as MemoryImportance | undefined,
            sourceSessionId:
              typeof value.sourceSessionId === 'string'
                ? value.sourceSessionId
                : undefined,
          }
        },
        execute: async (
          input: {
            content: string
            key?: string
            importance?: MemoryImportance
            sourceSessionId?: string
            expiresAt?: string
          },
          _signal: AbortSignal,
        ) => write('profile')(input),
      },
      {
        name: 'remember_fact',
        enabled: true,
        riskLevel: 'safe' as const,
        description:
          '记住与用户相关、可跨模型共享的长期事实或约定（如稍后提醒喝水）。若带 expiresAt 则视为有时限的约定。模型口吻/称呼/输出规范不要写入，应提示用户改人设。',
        parameters: {
          type: 'object' as const,
          properties: {
            content: { type: 'string', description: '事实或约定内容' },
            key: { type: 'string', description: '可选去重键' },
            importance: importanceSchema,
            expiresAt: {
              type: 'string',
              description: '可选 ISO 过期时间；有则按约定存储',
            },
          },
          required: ['content'],
          additionalProperties: false,
        },
        validate: (input: unknown) => {
          if (!input || typeof input !== 'object') throw new Error('参数无效')
          const value = input as Record<string, unknown>
          if (typeof value.content !== 'string') {
            throw new Error('remember_fact 需要 content')
          }
          return {
            content: value.content,
            key: typeof value.key === 'string' ? value.key : undefined,
            importance: value.importance as MemoryImportance | undefined,
            sourceSessionId:
              typeof value.sourceSessionId === 'string'
                ? value.sourceSessionId
                : undefined,
            expiresAt:
              typeof value.expiresAt === 'string' ? value.expiresAt : undefined,
          }
        },
        execute: async (
          input: {
            content: string
            key?: string
            importance?: MemoryImportance
            sourceSessionId?: string
            expiresAt?: string
          },
          _signal: AbortSignal,
        ) => write(input.expiresAt ? 'commitment' : 'fact')(input),
      },
      {
        name: 'forget_memory',
        enabled: true,
        riskLevel: 'confirm' as const,
        description:
          '当用户明确要求忘掉某条已知记忆时，按记忆 id 删除（执行前需用户确认）。id 必须来自规划提示中的可遗忘记忆列表，不要编造 id。',
        parameters: {
          type: 'object' as const,
          properties: {
            id: { type: 'string', description: '要遗忘的记忆条目 id' },
          },
          required: ['id'],
          additionalProperties: false,
        },
        validate: (input: unknown) => {
          if (!input || typeof input !== 'object') throw new Error('参数无效')
          const value = input as Record<string, unknown>
          if (typeof value.id !== 'string' || !value.id.trim()) {
            throw new Error('forget_memory 需要 id')
          }
          return { id: value.id.trim() }
        },
        execute: async (input: { id: string }, _signal: AbortSignal) => {
          const ok = await this.store.deleteItem(input.id)
          if (!ok) throw new Error('记忆条目不存在')
          return { ok: true as const, id: input.id }
        },
      },
    ]

    for (const tool of tools) {
      if (!this.tools.get(tool.name)) {
        this.tools.register(tool as AgentTool)
      }
    }
  }

  async executeTool(
    name: string,
    rawInput: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`工具不存在：${name}`)
    if (signal.aborted) throw new Error('已取消')
    const input = tool.validate(rawInput)
    return tool.execute(input, signal)
  }

  /**
   * 检索入口：Hybrid 稀疏+向量 + pin/importance 重排。
   */
  async retrieve(query: string, topK = 8, now = new Date()): Promise<MemoryItem[]> {
    return retrieveMemories(
      this.store.getActiveItems(now),
      query,
      topK,
      now,
      (id) => this.store.getVector(id),
    )
  }

  async recall(query: string, topK = 8, now = new Date()): Promise<MemoryItem[]> {
    const retrieved = await this.retrieve(query, topK, now)
    // 保证高重要度画像在空查询或弱相关时仍尽量进入结果
    if (!query.trim()) return retrieved

    const profiles = this.store
      .getActiveItems(now)
      .filter((item) => item.type === 'profile')
      .sort(
        (a, b) =>
          Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
          b.importance - a.importance ||
          b.updatedAt.localeCompare(a.updatedAt),
      )
      .slice(0, 4)

    const merged = [...profiles, ...retrieved]
    const seen = new Set<string>()
    return merged
      .filter((item) => {
        if (seen.has(item.id)) return false
        seen.add(item.id)
        return true
      })
      .slice(0, Math.max(topK, profiles.length))
  }

  async ensureSessionSummary(input: {
    sessionId: string
    messages: ChatMessage[]
    budget: number
    config: ProviderRuntimeConfig
    signal: AbortSignal
  }): Promise<string | undefined> {
    const complete = input.messages.filter(
      (message) => message.status === 'complete' && message.content.trim(),
    )
    const total = complete.reduce((sum, message) => sum + message.content.length, 0)
    if (total <= input.budget) return this.store.getSummary(input.sessionId)?.summary

    const keepChars = Math.floor(input.budget * (1 - SUMMARY_BUDGET_RATIO - MEMORY_BUDGET_RATIO))
    let used = 0
    const recent: ChatMessage[] = []
    for (let index = complete.length - 1; index >= 0; index -= 1) {
      const message = complete[index]
      if (!message) continue
      if (recent.length > 0 && used + message.content.length > keepChars) break
      recent.unshift(message)
      used += message.content.length
    }
    const recentIds = new Set(recent.map((message) => message.id))
    const early = complete.filter((message) => !recentIds.has(message.id))
    if (early.length === 0) return this.store.getSummary(input.sessionId)?.summary

    const existing = this.store.getSummary(input.sessionId)
    const lastEarly = early.at(-1)
    if (
      existing &&
      lastEarly &&
      existing.coveredUntilMessageId === lastEarly.id
    ) {
      return existing.summary
    }

    let summary = fallbackSummaryFromMessages(early)
    if (this.summarize) {
      try {
        const generated = await this.summarize(early, input.config, input.signal)
        if (generated.trim()) summary = generated.trim()
      } catch {
        // keep fallback
      }
    }

    if (lastEarly) {
      await this.store.upsertSummary({
        sessionId: input.sessionId,
        summary,
        coveredUntilMessageId: lastEarly.id,
        updatedAt: new Date().toISOString(),
      })
    }
    return summary
  }

  async assemble(input: {
    sessionId: string
    packageId: string
    messages: ChatMessage[]
    query: string
    config: ProviderRuntimeConfig
    signal: AbortSignal
    budget?: number
  }): Promise<AssembledContext> {
    const budget = input.budget ?? DEFAULT_BUDGET
    const recalledItems = await this.recall(input.query)
    await this.store.touchAccessed(recalledItems.map((item) => item.id))
    const sessionSummary = await this.ensureSessionSummary({
      sessionId: input.sessionId,
      messages: input.messages,
      budget,
      config: input.config,
      signal: input.signal,
    })

    const persona = this.readPersona(input.packageId).trim()
    const rolePrompt = persona || DEFAULT_SYSTEM_PROMPT
    const memoryBlock = formatMemoryBlock(recalledItems, Math.floor(budget * MEMORY_BUDGET_RATIO))
    const summaryBlock = sessionSummary
      ? truncateText(`【会话摘要】\n${sessionSummary}`, Math.floor(budget * SUMMARY_BUDGET_RATIO))
      : ''
    const systemPrompt = [rolePrompt, memoryBlock, summaryBlock]
      .filter(Boolean)
      .join('\n\n')

    const remaining = Math.max(
      1_000,
      budget - systemPrompt.length - Math.floor(budget * 0.05),
    )
    const recentMessages = trimToBudget(input.messages, remaining)
    return { systemPrompt, recentMessages, recalledItems, sessionSummary }
  }
}

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1))}…`
}

function formatMemoryBlock(items: MemoryItem[], maxChars: number): string {
  if (items.length === 0) return ''
  const ordered = [...items].sort(
    (a, b) =>
      Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
      b.importance - a.importance,
  )
  const lines: string[] = []
  let used = `【长期记忆｜跨模型共享用户画像与事实】\n`.length
  for (const item of ordered) {
    const label = item.key ? `${item.type}:${item.key}` : item.type
    const pin = item.pinned ? '📌' : ''
    const line = `- ${pin}(${item.importance}) ${label}：${item.content}`
    if (used + line.length + 1 > maxChars && lines.length > 0) break
    lines.push(line)
    used += line.length + 1
  }
  return truncateText(
    `【长期记忆｜跨模型共享用户画像与事实】\n${lines.join('\n')}`,
    maxChars,
  )
}

function trimToBudget(messages: ChatMessage[], maxCharacters: number): ChatMessage[] {
  const eligible = messages.filter(
    (message) => message.status === 'complete' && message.content.trim(),
  )
  const result: ChatMessage[] = []
  let used = 0
  for (let index = eligible.length - 1; index >= 0; index -= 1) {
    const message = eligible[index]
    if (!message) continue
    if (result.length > 0 && used + message.content.length > maxCharacters) break
    result.unshift(message)
    used += message.content.length
  }
  return result
}
