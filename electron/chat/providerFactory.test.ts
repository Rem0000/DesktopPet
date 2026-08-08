import { describe, expect, it } from 'vitest'
import { createProvider } from './providerFactory'
import { normalizeProviderError } from './deepSeekProvider'

describe('createProvider（Provider 工厂）', () => {
  it('deepseek 返回可用的 ChatProvider', () => {
    const provider = createProvider('deepseek')
    expect(provider.kind).toBe('deepseek')
    expect(typeof provider.stream).toBe('function')
    expect(typeof provider.summarize).toBe('function')
    expect(typeof provider.completeText).toBe('function')
  })

  it('未知 kind 回退 DeepSeek，不抛错（防配置漂移）', () => {
    const provider = createProvider('anthropic')
    expect(provider.kind).toBe('deepseek')
  })

  it('缺省 kind 默认 deepseek', () => {
    expect(createProvider().kind).toBe('deepseek')
  })
})

describe('normalizeProviderError 参数化', () => {
  it('kind 注入到错误文案', () => {
    const auth = normalizeProviderError({ status: 401 }, 'Anthropic')
    expect(auth.message).toContain('Anthropic')
    const network = normalizeProviderError({ code: 'ENOTFOUND' }, 'Ollama')
    expect(network.message).toContain('Ollama')
  })

  it('缺省 kind 保持默认文案', () => {
    expect(normalizeProviderError({ status: 401 }).message).toContain('DeepSeek')
  })
})
