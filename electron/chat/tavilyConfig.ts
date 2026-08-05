import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { TavilyConfigFile } from '../../src/chat/contracts'

const FILE_NAME = 'tavily-config.json'

/**
 * Tavily API Key 来源：环境变量 `TAVILY_API_KEY` 优先，否则读 `data/config/tavily-config.json`。
 * 仅主进程持有，不 round-trip 到渲染进程；无 key 返回 null。
 */
export async function loadTavilyConfig(
  storageDirectory: string,
): Promise<{ apiKey: string } | null> {
  const envKey = process.env.TAVILY_API_KEY?.trim()
  if (envKey) return { apiKey: envKey }

  const filePath = path.join(storageDirectory, FILE_NAME)
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const candidate = parsed as Partial<TavilyConfigFile>
    if (candidate.version !== 1) return null
    const apiKey = typeof candidate.apiKey === 'string' ? candidate.apiKey.trim() : ''
    return apiKey ? { apiKey } : null
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      // 解析失败按未配置处理，不抛出
    }
    return null
  }
}
