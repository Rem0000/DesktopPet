import type {
  AgentTool,
  ChatMessage,
  GuardConfig,
  HistoryHit,
  HistorySearchInput,
} from '../../src/chat/contracts'
import { Bm25Index } from '../retrieval/bm25Index'
import type { ChatStore } from './chatStore'
import type { ToolRegistry } from './toolRegistry'
import { markUntrustedList } from './untrustedContent'

const EXCERPT_CHARS = 280

/** search_history 成功结果渲染：命中 excerpt 逐字透传 + 不可信区隔离 + 引用 MUST 约束；空命中如实说明 */
function renderSearchHistory(output: unknown, guardConfig?: GuardConfig): string {
  const o = (typeof output === 'object' && output !== null ? output : {}) as {
    hits?: Array<{ excerpt?: string }>
  }
  const hits = Array.isArray(o.hits) ? o.hits : []
  const excerpts = hits
    .map((hit) => (typeof hit.excerpt === 'string' ? hit.excerpt : ''))
    .filter((excerpt) => excerpt.length > 0)
  if (excerpts.length === 0) {
    return 'search_history：历史中未找到相关内容。回复 MUST 如实说明未找到，禁止编造或声称存在。'
  }
  const guarded = markUntrustedList('search_history', excerpts, guardConfig)
  return `search_history：找到 ${hits.length} 条历史记录，原文如下（引用 MUST 逐字取自以下 excerpt，不得补充结果外的内容）：\n${guarded.split('\n').join('\n  ')}`
}

/**
 * 包级历史会话按需检索：`search_history` 白名单工具。
 * 仅 BM25（稀疏），不依赖向量 Embedding；作用域限定当前活跃 Live2D 包的全部会话。
 */
export class HistorySearchService {
  constructor(
    private readonly store: ChatStore,
    private readonly tools: ToolRegistry,
    private readonly getActivePackageId: () => string | null,
  ) {}

  registerDefaultTools(): void {
    const tool: AgentTool<HistorySearchInput, unknown> = {
      name: 'search_history',
      enabled: true,
      riskLevel: 'safe',
      description:
        '在当前模型的全部历史会话中检索已完成的对话原文。当用户引用更早的对话（如「我之前说过…」「上次你说…」）且当前上下文中缺少该细节时调用；无命中返回空列表，不要编造。普通闲聊不要调用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索查询' },
          topK: { type: 'number', description: '返回条数，默认 4，最大 8' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      validate: (input: unknown) => {
        if (!input || typeof input !== 'object') throw new Error('参数无效')
        const value = input as Record<string, unknown>
        if (typeof value.query !== 'string' || !value.query.trim()) {
          throw new Error('search_history 需要 query')
        }
        const topK =
          typeof value.topK === 'number' && Number.isFinite(value.topK)
            ? Math.min(8, Math.max(1, Math.floor(value.topK)))
            : 4
        return { query: value.query.trim(), topK }
      },
      execute: async (rawInput: unknown, _signal: AbortSignal) => {
        const input = rawInput as HistorySearchInput
        const packageId = this.getActivePackageId()
        if (!packageId) {
          return {
            ok: false as const,
            errorCode: 'no_active_package',
            error: '无当前模型，无法检索历史',
          }
        }
        const hits = await this.search(packageId, input.query, input.topK)
        return { ok: true as const, hits, empty: hits.length === 0 }
      },
      renderForModel: (output, guardConfig) => renderSearchHistory(output, guardConfig),
    }
    if (!this.tools.get(tool.name)) this.tools.register(tool as AgentTool)
  }

  async search(packageId: string, query: string, topK = 4): Promise<HistoryHit[]> {
    if (!query.trim()) return []
    const sessions = this.store.listSessions(packageId)
    const rows: Array<{
      id: string
      sessionId: string
      role: ChatMessage['role']
      createdAt: string
      content: string
    }> = []
    for (const summary of sessions) {
      const session = this.store.getSession(summary.id)
      if (!session) continue
      for (const message of session.messages) {
        if (message.status !== 'complete' || !message.content.trim()) continue
        rows.push({
          id: message.id,
          sessionId: message.sessionId,
          role: message.role,
          createdAt: message.createdAt,
          content: message.content,
        })
      }
    }
    if (rows.length === 0) return []

    const index = new Bm25Index()
    index.build(rows.map((row) => ({ id: row.id, text: row.content })))
    const hits = index.search(query, topK)
    const byId = new Map(rows.map((row) => [row.id, row]))
    return hits
      .map((hit) => {
        const row = byId.get(hit.id)
        if (!row) return null
        return {
          messageId: row.id,
          sessionId: row.sessionId,
          role: row.role,
          createdAt: row.createdAt,
          excerpt: row.content.slice(0, EXCERPT_CHARS),
          score: hit.score,
        } satisfies HistoryHit
      })
      .filter((hit): hit is HistoryHit => hit !== null)
  }
}
