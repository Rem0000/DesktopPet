import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { EpisodeConfig } from '../../src/chat/contracts'

const FILE_NAME = 'episode-config.json'

export const DEFAULT_EPISODE_CONFIG: Required<Omit<EpisodeConfig, 'version'>> = {
  enabled: true,
  minMessages: 6,
  intervalMessages: 6,
  maxEpisodes: 4,
}

function sanitizeInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.max(1, Math.round(value))
  return rounded > 50 ? fallback : rounded
}

/** 读取 episode 自动沉淀配置；缺失/非法一律回退默认，绝不中断聊天 */
export async function loadEpisodeConfig(
  storageDirectory: string,
): Promise<EpisodeConfig> {
  const filePath = path.join(storageDirectory, FILE_NAME)
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== 1) {
      return { version: 1 }
    }
    const value = parsed as Partial<EpisodeConfig>
    return {
      version: 1,
      enabled: typeof value.enabled === 'boolean' ? value.enabled : undefined,
      minMessages: sanitizeInt(value.minMessages, DEFAULT_EPISODE_CONFIG.minMessages),
      intervalMessages: sanitizeInt(
        value.intervalMessages,
        DEFAULT_EPISODE_CONFIG.intervalMessages,
      ),
      maxEpisodes: sanitizeInt(value.maxEpisodes, DEFAULT_EPISODE_CONFIG.maxEpisodes),
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      // 解析失败也回退默认，不抛出
    }
    return { version: 1 }
  }
}

export function episodeConfigValues(config: EpisodeConfig): Required<Omit<EpisodeConfig, 'version'>> {
  return {
    enabled: config.enabled ?? DEFAULT_EPISODE_CONFIG.enabled,
    minMessages: config.minMessages ?? DEFAULT_EPISODE_CONFIG.minMessages,
    intervalMessages: config.intervalMessages ?? DEFAULT_EPISODE_CONFIG.intervalMessages,
    maxEpisodes: config.maxEpisodes ?? DEFAULT_EPISODE_CONFIG.maxEpisodes,
  }
}
