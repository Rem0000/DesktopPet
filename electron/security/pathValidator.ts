import path from 'node:path'
import { resolveDataRoot, type DataSubpath } from '../projectPaths'

/**
 * Layer 1: 静态路径约束
 *
 * 防止路径穿越攻击，确保所有文件操作都在允许的数据区域内。
 *
 * @example
 * ```typescript
 * // ✅ 合法路径
 * validateDataPath('data/memory/memory-data.json', 'memory')
 *
 * // ❌ 路径穿越
 * validateDataPath('data/memory/../../../etc/passwd', 'memory')
 * // throws: 路径穿越：超出允许区域 memory
 *
 * // ❌ 绝对路径逃逸
 * validateDataPath('/etc/passwd', 'memory')
 * // throws: 路径穿越：超出允许区域 memory
 * ```
 */

export type AllowedZone = DataSubpath

const DATA_ROOT = resolveDataRoot()

/**
 * 验证并规范化数据路径，防止路径穿越。
 *
 * @param requestedPath - 请求的路径（相对或绝对）
 * @param zone - 允许的数据区域（如 'memory', 'knowledge', 'novels'）
 * @returns 规范化后的绝对路径
 * @throws 如果路径超出允许区域或包含非法字符
 */
export function validateDataPath(
  requestedPath: string,
  zone: AllowedZone,
): string {
  // 1. 规范化路径（解析 .. 和符号链接）
  const normalized = path.resolve(requestedPath)
  const zoneRoot = path.resolve(path.join(DATA_ROOT, zone))

  // 2. 检查是否在允许的区域内
  // 必须以 zoneRoot + 分隔符开头，或者完全等于 zoneRoot
  if (
    normalized !== zoneRoot &&
    !normalized.startsWith(zoneRoot + path.sep)
  ) {
    throw new Error(
      `路径穿越：${requestedPath} 超出允许区域 ${zone} (resolved: ${normalized}, expected under: ${zoneRoot})`,
    )
  }

  // 3. 禁止特殊字符（Windows 特有的文件名限制）
  // < > " | ? * 以及控制字符
  // 注意：不检查冒号，因为 Windows 绝对路径包含冒号（如 C:\）
  // 只检查文件名部分是否包含这些字符
  const pathSegments = normalized.split(/[/\\]/).filter(Boolean)
  for (const segment of pathSegments) {
    // 跳过驱动器字母（如 "C:"）
    if (/^[A-Za-z]:$/.test(segment)) continue

    // 检查文件名/目录名中的非法字符
    if (/[<>:"|?*\x00-\x1f]/.test(segment)) {
      throw new Error(`非法路径字符：${segment}`)
    }
  }

  // 4. 禁止以点结尾（Windows 会自动去除，可能导致预期外的文件访问）
  // 只检查最后一个路径段（文件名），不检查目录
  const lastSegment = pathSegments[pathSegments.length - 1]
  if (lastSegment && lastSegment.endsWith('.') && !lastSegment.endsWith('..')) {
    throw new Error(`文件名不能以点结尾：${lastSegment}`)
  }

  return normalized
}

/**
 * 验证路径段是否安全（用于动态构造路径，如 bookId、sessionId）。
 *
 * 规则：
 * - 只允许字母、数字、下划线、连字符、点
 * - 不允许 . 或 .. （防止路径穿越）
 * - 长度限制 1-255 字符
 *
 * @example
 * ```typescript
 * // ✅ 合法
 * validatePathSegment('abc123-def_456')
 * validatePathSegment('550e8400-e29b-41d4-a716-446655440000')  // UUID
 *
 * // ❌ 非法
 * validatePathSegment('..')           // 路径穿越
 * validatePathSegment('../../etc')    // 包含分隔符
 * validatePathSegment('a<b')          // 非法字符
 * ```
 */
export function validatePathSegment(segment: string): string {
  if (segment.length === 0) {
    throw new Error('路径段不能为空')
  }

  if (segment.length > 255) {
    throw new Error(`路径段过长（最大 255 字符）：${segment.slice(0, 50)}...`)
  }

  // 禁止 . 和 .. （路径穿越）
  if (segment === '.' || segment === '..') {
    throw new Error(`禁止使用相对路径段：${segment}`)
  }

  // 只允许安全字符
  if (!/^[A-Za-z0-9._-]+$/.test(segment)) {
    throw new Error(
      `路径段包含非法字符（仅允许字母数字._-）：${segment}`,
    )
  }

  return segment
}

/**
 * 验证 UUID 格式（用于 bookId, sessionId 等）。
 *
 * @example
 * ```typescript
 * validateUUID('550e8400-e29b-41d4-a716-446655440000')  // ✅
 * validateUUID('not-a-uuid')  // ❌ throws
 * validateUUID('../../../etc/passwd')  // ❌ throws
 * ```
 */
export function validateUUID(value: string): string {
  const UUID_PATTERN =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/

  if (!UUID_PATTERN.test(value)) {
    throw new Error(`UUID 格式无效：${value}`)
  }

  return value
}

/**
 * 构造安全的数据路径（组合 zone + 路径段并验证）。
 *
 * @example
 * ```typescript
 * // 构造小说章节路径
 * buildDataPath('novels', 'book-123', 'ch-001.md')
 * // 返回：<dataRoot>/novels/book-123/ch-001.md
 *
 * // 自动拦截路径穿越
 * buildDataPath('novels', '../memory', 'leak.json')
 * // throws: 路径段包含非法字符
 * ```
 */
export function buildDataPath(
  zone: AllowedZone,
  ...segments: string[]
): string {
  // 验证所有路径段
  for (const segment of segments) {
    validatePathSegment(segment)
  }

  // 构造路径
  const fullPath = path.join(DATA_ROOT, zone, ...segments)

  // 最后再做一次完整验证（防御性编程）
  return validateDataPath(fullPath, zone)
}
