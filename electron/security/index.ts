/**
 * 安全层初始化入口
 *
 * 在应用启动时调用，初始化所有安全机制。
 */

import { initializeFileAudit } from './fileAccessAudit'

/**
 * 初始化所有安全层。
 *
 * 应在 electron/main.ts 的 app.whenReady() 中调用。
 *
 * @example
 * ```typescript
 * import { initializeSecurity } from './security/initialize'
 *
 * app.whenReady().then(async () => {
 *   await initializeSecurity()
 *   // ... 其他初始化代码
 * })
 * ```
 */
export async function initializeSecurity(): Promise<void> {
  try {
    // Layer 3: 初始化审计日志系统
    await initializeFileAudit()

    console.log('[Security] 安全层初始化成功')
    console.log('[Security] - Layer 1: 静态路径约束 ✓')
    console.log('[Security] - Layer 2: 输入规范化验证 ✓')
    console.log('[Security] - Layer 3: 审计与监控 ✓')
  } catch (error) {
    console.error('[Security] 安全层初始化失败:', error)
    // 不抛出错误，允许应用继续运行（降级模式）
    console.warn('[Security] 应用将在无审计模式下运行')
  }
}

/**
 * 导出所有安全工具（便于统一导入）
 */
export {
  // Layer 1: 路径验证
  validateDataPath,
  validatePathSegment,
  validateUUID,
  buildDataPath,
  type AllowedZone,
} from './pathValidator'

export {
  // Layer 2: 输入验证
  containsSensitiveData,
  validateContent,
  validateNumber,
  validateBoolean,
  validateEnum,
  validateArray,
  validateISODate,
  parseJSON,
  requireFields,
} from './inputValidator'

export {
  // Layer 3: 审计
  initializeFileAudit,
  auditFileAccess,
  auditWrapper,
  detectAnomalousActivity,
  getOperationStats,
  clearOperationStats,
  type FileOperation,
  type FileAccessAuditLog,
} from './fileAccessAudit'
