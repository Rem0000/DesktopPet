import { createHash } from 'node:crypto'
import { redactSensitive } from '../chat/redact'
import type { TraceLevel, TraceTextField, TraceTextValue } from '../../src/trace/contracts'

/** 摘要字段里保留的预览长度（字符） */
export const PREVIEW_CHARS = 240

/**
 * 字段整形上下文。`onBlob` 在需要外置原文时被同步调用（内容寻址 ref 即 sha256），
 * 由写入器在异步阶段落盘，保证 emit 路径本身零 I/O、零 await。
 */
export type FieldShapeContext = {
  level: TraceLevel
  maxFieldChars: number
  onBlob?: (ref: string, text: string) => void
}

/** 全文遮罩（不截断）：用于落盘前的敏感信息处理 */
export function redactFull(text: string): string {
  return redactSensitive(text, text.length + 1)
}

export function hashText(text: string): { sha256: string; characters: number; bytes: number } {
  return {
    sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
    characters: text.length,
    bytes: Buffer.byteLength(text, 'utf8'),
  }
}

export function previewText(text: string, max = PREVIEW_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

/**
 * 把文本字段整形为可落盘形态：
 * - `full` 且未超限 → 内联原文（已遮罩）
 * - `full` 且超限 → 摘要 + 外置原文（blobs/<sha256>）
 * - `meta` → 仅摘要（原文不落盘、不外置）
 */
export function shapeText(text: string, ctx: FieldShapeContext): TraceTextValue {
  const redacted = redactFull(text)
  if (ctx.level === 'full' && redacted.length <= ctx.maxFieldChars) return redacted
  const digest = hashText(redacted)
  const field: TraceTextField = {
    preview: previewText(redacted),
    bytes: digest.bytes,
    characters: digest.characters,
    sha256: digest.sha256,
  }
  if (ctx.level === 'full') {
    field.blobRef = digest.sha256
    ctx.onBlob?.(digest.sha256, redacted)
  }
  return field
}

/** 把任意 JSON 值序列化后按文本整形（不可序列化时降级为占位文本） */
export function shapeJson(value: unknown, ctx: FieldShapeContext): TraceTextValue {
  let raw: string
  try {
    raw = JSON.stringify(value ?? null) ?? 'null'
  } catch {
    raw = '[unserializable]'
  }
  return shapeText(raw, ctx)
}

/** 系统提示词只落长度与摘要（可选预览），避免把整段人设写进每一条请求事件 */
export function shapeSystemPrompt(
  systemPrompt: string,
  options: { includePreview: boolean; maxPreviewChars?: number },
): { characters: number; sha256: string; preview?: string } {
  const redacted = redactFull(systemPrompt)
  const digest = hashText(redacted)
  return {
    characters: digest.characters,
    sha256: digest.sha256,
    ...options.includePreview
      ? { preview: previewText(redacted, options.maxPreviewChars ?? PREVIEW_CHARS) }
      : {},
  }
}

/** 从摘要形态取回可读文本（内联直接返回；摘要返回预览） */
export function textOf(value: TraceTextValue | undefined): string {
  if (value === undefined) return ''
  return typeof value === 'string' ? value : value.preview
}
