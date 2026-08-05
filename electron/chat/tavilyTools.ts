import type { AgentTool } from '../../src/chat/contracts'
import type { ToolRegistry } from './toolRegistry'
import { TavilyService } from './tavilyService'
import { isSafeHttpUrl } from './urlSafety'

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
  }

  if (!tools.get(searchTool.name)) tools.register(searchTool as AgentTool)
  if (!tools.get(fetchTool.name)) tools.register(fetchTool as AgentTool)
}
