import { mkdir, appendFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveDataSubpath } from '../projectPaths'

/**
 * Layer 3: 审计与监控
 *
 * 记录所有文件访问操作，用于安全审计和异常检测。
 */

export type FileOperation = 'read' | 'write' | 'delete' | 'create' | 'rename'

export type FileAccessAuditLog = {
  /** 时间戳（ISO 8601） */
  timestamp: string
  /** 操作类型 */
  operation: FileOperation
  /** 访问的文件路径（相对于 data root） */
  filePath: string
  /** 触发操作的工具名称 */
  toolName: string
  /** 操作是否成功 */
  success: boolean
  /** 失败时的错误信息 */
  errorMessage?: string
  /** 操作耗时（毫秒） */
  latencyMs?: number
  /** 文件大小（字节，仅 write/create 操作） */
  fileSize?: number
  /** 会话 ID */
  sessionId?: string
}

let auditLogPath: string | null = null
let isInitialized = false

/**
 * 初始化审计日志系统。
 *
 * 必须在应用启动时调用一次。
 */
export async function initializeFileAudit(): Promise<void> {
  if (isInitialized) return

  const logsDir = resolveDataSubpath('logs')
  await mkdir(logsDir, { recursive: true })

  auditLogPath = path.join(logsDir, 'file-access-audit.jsonl')
  isInitialized = true
}

/**
 * 记录文件访问操作到审计日志。
 *
 * @param log - 审计日志条目
 *
 * @example
 * ```typescript
 * await auditFileAccess({
 *   operation: 'write',
 *   filePath: 'data/memory/memory-data.json',
 *   toolName: 'remember_fact',
 *   success: true,
 *   latencyMs: 12,
 *   fileSize: 1024,
 * })
 * ```
 */
export async function auditFileAccess(
  log: Omit<FileAccessAuditLog, 'timestamp'>,
): Promise<void> {
  if (!isInitialized || !auditLogPath) {
    // 静默失败：审计失败不应影响主流程
    console.warn('[FileAudit] 审计系统未初始化，跳过日志记录')
    return
  }

  const entry: FileAccessAuditLog = {
    timestamp: new Date().toISOString(),
    ...log,
  }

  try {
    await appendFile(auditLogPath, JSON.stringify(entry) + '\n', 'utf8')
  } catch (error) {
    // 静默失败：审计失败不应影响主流程
    console.error('[FileAudit] 写入审计日志失败:', error)
  }
}

/**
 * 包装文件操作函数，自动记录审计日志。
 *
 * @example
 * ```typescript
 * const safeWriteFile = auditWrapper(
 *   writeFile,
 *   'write',
 *   'remember_fact',
 *   '/path/to/file.json'
 * )
 *
 * await safeWriteFile('content')  // 自动记录审计日志
 * ```
 */
export function auditWrapper<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  operation: FileOperation,
  toolName: string,
  filePath: string,
  sessionId?: string,
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    const startTime = Date.now()
    let success = false
    let errorMessage: string | undefined
    let fileSize: number | undefined

    try {
      const result = await fn(...args)
      success = true

      // 如果是写入操作，尝试获取文件大小
      if (
        (operation === 'write' || operation === 'create') &&
        typeof args[0] === 'string'
      ) {
        fileSize = Buffer.byteLength(args[0], 'utf8')
      }

      return result
    } catch (error) {
      errorMessage =
        error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      const latencyMs = Date.now() - startTime
      await auditFileAccess({
        operation,
        filePath,
        toolName,
        success,
        errorMessage,
        latencyMs,
        fileSize,
        sessionId,
      })
    }
  }
}

/**
 * 高危操作检测：如果在短时间内有大量文件操作，发出警告。
 *
 * 用于检测潜在的滥用或攻击行为（如 DoS、数据泄露）。
 */
const recentOperations: Array<{ timestamp: number; toolName: string }> = []
const WINDOW_MS = 10_000 // 10 秒窗口
const THRESHOLD = 50 // 阈值：10 秒内超过 50 次操作

/**
 * 检查是否存在异常的高频文件访问。
 *
 * @returns 如果检测到异常返回 true
 */
export function detectAnomalousActivity(toolName: string): boolean {
  const now = Date.now()

  // 清理过期记录
  while (
    recentOperations.length > 0 &&
    recentOperations[0].timestamp < now - WINDOW_MS
  ) {
    recentOperations.shift()
  }

  // 添加当前操作
  recentOperations.push({ timestamp: now, toolName })

  // 检查是否超过阈值
  if (recentOperations.length > THRESHOLD) {
    console.warn(
      `[FileAudit] 检测到异常高频文件访问：${recentOperations.length} 次操作（${WINDOW_MS / 1000}秒内），工具：${toolName}`,
    )
    return true
  }

  return false
}

/**
 * 按工具统计文件操作次数（用于分析和调试）。
 *
 * @example
 * ```typescript
 * const stats = getOperationStats()
 * // { remember_fact: 15, search_knowledge: 8, ... }
 * ```
 */
export function getOperationStats(): Record<string, number> {
  const stats: Record<string, number> = {}

  for (const op of recentOperations) {
    stats[op.toolName] = (stats[op.toolName] || 0) + 1
  }

  return stats
}

/**
 * 清空操作统计（测试用）。
 */
export function clearOperationStats(): void {
  recentOperations.length = 0
}
