import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifyToolError, redactSensitive, summarizeToolInput } from './redact'
import { ToolTraceStore } from './toolTraceStore'

describe('redact', () => {
  it('遮罩疑似密钥并截断过长文本', () => {
    expect(redactSensitive('my api_key is sk-abcdefghijklmnop')).toContain('[REDACTED]')
    expect(redactSensitive('a'.repeat(300), 40).endsWith('…')).toBe(true)
  })

  it('汇总工具入参时脱敏', () => {
    expect(summarizeToolInput({ token: 'secret-value', note: 'ok' })).toContain('[REDACTED]')
  })

  it('归类工具错误码', () => {
    expect(classifyToolError(new Error('工具不存在：x')).errorCode).toBe('not_found')
    expect(classifyToolError(new Error('需要 content')).errorCode).toBe('validation')
    expect(classifyToolError(new Error('拒绝写入敏感')).errorCode).toBe('rejected')
  })
})

describe('ToolTraceStore', () => {
  it('落盘 JSONL 并按会话查询与汇总', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'pet-traces-'))
    const store = new ToolTraceStore(dir)
    await store.initialize()
    await store.append({
      requestId: 'r1',
      sessionId: 's1',
      toolName: 'remember_fact',
      startedAt: '2026-07-27T10:00:00.000Z',
      endedAt: '2026-07-27T10:00:00.050Z',
      ok: true,
      latencyMs: 50,
      inputSummary: '{"content":"喜欢猫"}',
    })
    await store.append({
      requestId: 'r2',
      sessionId: 's1',
      toolName: 'remember_fact',
      startedAt: '2026-07-27T10:01:00.000Z',
      endedAt: '2026-07-27T10:01:00.080Z',
      ok: false,
      errorCode: 'validation',
      latencyMs: 80,
    })
    await store.append({
      requestId: 'r3',
      sessionId: 's2',
      toolName: 'schedule_reminder',
      startedAt: '2026-07-27T10:02:00.000Z',
      endedAt: '2026-07-27T10:02:00.020Z',
      ok: true,
      latencyMs: 20,
    })

    const bySession = await store.listBySession('s1')
    expect(bySession).toHaveLength(2)

    const stats = await store.summarize()
    const remember = stats.find((item) => item.toolName === 'remember_fact')
    expect(remember).toMatchObject({ calls: 2, successes: 1, avgLatencyMs: 65 })

    const filePath = path.join(dir, '2026-07-27.jsonl')
    const raw = await readFile(filePath, 'utf8')
    expect(raw.trim().split('\n')).toHaveLength(3)
  })
})
