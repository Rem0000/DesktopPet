import type { AgentTool, KnowledgeCitation } from '../../src/chat/contracts'
import type { ToolRegistry } from './toolRegistry'
import type { KnowledgeHit, KnowledgeStore } from './knowledgeStore'

export class KnowledgeService {
  constructor(
    private readonly store: KnowledgeStore,
    private readonly tools: ToolRegistry,
  ) {}

  registerDefaultTools(): void {
    const tool: AgentTool = {
      name: 'search_knowledge',
      enabled: true,
      riskLevel: 'safe',
      description:
        '在本地知识库中检索相关文档片段。当用户询问项目说明、导入资料、文档细节时调用。无命中时返回空列表，不要编造内容。',
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
          throw new Error('search_knowledge 需要 query')
        }
        const topK =
          typeof value.topK === 'number' && Number.isFinite(value.topK)
            ? Math.min(8, Math.max(1, Math.floor(value.topK)))
            : 4
        return { query: value.query.trim(), topK }
      },
      execute: async (rawInput: unknown, _signal: AbortSignal) => {
        const input = rawInput as { query: string; topK: number }
        const hits = await this.store.search(input.query, input.topK)
        return {
          ok: true as const,
          hits: hits.map(toCitationPayload),
          empty: hits.length === 0,
        }
      },
    }
    if (!this.tools.get(tool.name)) this.tools.register(tool)
  }

  async search(query: string, topK = 4): Promise<KnowledgeHit[]> {
    return this.store.search(query, topK)
  }
}

function toCitationPayload(hit: KnowledgeHit) {
  return {
    documentId: hit.documentId,
    chunkId: hit.chunkId,
    title: hit.title,
    sourceName: hit.sourceName,
    excerpt: hit.content.slice(0, 280),
    score: hit.score,
    headingPath: hit.headingPath,
    recallSource: hit.recallSource,
  }
}

export function citationsFromToolOutput(output: unknown): KnowledgeCitation[] {
  if (!output || typeof output !== 'object') return []
  const hits = (output as { hits?: unknown }).hits
  if (!Array.isArray(hits)) return []
  return hits
    .map((hit) => {
      if (!hit || typeof hit !== 'object') return null
      const value = hit as Record<string, unknown>
      if (
        typeof value.documentId !== 'string' ||
        typeof value.chunkId !== 'string' ||
        typeof value.title !== 'string' ||
        typeof value.sourceName !== 'string' ||
        typeof value.excerpt !== 'string'
      ) {
        return null
      }
      const citation: KnowledgeCitation = {
        documentId: value.documentId,
        chunkId: value.chunkId,
        title: value.title,
        sourceName: value.sourceName,
        excerpt: value.excerpt,
      }
      if (typeof value.score === 'number') citation.score = value.score
      if (Array.isArray(value.headingPath)) {
        citation.headingPath = value.headingPath.filter(
          (part): part is string => typeof part === 'string',
        )
      }
      if (
        value.recallSource === 'sparse' ||
        value.recallSource === 'vector' ||
        value.recallSource === 'both'
      ) {
        citation.recallSource = value.recallSource
      }
      return citation
    })
    .filter((item): item is KnowledgeCitation => item !== null)
}
