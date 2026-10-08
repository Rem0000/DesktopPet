import type {
  ChatMessage,
  MemoryImportance,
  MemoryItem,
  MemoryWriteInput,
  ProviderRuntimeConfig,
  RelationshipState,
  AgentTool,
} from '../../src/chat/contracts'
import { isContextDebugEnabled, logContext } from './contextDebug'
import { embedQuery } from '../retrieval/embeddingService'
import { hybridSearch } from '../retrieval/hybridSearch'
import { trimContextWeighted } from './messageImportance'
import { buildRelationshipLayer } from '../relationship/relationshipRender'
import { localDateKey, localDateLabel } from './dateUtils'
import { DEFAULT_SYSTEM_PROMPT } from './deepSeekProvider'
import type { MemoryStore } from './memoryStore'
import { assertSafeMemoryContent } from './memoryStore'
import type { ToolRegistry } from './toolRegistry'
import { markUntrustedBlock } from './untrustedContent'
import type { GuardConfig } from '../../src/chat/contracts'
import { validateContent, validateNumber, requireFields } from '../security/inputValidator'

export type AssembledContext = {
  systemPrompt: string
  recentMessages: ChatMessage[]
  recalledItems: MemoryItem[]
  sessionSummary?: string
  /** 长期记忆检索块的字符数（供上下文占用拆分观测；无召回时为 0） */
  memoryCharacters?: number
  /** 会话摘要块的字符数（供上下文占用拆分观测） */
  summaryCharacters?: number
}

const DEFAULT_BUDGET = 24_000
const MEMORY_BUDGET_RATIO = 0.18
const SUMMARY_BUDGET_RATIO = 0.12
/** 摘要重新生成闸门：自上次摘要以来新增未覆盖"早期"内容达到该字符数才重算 LLM，
 *  避免会话超预算后每一轮都阻塞等待摘要生成（见 ensureSessionSummary）。 */
const SUMMARY_REGEN_MIN_CHARS = 4_000

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
  searchVector?: (queryVector: number[], topK: number) => Array<{ id: string; score: number }>,
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
      searchVector,
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

/** 早期消息要点列表：头部 + 尾部采样，覆盖最老设定与被挤出窗口的内容 */
export function fallbackSummaryFromMessages(messages: ChatMessage[]): string {
  const eligible = messages.filter(
    (message) => message.status === 'complete' && message.content.trim(),
  )
  const head = eligible.slice(0, 6)
  const tail = eligible.length > 12 ? eligible.slice(-4) : []
  const seen = new Set<string>()
  const sampled = [...head, ...tail].filter((message) => {
    if (seen.has(message.id)) return false
    seen.add(message.id)
    return true
  })
  const points = sampled.map((message) => {
    const prefix = message.role === 'user' ? '用户' : '桌宠'
    const text = message.content.replace(/\s+/g, ' ').trim().slice(0, 48)
    return `- ${prefix}：${text}`
  })
  return points.length ? `早期对话要点：\n${points.join('\n')}` : '（暂无可用摘要）'
}

/** 记忆写入类工具（update_profile/remember_fact）的成功结果渲染：工具专属、如实的结果行 */
function renderMemoryWriteResult(name: string, output: unknown): string {
  const o = (typeof output === 'object' && output !== null ? output : {}) as Record<
    string,
    unknown
  >
  if (o.ok === false) {
    return `- ${name}：未能写入记忆（${typeof o.error === 'string' ? o.error : '操作未完成'}）。回复 MUST 据实说明，禁止声称已写入。`
  }
  const item = o.item as { key?: string; content?: string } | undefined
  const content =
    typeof item?.content === 'string'
      ? item.content.replace(/\s+/g, ' ').trim().slice(0, 80)
      : ''
  if (name === 'update_profile') {
    const key = typeof item?.key === 'string' && item.key ? item.key : ''
    return `- update_profile：已更新画像${key ? `（key=${key}）` : ''}${content ? `：${content}` : '。'}`
  }
  return `- remember_fact：已记住${content ? `：${content}` : '。'}`
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
    private readonly readRelationship?: (
      packageId: string,
    ) => Promise<RelationshipState | null>,
    private readonly dailyMeet?: {
      /** 该包最近一次"首次见面"的本地日期（YYYY-MM-DD），null 表示今日未首见 */
      getLastMeetDate: (packageId: string) => string | null
      /** 记录该包今日已首次见面 */
      setMeetToday: (packageId: string, date: string) => Promise<void>
      /** 注入当前本地日期，便于测试 */
      now?: () => Date
    },
    private readonly guardConfig?: GuardConfig,
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
          // Layer 2: 增强的输入验证
          const value = requireFields<{
            key: string
            content: string
            importance?: number
          }>(input, ['key', 'content'])

          const key = validateContent(value.key, {
            maxLength: 120,
            fieldName: '画像键',
          })

          const content = validateContent(value.content, {
            minLength: 1,
            maxLength: 2_000,
            allowSensitive: false,
            fieldName: '画像内容',
          })

          const importance = value.importance
            ? validateNumber(value.importance, {
                min: 1,
                max: 3,
                integer: true,
                fieldName: '重要性',
              })
            : undefined

          return {
            content,
            key,
            importance: importance as MemoryImportance | undefined,
            sourceSessionId:
              typeof (value as Record<string, unknown>).sourceSessionId === 'string'
                ? ((value as Record<string, unknown>).sourceSessionId as string)
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
        renderForModel: (output: unknown) => renderMemoryWriteResult('update_profile', output),
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
          // Layer 2: 增强的输入验证
          const value = requireFields<{
            content: string
            key?: string
            importance?: number
            expiresAt?: string
          }>(input, ['content'])

          const content = validateContent(value.content, {
            minLength: 1,
            maxLength: 2_000,
            allowSensitive: false,
            fieldName: '事实内容',
          })

          const key = value.key
            ? validateContent(value.key, {
                maxLength: 120,
                fieldName: '事实键',
              })
            : undefined

          const importance = value.importance
            ? validateNumber(value.importance, {
                min: 1,
                max: 3,
                integer: true,
                fieldName: '重要性',
              })
            : undefined

          return {
            content,
            key,
            importance: importance as MemoryImportance | undefined,
            sourceSessionId:
              typeof (value as Record<string, unknown>).sourceSessionId === 'string'
                ? ((value as Record<string, unknown>).sourceSessionId as string)
                : undefined,
            expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : undefined,
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
        renderForModel: (output: unknown) => renderMemoryWriteResult('remember_fact', output),
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
        renderForModel: (output: unknown) => {
          const o = (typeof output === 'object' && output !== null ? output : {}) as {
            ok?: boolean
            id?: string
          }
          if (o.ok === false) {
            return '- forget_memory：未能删除该记忆（条目不存在或已被删除）。回复 MUST 据实说明，禁止声称已删除。'
          }
          return `- forget_memory：已删除记忆（id=${typeof o.id === 'string' ? o.id : '未知'}）。`
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
      (queryVector, k) => this.store.searchVector(queryVector, k),
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
    /** 被可见窗口丢弃的消息：摘要 MUST 恰好覆盖它们，消除「丢消息无摘要」区 */
    early: ChatMessage[]
    /** 可见窗口消息 id 集合（供闸门计算未覆盖早期内容） */
    recentIds: Set<string>
    config: ProviderRuntimeConfig
    signal: AbortSignal
  }): Promise<string | undefined> {
    if (input.early.length === 0) return this.store.getSummary(input.sessionId)?.summary

    const existing = this.store.getSummary(input.sessionId)
    const lastEarly = input.early.at(-1)
    if (
      existing &&
      lastEarly &&
      existing.coveredUntilMessageId === lastEarly.id
    ) {
      return existing.summary
    }
    // 闸门：与上次摘要相比，新增的未覆盖早期内容不足以支撑一次 LLM 重算时，
    // 沿用旧摘要（缺失的近期细节由 recentMessages 原样呈现）。旧实现因窗口
    // 每轮滑动导致 coveredUntilMessageId 永不命中，使超预算会话每轮都阻塞等摘要。
    if (existing && lastEarly) {
      const coveredIndex = input.messages.findIndex(
        (message) => message.id === existing.coveredUntilMessageId,
      )
      const uncoveredEarlyChars =
        coveredIndex >= 0
          ? input.messages
              .slice(coveredIndex + 1)
              .filter((message) => !input.recentIds.has(message.id))
              .reduce((sum, message) => sum + message.content.length, 0)
          : input.early.reduce((sum, message) => sum + message.content.length, 0)
      if (uncoveredEarlyChars < SUMMARY_REGEN_MIN_CHARS) {
        return existing.summary
      }
    }

    let summary = fallbackSummaryFromMessages(input.early)
    if (this.summarize) {
      try {
        const generated = await this.summarize(input.early, input.config, input.signal)
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
    // [TEMP-DEBUG] 观察滚动摘要生成/更新时机（写 UTF-8 文件避免 cmd 乱码），验证后删除
    if (isContextDebugEnabled()) {
      void logContext([
        {
          label: '会话摘要生成/更新',
          content: `coveredUntilMessageId=${lastEarly?.id ?? '无'} 摘要${summary.length}字符 | ${summary.replace(/\s+/g, ' ').slice(0, 120)}…`,
        },
      ])
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

    const persona = this.readPersona(input.packageId).trim()
    const rolePrompt = persona || DEFAULT_SYSTEM_PROMPT
    const relationshipState =
      (await this.readRelationship?.(input.packageId)) ?? null
    const relationshipLayer = relationshipState
      ? buildRelationshipLayer(relationshipState, relationshipState.policy)
      : ''
    const dailyMeetBlock = await this.buildDailyMeetBlock(input.packageId)
    const memoryBlock = formatMemoryBlock(
      recalledItems,
      Math.floor(budget * MEMORY_BUDGET_RATIO),
      this.guardConfig,
    )
    const systemPromptBase = [rolePrompt, relationshipLayer, dailyMeetBlock, memoryBlock]
      .filter(Boolean)
      .join('\n\n')

    // 摘要槽始终预留 0.12·budget（与 SUMMARY_BUDGET_RATIO 一致），使可见窗口边界
    // 不随「是否已有摘要」漂移；否则摘要首次出现会让窗口收缩，挤出更多未概括消息。
    const summaryReserved = Math.floor(budget * SUMMARY_BUDGET_RATIO)
    const remaining = Math.max(
      1_000,
      budget - systemPromptBase.length - summaryReserved - Math.floor(budget * 0.05),
    )
    const recentMessages = trimToBudget(input.messages, remaining)
    const recentIds = new Set(recentMessages.map((message) => message.id))
    const early = input.messages.filter(
      (message) =>
        message.status === 'complete' &&
        message.content.trim() &&
        !recentIds.has(message.id),
    )

    // 触发点 = 可见窗口首次溢出（early 非空），而非总量超预算：
    // 消息刚被挤出窗口就立刻概括，不存在「既不在窗口里也没被摘要」的丢消息区。
    const sessionSummary = await this.ensureSessionSummary({
      sessionId: input.sessionId,
      messages: input.messages,
      early,
      recentIds,
      config: input.config,
      signal: input.signal,
    })
    const summaryBlock = sessionSummary
      ? truncateText(`【会话摘要】\n${sessionSummary}`, summaryReserved)
      : ''
    const systemPrompt = summaryBlock ? `${systemPromptBase}\n\n${summaryBlock}` : systemPromptBase

    return {
      systemPrompt,
      recentMessages,
      recalledItems,
      sessionSummary,
      memoryCharacters: memoryBlock.length,
      summaryCharacters: summaryBlock.length,
    }
  }

  /**
   * 每日首见状态块：首次对话注入"今天第一次见面"引导 + 当前日期；
   * 同日后续注入"已见过，除非被问否则不重复" + 当前日期。无 dailyMeet 回调时不注入。
   */
  private async buildDailyMeetBlock(packageId: string): Promise<string> {
    if (!this.dailyMeet) return ''
    const now = this.dailyMeet.now?.() ?? new Date()
    const todayKey = localDateKey(now)
    const dateLabel = localDateLabel(now)
    const lastMeet = this.dailyMeet.getLastMeetDate(packageId)
    if (lastMeet === todayKey) {
      return `【今日状态】今天是 ${dateLabel}。你今天已经见过主人了，除非主人主动询问，否则不要重复今日首次见面的行为。`
    }
    await this.dailyMeet.setMeetToday(packageId, todayKey)
    return `【今日首见】今天是 ${dateLabel}，这是你今天第一次见到主人。请按人设完成首次见面的行为（如汇报当日衣着等），并保持人设一致。`
  }
}

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1))}…`
}

function formatMemoryBlock(
  items: MemoryItem[],
  maxChars: number,
  guard?: GuardConfig,
): string {
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
    // 记忆内容用户可写（注入面）：guard 开启时包成不可信区
    const guardedContent = markUntrustedBlock('memory', item.content, {
      enabled: guard?.enabled !== false,
      maxChars: guard?.maxChars,
      maxItems: guard?.maxItems,
      label: guard?.label,
    }).split('\n').join(' ')
    const line = `- ${pin}(${item.importance}) ${label}：${guardedContent}`
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
  return trimContextWeighted(messages, maxCharacters)
}
