import { describe, expect, it } from 'vitest'
import { TavilyService } from './tavilyService'
import { isSafeHttpUrl } from './urlSafety'

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('urlSafety', () => {
  it('接受公开 http/https', () => {
    expect(isSafeHttpUrl('https://example.com/article')).toEqual({ ok: true })
    expect(isSafeHttpUrl('http://example.com')).toEqual({ ok: true })
  })

  it('拒绝非 http/https', () => {
    expect(isSafeHttpUrl('ftp://example.com').ok).toBe(false)
    expect(isSafeHttpUrl('file:///etc/passwd').ok).toBe(false)
    expect(isSafeHttpUrl('javascript:alert(1)').ok).toBe(false)
  })

  it('拒绝 localhost 与私有 IP', () => {
    expect(isSafeHttpUrl('http://localhost:3000').ok).toBe(false)
    expect(isSafeHttpUrl('http://127.0.0.1/').ok).toBe(false)
    expect(isSafeHttpUrl('http://10.0.0.1/').ok).toBe(false)
    expect(isSafeHttpUrl('http://192.168.1.1/').ok).toBe(false)
    expect(isSafeHttpUrl('http://172.16.0.1/').ok).toBe(false)
    expect(isSafeHttpUrl('http://169.254.169.254/').ok).toBe(false)
  })

  it('拒绝超长 URL', () => {
    expect(isSafeHttpUrl(`https://example.com/${'a'.repeat(3000)}`).ok).toBe(false)
  })
})

describe('TavilyService.search', () => {
  it('返回结构化命中与 answer', async () => {
    const fetchImpl = async (_url: string | Request | URL, _init?: RequestInit): Promise<Response> =>
      jsonResponse({
        answer: '2026 年秋招时间线',
        results: [
          {
            title: '秋招信息汇总',
            url: 'https://example.com/autumn',
            content: '各大厂秋招 8 月启动',
            score: 0.9,
            published_date: '2026-07-01',
          },
          {
            title: '简历准备指南',
            url: 'https://example.com/resume',
            content: '重点突出项目经验',
          },
          { content: '缺少标题与 url 的脏数据' },
        ],
      })
    const service = new TavilyService('test-key', 'https://api.tavily.com', fetchImpl)
    const output = await service.search({ query: '2026 秋招', maxResults: 5 })
    expect(output.ok).toBe(true)
    expect(output.hits).toHaveLength(2)
    expect(output.hits[0]).toMatchObject({
      title: '秋招信息汇总',
      url: 'https://example.com/autumn',
      score: 0.9,
      publishedDate: '2026-07-01',
    })
    expect(output.answer).toContain('秋招')
    expect(output.empty).toBe(false)
  })

  it('空结果返回 empty', async () => {
    const fetchImpl = async (): Promise<Response> => jsonResponse({ results: [] })
    const service = new TavilyService('test-key', 'https://api.tavily.com', fetchImpl)
    const output = await service.search({ query: '不存在的东西' })
    expect(output.ok).toBe(true)
    expect(output.hits).toHaveLength(0)
    expect(output.empty).toBe(true)
  })

  it('HTTP 401 报 Key 无效', async () => {
    const fetchImpl = async (): Promise<Response> =>
      jsonResponse({ error: 'unauthorized' }, 401)
    const service = new TavilyService('bad-key', 'https://api.tavily.com', fetchImpl)
    await expect(service.search({ query: 'x' })).rejects.toThrow(/Key 无效/)
  })
})

describe('TavilyService.extract', () => {
  it('返回目标 URL 的正文', async () => {
    const fetchImpl = async (_url: string | Request | URL, _init?: RequestInit): Promise<Response> =>
      jsonResponse({
        results: [
          { url: 'https://example.com/page', rawContent: '# 标题\n正文内容' },
          { url: 'https://other.com/x', rawContent: '无关页面' },
        ],
        failedResults: [],
      })
    const service = new TavilyService('test-key', 'https://api.tavily.com', fetchImpl)
    const output = await service.extract({ url: 'https://example.com/page' })
    expect(output.ok).toBe(true)
    expect(output.content).toContain('# 标题')
    expect(output.empty).toBe(false)
  })

  it('抓取不到内容返回 empty', async () => {
    const fetchImpl = async (): Promise<Response> =>
      jsonResponse({ results: [], failedResults: [{ url: 'https://example.com/x' }] })
    const service = new TavilyService('test-key', 'https://api.tavily.com', fetchImpl)
    const output = await service.extract({ url: 'https://example.com/x' })
    expect(output.ok).toBe(true)
    expect(output.content).toBe('')
    expect(output.empty).toBe(true)
  })
})
