import { mkdir, mkdtemp, readFile, readdir, stat, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TRACE_CONFIG, type TraceConfig, type TraceHeader } from '../../src/trace/contracts'
import { encodeTraceSegment, type TraceDirPaths } from '../projectPaths'
import { collectTraceGarbage, deleteSessionLog } from './traceRetention'
import { TraceStore } from './traceStore'
import { TraceSessionWriter } from './traceWriter'

async function tempPaths(): Promise<TraceDirPaths> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pet-trace-gc-'))
  return {
    root,
    sessions: path.join(root, 'sessions'),
    blobs: path.join(root, 'blobs'),
    legacy: path.join(root, 'legacy'),
  }
}

function headerFacts(sessionId: string): Omit<TraceHeader, 'type' | 'version'> {
  return {
    sessionId,
    packageId: 'pkg',
    createdAt: 1_700_000_000_000,
    provider: { kind: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
    context: { budgetCharacters: 40_000, importanceTrim: true, recentWindowChars: 28_000 },
    tools: [],
    redaction: { level: 'full', maxFieldChars: 4_000 },
  }
}

async function seedSession(
  paths: TraceDirPaths,
  sessionId: string,
  options: { padding?: string; modifiedAt?: Date } = {},
): Promise<string> {
  const writer = new TraceSessionWriter(sessionId, paths, {
    ...DEFAULT_TRACE_CONFIG,
    fsync: 'never',
  })
  await writer.open(headerFacts(sessionId))
  writer.append({ type: 'turn/start', turn: 1, data: {} })
  if (options.padding) {
    writer.append({
      type: 'assistant/message',
      turn: 1,
      data: { messageId: 'a1', content: options.padding, characters: options.padding.length },
    })
  }
  writer.append({
    type: 'turn/end',
    turn: 1,
    data: {
      status: 'completed',
      latencyMs: 5,
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
      },
      modelCalls: 1,
      toolCalls: 0,
      toolSuccesses: 0,
    },
  })
  await writer.flush()
  if (options.modifiedAt) {
    await utimes(writer.logPath, options.modifiedAt, options.modifiedAt)
  }
  return writer.logPath
}

const config: TraceConfig = { ...DEFAULT_TRACE_CONFIG }

describe('链路保留策略清理', () => {
  it('删除超过保留天数的会话，保留期内不动', async () => {
    const paths = await tempPaths()
    const now = Date.now()
    await seedSession(paths, 's-old', {
      modifiedAt: new Date(now - 40 * 24 * 60 * 60 * 1000),
    })
    await seedSession(paths, 's-fresh')
    const store = new TraceStore(paths, { ...config, retentionDays: 30 })

    const result = await collectTraceGarbage(paths, { ...config, retentionDays: 30 }, now)
    expect(result.removedSessions).toBe(1)
    await expect(store.summarizeSession('s-old')).resolves.toBeNull()
    await expect(store.summarizeSession('s-fresh')).resolves.not.toBeNull()
  })

  it('超出会话数上限时保留最新的', async () => {
    const paths = await tempPaths()
    const now = Date.now()
    await seedSession(paths, 's-1', { modifiedAt: new Date(now - 3_000) })
    await seedSession(paths, 's-2', { modifiedAt: new Date(now - 2_000) })
    await seedSession(paths, 's-3', { modifiedAt: new Date(now - 1_000) })
    const store = new TraceStore(paths, { ...config, maxSessions: 2 })

    const result = await collectTraceGarbage(paths, { ...config, maxSessions: 2 }, now)
    expect(result.removedSessions).toBe(1)
    await expect(store.summarizeSession('s-1')).resolves.toBeNull()
    await expect(store.summarizeSession('s-2')).resolves.not.toBeNull()
    await expect(store.summarizeSession('s-3')).resolves.not.toBeNull()
  })

  it('单个日志超过大小上限时整份删除（seq 稠密无法从头截断）', async () => {
    const paths = await tempPaths()
    const now = Date.now()
    await seedSession(paths, 's-big', { padding: 'x'.repeat(4_000) })
    await seedSession(paths, 's-small')
    const tiny: TraceConfig = { ...config, maxFileMB: 0.001 }

    const result = await collectTraceGarbage(paths, tiny, now)
    expect(result.removedSessions).toBe(1)
    const names = await readdir(paths.sessions)
    expect(names).toEqual([`${encodeTraceSegment('s-small')}.jsonl`])
  })

  it('回收无引用的外置原文，保留仍被引用的', async () => {
    const paths = await tempPaths()
    const store = new TraceStore(paths, { ...config, fsync: 'never', maxFieldChars: 100 })
    const recorder = await store.beginTurn({
      sessionId: 's-blob',
      packageId: 'pkg',
      turn: 1,
      provider: { kind: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
      context: { budgetCharacters: 40_000, importanceTrim: true, recentWindowChars: 28_000 },
      tools: [],
    })
    if (!recorder) throw new Error('recorder 未创建')
    recorder.toolResult({
      callId: 'c1',
      name: 'web_fetch',
      ok: true,
      latencyMs: 3,
      output: { content: 'y'.repeat(500) },
    })
    recorder.turnEnd({ status: 'completed', latencyMs: 10 })
    await store.flush('s-blob')

    const blobsBefore = await readdir(paths.blobs)
    expect(blobsBefore).toHaveLength(1)

    // 存活会话：原文保留
    await collectTraceGarbage(paths, config, Date.now())
    expect(await readdir(paths.blobs)).toEqual(blobsBefore)

    // 删除会话后：原文成为无引用，随清理回收
    expect(await deleteSessionLog(paths, 's-blob')).toBe(true)
    const result = await collectTraceGarbage(paths, config, Date.now())
    expect(result.removedBlobs).toBe(1)
    expect(await readdir(paths.blobs)).toEqual([])
    await expect(deleteSessionLog(paths, 's-blob')).resolves.toBe(false)
  })

  it('清理不越界：chat/memory 等子目录与 traces 根下的 legacy 日报不受影响', async () => {
    const paths = await tempPaths()
    const now = Date.now()
    await seedSession(paths, 's-old', { modifiedAt: new Date(now - 400 * 24 * 60 * 60 * 1000) })
    await mkdir(paths.legacy, { recursive: true })
    const legacyFile = path.join(paths.legacy, '2026-01-01.jsonl')
    await writeFile(legacyFile, '{"requestId":"r"}\n', 'utf8')
    const sibling = path.join(paths.root, '..', path.basename(paths.root) + '-chat')
    await writeFile(sibling, 'x', 'utf8').catch(() => undefined)

    const result = await collectTraceGarbage(paths, { ...config, retentionDays: 1 }, now)
    expect(result.removedSessions).toBe(1)
    expect((await stat(legacyFile)).size).toBeGreaterThan(0)
    await expect(readFile(legacyFile, 'utf8')).resolves.toContain('requestId')
  })
})
