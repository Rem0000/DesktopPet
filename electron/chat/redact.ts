const SENSITIVE_PATTERN =
  /(api[_-]?key|sk-[a-z0-9]{10,}|password|passwd|secret|token|bearer\s+[a-z0-9._-]+)/gi

/** 将疑似密钥片段替换为遮罩；过长内容截断 */
export function redactSensitive(text: string, maxLength = 240): string {
  const masked = text.replace(SENSITIVE_PATTERN, '[REDACTED]')
  if (masked.length <= maxLength) return masked
  return `${masked.slice(0, maxLength)}…`
}

export function summarizeToolInput(input: unknown, maxLength = 160): string {
  try {
    const raw = typeof input === 'string' ? input : JSON.stringify(input)
    return redactSensitive(raw, maxLength)
  } catch {
    return '[unserializable]'
  }
}

export function classifyToolError(error: unknown): { errorCode: string; message: string } {
  const message = error instanceof Error ? error.message : String(error)
  const redacted = redactSensitive(message, 200)
  const lower = redacted.toLowerCase()
  if (lower.includes('不存在') || lower.includes('未注册') || lower.includes('未启用')) {
    return { errorCode: 'not_found', message: redacted }
  }
  if (lower.includes('参数') || lower.includes('无效') || lower.includes('需要')) {
    return { errorCode: 'validation', message: redacted }
  }
  if (lower.includes('取消') || lower.includes('aborted')) {
    return { errorCode: 'cancelled', message: redacted }
  }
  if (lower.includes('拒绝') || lower.includes('敏感')) {
    return { errorCode: 'rejected', message: redacted }
  }
  return { errorCode: 'execution', message: redacted }
}
