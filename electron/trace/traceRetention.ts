import { readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type { TraceConfig, TraceEvent } from '../../src/trace/contracts'
import { encodeTraceSegment, type TraceDirPaths } from '../projectPaths'
import { scanSessionLog } from './traceReader'

export type TraceGcResult = {
  /** 因超期/超额/超限被删除的会话日志数 */
  removedSessions: number
  /** 被删除的外置原文文件数（内容寻址，无引用即回收） */
  removedBlobs: number
  /** 释放的字节数（日志 + 原文） */
  freedBytes: number
}

type Survivor = {
  name: string
  filePath: string
  mtimeMs: number
  sizeBytes: number
  events: TraceEvent[]
}

/**
 * 保留策略清理（严格限制在 `traces/` 内）：
 * 1. 超过 `retentionDays` 的会话日志删除；
 * 2. 会话数超过 `maxSessions` 时按最近写入时间保留最新的，其余删除；
 * 3. 单个日志超过 `maxFileMB` 时整份删除（格式要求 seq 从 0 稠密，无法从头截断，
 *    因此以「不保留超限会话」换取磁盘上限）；
 * 4. 删除后回收 `blobs/` 中无人引用的外置原文（内容寻址，按 sha256 引用）。
 */
export async function collectTraceGarbage(
  paths: TraceDirPaths,
  config: TraceConfig,
  now: number = Date.now(),
): Promise<TraceGcResult> {
  const result: TraceGcResult = { removedSessions: 0, removedBlobs: 0, freedBytes: 0 }

  let names: string[]
  try {
    names = (await readdir(paths.sessions)).filter((name) => name.endsWith('.jsonl'))
  } catch {
    return result
  }

  const candidates: Survivor[] = []
  for (const name of names) {
    const filePath = path.join(paths.sessions, name)
    try {
      const info = await stat(filePath)
      const scanned = await scanSessionLog(filePath).catch(() => null)
      candidates.push({
        name,
        filePath,
        mtimeMs: info.mtimeMs,
        sizeBytes: info.size,
        events: scanned?.events ?? [],
      })
    } catch {
      // 读取失败的文件跳过（不误删）
    }
  }

  const expiresBefore = now - config.retentionDays * 24 * 60 * 60 * 1000
  const maxBytes = config.maxFileMB * 1024 * 1024
  const survivors: Survivor[] = []

  // 先按时间与体积筛掉，再按数量保留最新
  const kept: Survivor[] = []
  for (const candidate of candidates) {
    const tooOld = candidate.mtimeMs < expiresBefore
    const tooLarge = candidate.sizeBytes > maxBytes
    if (tooOld || tooLarge) continue
    kept.push(candidate)
  }
  kept.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const withinCount = kept.slice(0, config.maxSessions)
  survivors.push(...withinCount)

  // 未被保留的候选（超期、超体积、超出会话数上限）一律删除
  const toRemove = candidates.filter((candidate) => !withinCount.includes(candidate))
  const removedPaths = new Set(toRemove.map((candidate) => candidate.filePath))

  for (const candidate of candidates) {
    if (!removedPaths.has(candidate.filePath)) continue
    try {
      await rm(candidate.filePath, { force: true })
      result.removedSessions += 1
      result.freedBytes += candidate.sizeBytes
    } catch {
      // 删除失败保持原状
    }
  }

  // 外置原文回收：只保留仍被存活日志引用的内容
  const referenced = new Set<string>()
  for (const survivor of survivors) {
    if (removedPaths.has(survivor.filePath)) continue
    for (const event of survivor.events) {
      const json = JSON.stringify(event.data)
      for (const match of json.matchAll(/"blobRef":"([0-9a-f]{64})"/g)) {
        referenced.add(match[1]!)
      }
    }
  }
  let blobNames: string[] = []
  try {
    blobNames = await readdir(paths.blobs)
  } catch {
    blobNames = []
  }
  for (const name of blobNames) {
    if (referenced.has(name)) continue
    const blobPath = path.join(paths.blobs, name)
    try {
      const info = await stat(blobPath)
      await rm(blobPath, { force: true })
      result.removedBlobs += 1
      result.freedBytes += info.size
    } catch {
      // 忽略
    }
  }

  return result
}

/** 删除单个会话的链路日志与原文引用（会话被删除时调用） */
export async function deleteSessionLog(
  paths: TraceDirPaths,
  sessionId: string,
): Promise<boolean> {
  const filePath = path.join(paths.sessions, `${encodeTraceSegment(sessionId)}.jsonl`)
  try {
    await stat(filePath)
  } catch {
    return false
  }
  try {
    await rm(filePath, { force: true })
    return true
  } catch {
    return false
  }
}
