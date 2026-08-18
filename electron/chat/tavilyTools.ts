import type { AgentTool, GuardConfig } from '../../src/chat/contracts'
import type { ToolRegistry } from './toolRegistry'
import { TavilyService } from './tavilyService'
import { isSafeHttpUrl } from './urlSafety'
import { markUntrustedBlock, markUntrustedList } from './untrustedContent'

/** web_search 成功结果渲染：hits + AI answer 逐字透传 + 不可信区隔离 + 引用 MUST 约束；空命中如实说明 */
function renderWebSearch(output: unknown, guardConfig?: GuardConfig): string {
  const o = (typeof output === 'object' && output !== null ? output : {}) as {
    hits?: Array<{ title?: string; url?: string; content?: string }>
    answer?: string
  }
  const hits = Array.isArray(o.hits) ? o.hits : []
  if (hits.length === 0) {
    return 'web_search：未搜索到相关内容。回复 MUST 如实说明未搜到，禁止编造或声称存在。'
  }
  const items = hits.map((hit) => {
    const title = typeof hit.title === 'string' ? hit.title : ''
    const content = typeof hit.content === 'string' ? hit.content : ''
    const url = typeof hit.url === 'string' ? hit.url : ''
    return `${title}（${url}）：${content.replace(/\s+/g, ' ').trim()}`
  })
  const guarded = markUntrustedList('web_search', items, guardConfig)
  let line = `web_search：搜索到 ${hits.length} 条结果，如下（引用 MUST 逐字取自以下 content，不得补充结果外的内容）：\n${guarded.split('\n').join('\n  ')}`
  const answer = o.answer
  if (typeof answer === 'string' && answer.trim()) {
    line += `\n- web_search AI 摘要：${answer.replace(/\s+/g, ' ').trim()}`
  }
  return line
}

/** web_fetch 成功结果渲染：正文 markUntrustedBlock 隔离 + 基于原文约束；无正文如实说明 */
function renderWebFetch(output: unknown, guardConfig?: GuardConfig): string {
  const o = (typeof output === 'object' && output !== null ? output : {}) as {
    content?: string
  }
  const content = typeof o.content === 'string' ? o.content : ''
  if (!content.trim()) {
    return 'web_fetch：未能提取到网页正文。回复 MUST 如实说明，禁止编造页面内容。'
  }
  const guarded = markUntrustedBlock(
    'web_fetch',
    content.replace(/\s+/g, ' ').trim(),
    guardConfig,
  )
  return `web_fetch：抓取到网页正文如下（内容 MUST 基于以下原文，不得虚构页面中没有的信息）：\n${guarded.split('\n').join('\n  ')}`
}

/** 注册 web_search（safe）+ web_fetch（confirm）两个联网白名单工具 */
export function registerTavilyTools(service: TavilyService, tools: ToolRegistry): void {
  const searchTool: AgentTool<{ query: string; maxResults: number; searchDepth: 'basic' | 'advanced' }, unknown> = {
    name: 'web_search',
    enabled: true,
    riskLevel: 'safe',
    description:
      '搜索互联网获取实时/外部信息。当用户询问最新新闻、实时数据、外部网站内容且本地知识库没有对应内容时调用；返回结构化结果与可选摘要，不要编造结果。普通闲聊不要调用。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索查询' },
        maxResults: { type: 'number', description: '返回条数，默认 5，最大 8' },
        searchDepth: {
          type: 'string',
          enum: ['basic', 'advanced'],
          description: '搜索深度，basic 快 / advanced 更准但更慢，默认 basic',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    validate: (input: unknown) => {
      if (!input || typeof input !== 'object') throw new Error('参数无效')
      const value = input as Record<string, unknown>
      if (typeof value.query !== 'string' || !value.query.trim()) {
        throw new Error('web_search 需要 query')
      }
      const maxResults =
        typeof value.maxResults === 'number' && Number.isFinite(value.maxResults)
          ? Math.min(8, Math.max(1, Math.floor(value.maxResults)))
          : 5
      const searchDepth = value.searchDepth === 'advanced' ? 'advanced' : 'basic'
      return { query: value.query.trim().slice(0, 200), maxResults, searchDepth }
    },
    execute: async (input, signal) => service.search({ ...input, signal }),
    renderForModel: (output, guardConfig) => renderWebSearch(output, guardConfig),
  }

  const fetchTool: AgentTool<{ url: string }, unknown> = {
    name: 'web_fetch',
    enabled: true,
    riskLevel: 'confirm',
    description:
      '抓取指定网页的正文内容（Markdown）。通常先用 web_search 找到 URL 再调用；仅支持公开 http/https 网页，执行前需用户确认。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要抓取的网页 URL' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    validate: (input: unknown) => {
      if (!input || typeof input !== 'object') throw new Error('参数无效')
      const value = input as Record<string, unknown>
      if (typeof value.url !== 'string' || !value.url.trim()) {
        throw new Error('web_fetch 需要 url')
      }
      const url = value.url.trim()
      const check = isSafeHttpUrl(url)
      if (!check.ok) throw new Error(check.reason)
      return { url }
    },
    execute: async (input, signal) => service.extract({ url: input.url, signal }),
    renderForModel: (output, guardConfig) => renderWebFetch(output, guardConfig),
  }

  if (!tools.get(searchTool.name)) tools.register(searchTool as AgentTool)
  if (!tools.get(fetchTool.name)) tools.register(fetchTool as AgentTool)
}
