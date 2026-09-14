import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  DEFAULT_TRACE_CONFIG,
  type TraceConfig,
  type TraceFsyncMode,
  type TraceLevel,
} from '../../src/trace/contracts'

const FILE_NAME = 'trace-config.json'

const LEVELS: TraceLevel[] = ['off', 'meta', 'full']
const FSYNC_MODES: TraceFsyncMode[] = ['never', 'checkpoint', 'turn']

/** data/config/trace-config.json 的可选字段；version 必须是 1，否则整体回退默认 */
export type TraceConfigFile = {
  version?: 1
  enabled?: boolean
  level?: TraceLevel
  maxFieldChars?: number
  fsync?: TraceFsyncMode
  retentionDays?: number
  maxSessions?: number
  maxFileMB?: number
}

function sanitizeNumber(
  value: unknown,
  min: number,
  max: number,
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const rounded = Math.round(value)
  if (rounded < min || rounded > max) return undefined
  return rounded
}

function sanitizeLevel(value: unknown): TraceLevel | undefined {
  return typeof value === 'string' && LEVELS.includes(value as TraceLevel)
    ? (value as TraceLevel)
    : undefined
}

function sanitizeFsync(value: unknown): TraceFsyncMode | undefined {
  return typeof value === 'string' && FSYNC_MODES.includes(value as TraceFsyncMode)
    ? (value as TraceFsyncMode)
    : undefined
}

function normalize(file: TraceConfigFile | null): TraceConfig {
  if (!file) return { ...DEFAULT_TRACE_CONFIG }
  const level = sanitizeLevel(file.level) ?? DEFAULT_TRACE_CONFIG.level
  const enabled = (file.enabled ?? DEFAULT_TRACE_CONFIG.enabled) && level !== 'off'
  return {
    version: 1,
    enabled,
    level,
    maxFieldChars:
      sanitizeNumber(file.maxFieldChars, 200, 200_000) ??
      DEFAULT_TRACE_CONFIG.maxFieldChars,
    fsync: sanitizeFsync(file.fsync) ?? DEFAULT_TRACE_CONFIG.fsync,
    retentionDays:
      sanitizeNumber(file.retentionDays, 1, 3_650) ??
      DEFAULT_TRACE_CONFIG.retentionDays,
    maxSessions:
      sanitizeNumber(file.maxSessions, 1, 10_000) ?? DEFAULT_TRACE_CONFIG.maxSessions,
    maxFileMB:
      sanitizeNumber(file.maxFileMB, 1, 1_024) ?? DEFAULT_TRACE_CONFIG.maxFileMB,
  }
}

/**
 * 读取链路追踪配置；缺失、非法或版本不符时回退默认，绝不抛出、绝不中断聊天。
 * `level: 'off'` 等价于停写（enabled 归一为 false）。
 */
export async function loadTraceConfig(configDir: string): Promise<TraceConfig> {
  try {
    const raw = await readFile(path.join(configDir, FILE_NAME), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return normalize(null)
    const candidate = parsed as TraceConfigFile
    if (candidate.version !== undefined && candidate.version !== 1) return normalize(null)
    return normalize(candidate)
  } catch {
    return normalize(null)
  }
}
