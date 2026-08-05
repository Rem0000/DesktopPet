import type { WebSearchHit, WebSearchOutput, WebFetchOutput } from '../../src/chat/contracts'

const SEARCH_CHARS = 280
const EXTRACT_CHARS = 4_000
const DEFAULT_TIMEOUT_MS = 20_000

export type TavilySearchInput = {
  query: string
  maxResults?: number
  searchDepth?: 'basic' | 'advanced'
  includeAnswer?: boolean
  signal?: AbortSignal
}

export type TavilyExtractInput = {
  url: string
  signal?: AbortSignal
}

type SearchHitRaw = {
  title?: unknown
  url?: unknown
  content?: unknown
  score?: unknown
  published_date?: unknown
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeHit(raw: SearchHitRaw): WebSearchHit | null {
  const title = asString(raw.title)
  const url = asString(raw.url)
  const content = asString(raw.content)
  if (!title && !url) return null
  const hit: WebSearchHit = {
    title: title || url,
    url: url || '',
    content: content.slice(0, SEARCH_CHARS),
  }
  const score = asNumber(raw.score)
  if (score !== undefined) hit.score = score
  const publishedDate = asString(raw.published_date)
  if (publishedDate) hit.publishedDate = publishedDate
  return hit
}

/**
 * Tavily API 封装：/search（联网搜索）+ /extract（网页抓取）。
 * fetchImpl 可注入便于单测。错误一律抛出，由工具层转为 ok:false。
 */
export class TavilyService {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.tavily.com',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async post(
    endpoint: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
    const onAbort = () => controller.abort()
    if (signal) {
      if (signal.aborted) controller.abort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: this.apiKey, ...body }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const status = response.status
        if (status === 401 || status === 403) throw new Error('Tavily API Key 无效或无权限')
        if (status === 429) throw new Error('Tavily 请求过于频繁，请稍后重试')
        if (status >= 500) throw new Error('Tavily 服务暂时不可用')
        throw new Error(`Tavily 请求失败（HTTP ${status}）`)
      }
      return await response.json()
    } finally {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }
  }

  async search(input: TavilySearchInput): Promise<WebSearchOutput> {
    const response = (await this.post(
      '/search',
      {
        query: input.query,
        max_results: input.maxResults ?? 5,
        search_depth: input.searchDepth ?? 'basic',
        include_answer: input.includeAnswer ?? false,
      },
      input.signal,
    )) as { answer?: unknown; results?: unknown }

    const rawList = Array.isArray(response.results) ? response.results : []
    const hits: WebSearchHit[] = []
    for (const raw of rawList) {
      if (!raw || typeof raw !== 'object') continue
      const hit = normalizeHit(raw as SearchHitRaw)
      if (hit) hits.push(hit)
    }
    const output: WebSearchOutput = { ok: true, hits, empty: hits.length === 0 }
    const answer = asString(response.answer)
    if (answer) output.answer = answer
    return output
  }

  async extract(input: TavilyExtractInput): Promise<WebFetchOutput> {
    const response = (await this.post(
      '/extract',
      { urls: [input.url], format: 'markdown' },
      input.signal,
    )) as { results?: unknown; failedResults?: unknown }

    const rawList = Array.isArray(response.results) ? response.results : []
    let content = ''
    for (const raw of rawList) {
      if (!raw || typeof raw !== 'object') continue
      const value = raw as { url?: unknown; rawContent?: unknown; content?: unknown }
      if (asString(value.url) !== input.url) continue
      content = asString(value.rawContent) || asString(value.content)
      if (content) break
    }
    return {
      ok: true,
      url: input.url,
      content: content.slice(0, EXTRACT_CHARS),
      empty: !content,
    }
  }
}
