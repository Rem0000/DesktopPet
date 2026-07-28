import { describe, expect, it } from 'vitest'
import {
  normalizeProviderError,
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
