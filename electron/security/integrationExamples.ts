/**
 * 安全机制集成示例
 *
 * 本文件展示如何在现有工具中集成 Layer 1-3 的安全机制。
 */

import type { AgentTool } from '../../src/chat/contracts'
import { validateUUID, buildDataPath } from './pathValidator'
import {
  validateContent,
  validateNumber,
  requireFields,
} from './inputValidator'
import { auditFileAccess } from './fileAccessAudit'

/**
 * 示例 1: 改造 remember_fact 工具
 *
 * 原始代码在 electron/chat/memoryService.ts:302
 */
export function createSecureRememberFactTool(
  writeItem: (input: unknown) => Promise<{ id: string }>,
): AgentTool {
  return {
    name: 'remember_fact',
    enabled: true,
    riskLevel: 'safe',
    description: '记住与用户相关、可跨模型共享的长期事实或约定',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '事实或约定内容' },
        key: { type: 'string', description: '可选去重键' },
        importance: { type: 'number', enum: [1, 2, 3] },
      },
      required: ['content'],
      additionalProperties: false,
    },

    // Layer 2: 输入验证（增强版）
    validate: (input: unknown) => {
      // 1. 基础结构验证
      const value = requireFields<{
        content: string
        key?: string
        importance?: number
      }>(input, ['content'])

      // 2. 内容验证（长度 + 敏感信息检测）
      const content = validateContent(value.content, {
        minLength: 1,
        maxLength: 2_000,
        allowSensitive: false,
        fieldName: '记忆内容',
      })

      // 3. key 验证（如果提供）
      let key: string | undefined
      if (value.key) {
        key = validateContent(value.key, {
          maxLength: 120,
          fieldName: '记忆键',
        })
      }

      // 4. importance 验证
      const importance = validateNumber(
        value.importance,
        { min: 1, max: 3, integer: true, defaultValue: 2, fieldName: '重要性' },
      )

      return { content, key, importance: importance as 1 | 2 | 3 }
    },

    // Layer 3: 审计包装
    execute: async (input, _signal) => {
      const startTime = Date.now()
      let success = false
      let errorMessage: string | undefined

      try {
        const result = await writeItem(input)
        success = true
        return { ok: true, id: result.id }
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error)
        throw error
      } finally {
        const latencyMs = Date.now() - startTime
        await auditFileAccess({
          operation: 'write',
          filePath: 'data/memory/memory-data.json',
          toolName: 'remember_fact',
          success,
          errorMessage,
          latencyMs,
        })
      }
    },

    renderForModel: (output) => {
      if (output && typeof output === 'object' && 'ok' in output && output.ok) {
        return 'remember_fact：成功写入长期记忆'
      }
      return 'remember_fact：失败'
    },
  }
}

/**
 * 示例 2: 改造小说章节保存（需要路径验证）
 *
 * 类似 electron/novel/novelStoryStore.ts
 */
export async function saveChapterSecure(
  bookId: string,
  chapterNumber: number,
  content: string,
  sessionId?: string,
): Promise<void> {
  const startTime = Date.now()
  let success = false
  let errorMessage: string | undefined

  try {
    // Layer 2: 输入验证
    const validatedBookId = validateUUID(bookId)
    const validatedChapterNumber = validateNumber(chapterNumber, {
      min: 1,
      max: 9999,
      integer: true,
      fieldName: '章节号',
    })
    const validatedContent = validateContent(content, {
      minLength: 100,
      maxLength: 100_000,
      fieldName: '章节内容',
    })

    // Layer 1: 路径验证
    const chapterFileName = `ch-${String(validatedChapterNumber).padStart(3, '0')}.md`
    const safePath = buildDataPath('novels', validatedBookId, chapterFileName)

    // 实际写入文件
    const { writeFile } = await import('node:fs/promises')
    await writeFile(safePath, validatedContent, 'utf8')

    success = true
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    // Layer 3: 审计
    const latencyMs = Date.now() - startTime
    await auditFileAccess({
      operation: 'write',
      filePath: `data/novels/${bookId}/ch-${String(chapterNumber).padStart(3, '0')}.md`,
      toolName: 'save_chapter',
      success,
      errorMessage,
      latencyMs,
      fileSize: content.length,
      sessionId,
    })
  }
}

/**
 * 示例 3: 改造知识库文档添加（涉及用户上传路径）
 *
 * 类似 electron/chat/knowledgeStore.ts
 */
export async function addKnowledgeDocumentSecure(
  documentId: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const startTime = Date.now()
  let success = false
  let errorMessage: string | undefined

  try {
    // Layer 2: 输入验证
    const validatedDocId = validateUUID(documentId)

    // 验证相对路径的每个段
    const pathSegments = relativePath.split(/[/\\]/).filter(Boolean)
    if (pathSegments.length === 0) {
      throw new Error('文档路径不能为空')
    }

    // 确保文件扩展名合法
    const allowedExtensions = ['.md', '.txt', '.json']
    const ext = pathSegments[pathSegments.length - 1].match(/\.\w+$/)?.[0]
    if (!ext || !allowedExtensions.includes(ext)) {
      throw new Error(`不支持的文件类型：${ext}（允许：${allowedExtensions.join(', ')}）`)
    }

    const validatedContent = validateContent(content, {
      minLength: 10,
      maxLength: 500_000,
      fieldName: '文档内容',
    })

    // Layer 1: 构造安全路径
    const safePath = buildDataPath('knowledge', 'docs', validatedDocId, ...pathSegments)

    // 写入文件
    const { mkdir, writeFile } = await import('node:fs/promises')
    const path = await import('node:path')
    await mkdir(path.dirname(safePath), { recursive: true })
    await writeFile(safePath, validatedContent, 'utf8')

    success = true
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    // Layer 3: 审计
    const latencyMs = Date.now() - startTime
    await auditFileAccess({
      operation: 'create',
      filePath: `data/knowledge/docs/${documentId}/${relativePath}`,
      toolName: 'add_knowledge_document',
      success,
      errorMessage,
      latencyMs,
      fileSize: content.length,
    })
  }
}

/**
 * 示例 4: 在 toolBoundary 节点中集成审计（修改 electron/chat/agentRuntime.ts）
 *
 * 这是在 agentRuntime.ts:662 toolBoundary 节点添加的钩子
 */
export async function executeToolWithAudit(
  toolName: string,
  toolExecute: (input: unknown, signal: AbortSignal) => Promise<unknown>,
  input: unknown,
  signal: AbortSignal,
  sessionId?: string,
): Promise<unknown> {
  const startTime = Date.now()
  let success = false
  let errorMessage: string | undefined

  try {
    const result = await toolExecute(input, signal)
    success = true
    return result
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    const latencyMs = Date.now() - startTime

    // 根据工具名称推断可能的文件操作
    const filePathMap: Record<string, string> = {
      remember_fact: 'data/memory/memory-data.json',
      update_profile: 'data/memory/memory-data.json',
      forget_memory: 'data/memory/memory-data.json',
      search_knowledge: 'data/knowledge/index.json',
      schedule_reminder: 'data/reminders/reminders.json',
    }

    const filePath = filePathMap[toolName]
    if (filePath) {
      await auditFileAccess({
        operation: toolName.includes('forget') || toolName.includes('cancel') ? 'delete' : 'write',
        filePath,
        toolName,
        success,
        errorMessage,
        latencyMs,
        sessionId,
      })
    }
  }
}
