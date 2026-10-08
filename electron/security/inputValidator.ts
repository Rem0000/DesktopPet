/**
 * Layer 2: 输入规范化与验证
 *
 * 为工具参数提供统一的验证和清理机制，防止 LLM 生成的恶意或格式错误的输入。
 */

/**
 * 敏感内容模式（扩展自 memoryStore.ts）
 */
const SENSITIVE_PATTERNS = [
  // API 密钥和 token
  /api[_-]?key/i,
  /sk-[a-z0-9]{10,}/i,
  /bearer\s+[a-z0-9._-]+/i,
  /token/i,

  // 密码
  /password/i,
  /passwd/i,

  // 秘密
  /secret/i,

  // AWS 凭证
  /AKIA[0-9A-Z]{16}/,

  // 私钥
  /-----BEGIN (RSA |EC )?PRIVATE KEY-----/,

  // 数据库连接串
  /mongodb:\/\//i,
  /postgres:\/\//i,
  /mysql:\/\//i,

  // JWT
  /eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/,
]

/**
 * 检查文本是否包含敏感信息。
 *
 * @example
 * ```typescript
 * containsSensitiveData('my api_key is abc123')  // true
 * containsSensitiveData('remember to buy milk')  // false
 * ```
 */
export function containsSensitiveData(text: string): boolean {
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(text)) {
      return true
    }
  }
  return false
}

/**
 * 验证字符串内容的安全性和长度。
 *
 * @param content - 要验证的内容
 * @param options - 验证选项
 * @throws 如果内容为空、过长或包含敏感信息
 */
export function validateContent(
  content: string,
  options: {
    minLength?: number
    maxLength?: number
    allowSensitive?: boolean
    fieldName?: string
  } = {},
): string {
  const {
    minLength = 1,
    maxLength = 50_000,
    allowSensitive = false,
    fieldName = '内容',
  } = options

  const trimmed = content.trim()

  if (trimmed.length < minLength) {
    throw new Error(`${fieldName}不能为空`)
  }

  if (trimmed.length > maxLength) {
    throw new Error(
      `${fieldName}过长（最大 ${maxLength} 字符，实际 ${trimmed.length} 字符）`,
    )
  }

  if (!allowSensitive && containsSensitiveData(trimmed)) {
    throw new Error(`${fieldName}包含疑似密钥或敏感机密内容，拒绝处理`)
  }

  return trimmed
}

/**
 * 验证数字范围。
 *
 * @example
 * ```typescript
 * validateNumber(5, { min: 1, max: 10 })  // 5
 * validateNumber(15, { min: 1, max: 10 }) // throws
 * validateNumber(2.5, { integer: true })  // throws
 * ```
 */
export function validateNumber(
  value: unknown,
  options: {
    min?: number
    max?: number
    integer?: boolean
    defaultValue?: number
    fieldName?: string
  } = {},
): number {
  const {
    min = -Infinity,
    max = Infinity,
    integer = false,
    defaultValue,
    fieldName = '数值',
  } = options

  if (typeof value !== 'number') {
    if (defaultValue !== undefined) {
      return defaultValue
    }
    throw new Error(`${fieldName}必须是数字`)
  }

  if (!Number.isFinite(value)) {
    throw new Error(`${fieldName}必须是有限数字`)
  }

  if (integer && !Number.isInteger(value)) {
    throw new Error(`${fieldName}必须是整数`)
  }

  if (value < min || value > max) {
    throw new Error(
      `${fieldName}超出范围（最小 ${min}，最大 ${max}，实际 ${value}）`,
    )
  }

  return value
}

/**
 * 验证并规范化布尔值。
 *
 * @example
 * ```typescript
 * validateBoolean(true)   // true
 * validateBoolean('yes')  // throws (strict mode)
 * validateBoolean(undefined, { defaultValue: false })  // false
 * ```
 */
export function validateBoolean(
  value: unknown,
  options: {
    defaultValue?: boolean
    fieldName?: string
  } = {},
): boolean {
  const { defaultValue, fieldName = '布尔值' } = options

  if (typeof value === 'boolean') {
    return value
  }

  if (value === undefined && defaultValue !== undefined) {
    return defaultValue
  }

  throw new Error(`${fieldName}必须是布尔值`)
}

/**
 * 验证枚举值。
 *
 * @example
 * ```typescript
 * validateEnum('apple', ['apple', 'banana'])  // 'apple'
 * validateEnum('orange', ['apple', 'banana']) // throws
 * ```
 */
export function validateEnum<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  options: {
    defaultValue?: T
    fieldName?: string
  } = {},
): T {
  const { defaultValue, fieldName = '枚举值' } = options

  if (typeof value !== 'string') {
    if (defaultValue !== undefined) {
      return defaultValue
    }
    throw new Error(`${fieldName}必须是字符串`)
  }

  if (!allowedValues.includes(value as T)) {
    throw new Error(
      `${fieldName}无效（允许值：${allowedValues.join(', ')}，实际：${value}）`,
    )
  }

  return value as T
}

/**
 * 验证数组。
 *
 * @example
 * ```typescript
 * validateArray([1, 2, 3], { minLength: 1, maxLength: 5 })
 * validateArray('not-array', { defaultValue: [] })
 * ```
 */
export function validateArray<T>(
  value: unknown,
  options: {
    minLength?: number
    maxLength?: number
    defaultValue?: T[]
    fieldName?: string
  } = {},
): T[] {
  const {
    minLength = 0,
    maxLength = Infinity,
    defaultValue,
    fieldName = '数组',
  } = options

  if (!Array.isArray(value)) {
    if (defaultValue !== undefined) {
      return defaultValue
    }
    throw new Error(`${fieldName}必须是数组`)
  }

  if (value.length < minLength) {
    throw new Error(`${fieldName}长度不足（最小 ${minLength}，实际 ${value.length}）`)
  }

  if (value.length > maxLength) {
    throw new Error(`${fieldName}长度超限（最大 ${maxLength}，实际 ${value.length}）`)
  }

  return value as T[]
}

/**
 * 验证 ISO 8601 日期字符串。
 *
 * @example
 * ```typescript
 * validateISODate('2024-01-01T00:00:00Z')  // ✅
 * validateISODate('not-a-date')  // ❌ throws
 * validateISODate('2024-01-01T00:00:00Z', { minDate: new Date('2025-01-01') })  // ❌ 过去日期
 * ```
 */
export function validateISODate(
  value: unknown,
  options: {
    minDate?: Date
    maxDate?: Date
    fieldName?: string
  } = {},
): string {
  const { minDate, maxDate, fieldName = '日期' } = options

  if (typeof value !== 'string') {
    throw new Error(`${fieldName}必须是字符串`)
  }

  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) {
    throw new Error(`${fieldName}格式无效（需要 ISO 8601 格式）：${value}`)
  }

  const date = new Date(timestamp)

  if (minDate && date < minDate) {
    throw new Error(
      `${fieldName}过早（最早 ${minDate.toISOString()}，实际 ${value}）`,
    )
  }

  if (maxDate && date > maxDate) {
    throw new Error(
      `${fieldName}过晚（最晚 ${maxDate.toISOString()}，实际 ${value}）`,
    )
  }

  return value
}

/**
 * 安全地解析 JSON，返回类型化对象。
 *
 * @example
 * ```typescript
 * parseJSON('{"key": "value"}')  // { key: 'value' }
 * parseJSON('not-json')  // throws
 * parseJSON('not-json', { defaultValue: {} })  // {}
 * ```
 */
export function parseJSON<T = unknown>(
  text: string,
  options: {
    defaultValue?: T
    fieldName?: string
  } = {},
): T {
  const { defaultValue, fieldName = 'JSON' } = options

  try {
    return JSON.parse(text) as T
  } catch {
    if (defaultValue !== undefined) {
      return defaultValue
    }
    throw new Error(`${fieldName}解析失败：格式错误`)
  }
}

/**
 * 组合验证器：验证对象必须包含指定字段。
 *
 * @example
 * ```typescript
 * requireFields({ name: 'Alice', age: 30 }, ['name', 'age'])  // ✅
 * requireFields({ name: 'Bob' }, ['name', 'age'])  // ❌ throws: 缺少必填字段 age
 * ```
 */
export function requireFields<T extends Record<string, unknown>>(
  obj: unknown,
  requiredFields: (keyof T)[],
): T {
  if (!obj || typeof obj !== 'object') {
    throw new Error('参数必须是对象')
  }

  const value = obj as Partial<T>
  for (const field of requiredFields) {
    if (!(field in value) || value[field] === undefined) {
      throw new Error(`缺少必填字段：${String(field)}`)
    }
  }

  return value as T
}
