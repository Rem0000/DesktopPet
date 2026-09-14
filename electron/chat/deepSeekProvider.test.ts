import { describe, expect, it } from 'vitest'
import {
  estimateTokens,
  estimateUsage,
  normalizeProviderError,
  toTokenUsage,
  validateProviderConfig,
} from './deepSeekProvider'

describe('DeepSeek Provider', () => {
  it('规范化有效配置并拒绝危险协议', () => {
    expect(
      validateProviderConfig({
        baseUrl: 'https://api.deepseek.com/',
        model: 'deepseek-chat',
      }),
    ).toMatchObject({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    })
    expect(() =>
      validateProviderConfig({
        baseUrl: 'file:///secret',
        model: 'deepseek-chat',
      }),
    ).toThrow('HTTP(S)')
  })

  it('归一化鉴权、限流、网络和取消错误', () => {
    expect(normalizeProviderError({ status: 401 }).code).toBe('authentication')
    expect(normalizeProviderError({ status: 429 })).toMatchObject({
      code: 'rate_limit',
      retryable: true,
    })
    expect(normalizeProviderError({ code: 'ENOTFOUND' }).code).toBe('network')
    expect(normalizeProviderError({ name: 'AbortError' }).code).toBe('cancelled')
  })

  it('错误信息不会复述第三方响应或 API Key', () => {
    const error = normalizeProviderError({
      status: 500,
      message: 'request Authorization: Bearer secret-key',
    })
    expect(error.message).not.toContain('secret-key')
    expect(error.code).toBe('server')
  })
})

describe('token 用量映射', () => {
  it('四类计数互斥：未缓存输入 = prompt − 缓存读', () => {
    const usage = toTokenUsage(
      {
        input_tokens: 1_000,
        output_tokens: 120,
        input_token_details: { cache_read: 800 },
        output_token_details: { reasoning: 40 },
      },
      undefined,
    )
    expect(usage).toEqual({
      inputTokens: 200,
      outputTokens: 120,
      cacheReadTokens: 800,
      cacheWriteTokens: 0,
      reasoningTokens: 40,
    })
  })

  it('兼容 provider 原始字段与 DeepSeek 缓存命中字段', () => {
    const usage = toTokenUsage(undefined, {
      prompt_tokens: 500,
      completion_tokens: 60,
      prompt_cache_hit_tokens: 300,
      completion_tokens_details: { reasoning_tokens: 12 },
    })
    expect(usage).toMatchObject({
      inputTokens: 200,
      outputTokens: 60,
      cacheReadTokens: 300,
      reasoningTokens: 12,
    })
  })

  it('两套字段都缺失时返回 undefined，交由调用方估算', () => {
    expect(toTokenUsage(undefined, undefined)).toBeUndefined()
    expect(toTokenUsage({}, {})).toBeUndefined()
  })
})

describe('token 估算兜底', () => {
  it('CJK 按字计、非 CJK 按 4 字符计', () => {
    expect(estimateTokens('你好世界')).toBe(4)
    expect(estimateTokens('abcdefgh')).toBe(2)
    expect(estimateTokens('')).toBe(0)
  })

  it('估算结果 MUST 标记 estimated', () => {
    const usage = estimateUsage('你好', 'hi')
    expect(usage.estimated).toBe(true)
    expect(usage.inputTokens).toBe(2)
    expect(usage.outputTokens).toBe(1)
    expect(usage.cacheReadTokens).toBe(0)
  })
})
