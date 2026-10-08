// @ts-nocheck
/**
 * 🔒 安全层快速参考
 *
 * 三层防御机制的常用 API 速查表
 */

// ============================================
// Layer 1: 路径验证
// ============================================

import {
  validateDataPath,    // 验证完整路径
  validatePathSegment, // 验证单个路径段
  validateUUID,        // 验证 UUID 格式
  buildDataPath        // 安全构造路径
} from './security'

// 示例 1: 验证完整路径
const safePath = validateDataPath('/path/to/file', 'memory')
// throws: 如果路径超出 memory 区域

// 示例 2: 构造安全路径（推荐）
const path = buildDataPath('novels', bookId, 'ch-001.md')
// 自动验证所有路径段 + 最终路径

// 示例 3: 验证动态参数
const safeBookId = validateUUID(userInput)  // throws: 如果不是 UUID

// ============================================
// Layer 2: 输入验证
// ============================================

import {
  validateContent,   // 验证文本（敏感内容检测）
  validateNumber,    // 验证数字范围
  validateEnum,      // 验证枚举值
  requireFields      // 验证必填字段
} from './security'

// 工具的 validate 方法示例
validate: (input: unknown) => {
  // 1. 验证结构
  const value = requireFields<{
    content: string
    importance?: number
  }>(input, ['content'])

  // 2. 验证内容（自动检测敏感信息）
  const content = validateContent(value.content, {
    maxLength: 2_000,
    allowSensitive: false,  // 拒绝 API 密钥、密码等
  })

  // 3. 验证数字
  const importance = validateNumber(value.importance, {
    min: 1,
    max: 3,
    integer: true,
    defaultValue: 2,
  })

  return { content, importance }
}

// ============================================
// Layer 3: 审计
// ============================================

import {
  initializeFileAudit,  // 应用启动时调用
  auditFileAccess       // 记录文件操作
} from './security'

// 在 main.ts 初始化
await initializeFileAudit()

// 在工具执行中记录
const startTime = Date.now()
try {
  await writeFile(path, content)

  await auditFileAccess({
    operation: 'write',
    filePath: 'data/memory/memory-data.json',
    toolName: 'remember_fact',
    success: true,
    latencyMs: Date.now() - startTime,
    fileSize: content.length,
  })
} catch (error) {
  await auditFileAccess({
    operation: 'write',
    filePath: 'data/memory/memory-data.json',
    toolName: 'remember_fact',
    success: false,
    errorMessage: error.message,
    latencyMs: Date.now() - startTime,
  })
  throw error
}

// ============================================
// 常见模式
// ============================================

// 模式 1: Store 层文件保存（带完整安全检查）
async function secureFileSave(
  zone: 'memory' | 'novels' | 'knowledge',
  segments: string[],
  content: string,
) {
  // Layer 2: 输入验证
  const validatedContent = validateContent(content, {
    minLength: 1,
    maxLength: 100_000,
  })

  // Layer 1: 路径验证
  const safePath = buildDataPath(zone, ...segments)

  // Layer 3: 审计
  const startTime = Date.now()
  try {
    await writeFile(safePath, validatedContent)
    await auditFileAccess({
      operation: 'write',
      filePath: `data/${zone}/${segments.join('/')}`,
      toolName: 'secure_file_save',
      success: true,
      latencyMs: Date.now() - startTime,
    })
  } catch (error) {
    await auditFileAccess({
      operation: 'write',
      filePath: `data/${zone}/${segments.join('/')}`,
      toolName: 'secure_file_save',
      success: false,
      errorMessage: error.message,
      latencyMs: Date.now() - startTime,
    })
    throw error
  }
}

// 模式 2: 工具完整集成
const secureTool: AgentTool = {
  name: 'my_tool',
  enabled: true,
  riskLevel: 'safe',
  description: '...',
  parameters: { /* ... */ },

  // Layer 2: 输入验证
  validate: (input: unknown) => {
    const value = requireFields<{ text: string }>(input, ['text'])
    const text = validateContent(value.text, {
      maxLength: 1000,
      allowSensitive: false,
    })
    return { text }
  },

  // Layer 1 + 3: 执行 + 审计
  execute: async (input, signal) => {
    const startTime = Date.now()
    try {
      // Layer 1: 路径验证
      const safePath = buildDataPath('memory', 'file.json')

      // 实际操作
      await writeFile(safePath, input.text)

      // Layer 3: 成功审计
      await auditFileAccess({
        operation: 'write',
        filePath: 'data/memory/file.json',
        toolName: 'my_tool',
        success: true,
        latencyMs: Date.now() - startTime,
      })

      return { ok: true }
    } catch (error) {
      // Layer 3: 失败审计
      await auditFileAccess({
        operation: 'write',
        filePath: 'data/memory/file.json',
        toolName: 'my_tool',
        success: false,
        errorMessage: error.message,
        latencyMs: Date.now() - startTime,
      })
      throw error
    }
  },

  renderForModel: (output) => {
    return output?.ok ? 'my_tool：成功' : 'my_tool：失败'
  },
}

// ============================================
// 审计日志查看
// ============================================

// 日志位置：data/logs/file-access-audit.jsonl
// 格式：每行一个 JSON 对象

// 查看最近的操作
// tail -f data/logs/file-access-audit.jsonl

// 统计失败操作
// grep '"success":false' data/logs/file-access-audit.jsonl | wc -l

// 查找特定工具的操作
// grep '"toolName":"remember_fact"' data/logs/file-access-audit.jsonl
