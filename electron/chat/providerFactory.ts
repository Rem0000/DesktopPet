import type { ChatProvider, ProviderRuntimeConfig } from '../../src/chat/contracts'
import { DeepSeekProvider } from './deepSeekProvider'

/**
 * Provider 工厂：按 kind 分发到具体实现。当前仅 DeepSeek。
 * 新增 Provider 时在此加分支（如 'anthropic' / 'ollama'），
 * 步骤见 docs/providers.md。未知 kind 回退 DeepSeek，防配置漂移。
 */
export function createProvider(
  kind: string = 'deepseek',
  _config?: ProviderRuntimeConfig,
): ChatProvider {
  switch (kind) {
    case 'deepseek':
      return new DeepSeekProvider()
    default:
      return new DeepSeekProvider()
  }
}
