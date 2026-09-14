import path from 'node:path'
import { readdir } from 'node:fs/promises'
import type {
  TraceConfig,
  TraceContextProjection,
  TraceEvent,
  TraceReadOptions,
  TraceReadResult,
  TraceSessionSummary,
  TraceStats,
} from '../../src/trace/contracts'
import { encodeTraceSegment, type TraceDirPaths } from '../projectPaths'
import { foldContextPressure, foldStats, foldUsageByTurn, summarizeSession } from './projections'
import { paginateEvents, scanSessionLog } from './traceReader'
import {
  exportSessionToJson,
  exportSessionToMarkdown,
  type TraceExportFormat,
} from './traceExport'
import {
  collectTraceGarbage,
  deleteSessionLog,
  type TraceGcResult,
} from './traceRetention'
import { TraceRecorder } from './traceRecorder'
import { repairAllSessions, TraceSessionWriter } from './traceWriter'

export type TraceTurnFacts = {
  sessionId: string
  packageId: string
  /** 轮次序号（1 起） */
  turn: number
  provider: { kind: string; baseUrl: string; model: string; plannerModel?: string }
  context: { budgetCharacters: number; importanceTrim: boolean; recentWindowChars: number }
  tools: Array<{ name: string; enabled: boolean; riskLevel: 'safe' | 'confirm' }>
}

/**
 * 链路追踪门面：按会话缓存写入器、组装首行 header、提供读取/修复入口。
 * 写入路径始终非阻塞；读取与修复是显式异步操作。
 */
export class TraceStore {
  private readonly writers = new Map<string, TraceSessionWriter>()

  constructor(
    private readonly paths: TraceDirPaths,
    private config: TraceConfig,
    private readonly onEvent?: (sessionId: string, event: TraceEvent) => void,
  ) {}

  getConfig(): TraceConfig {
    return this.config
  }

  setConfig(config: TraceConfig): void {
    this.config = config
  }

  get enabled(): boolean {
    return this.config.enabled && this.config.level !== 'off'
  }

  logPathFor(sessionId: string): string {
    return path.join(this.paths.sessions, `${encodeTraceSegment(sessionId)}.jsonl`)
  }

  blobPathFor(ref: string): string {
    return path.join(this.paths.blobs, ref)
  }

  /** 开启一轮链路记录；日志停用时返回 null（调用方据此跳过全部观测） */
  async beginTurn(facts: TraceTurnFacts): Promise<TraceRecorder | null> {
    if (!this.enabled) return null
    try {
      const writer = this.writerFor(facts.sessionId)
      await writer.open({
        sessionId: facts.sessionId,
        packageId: facts.packageId,
        createdAt: Date.now(),
        provider: facts.provider,
        context: facts.context,
        tools: facts.tools,
        redaction: {
          level: this.config.level,
          maxFieldChars: this.config.maxFieldChars,
        },
      })
      return new TraceRecorder(writer, this.config, facts.sessionId, facts.turn)
    } catch {
      return null
    }
  }

  private writerFor(sessionId: string): TraceSessionWriter {
    const existing = this.writers.get(sessionId)
    if (existing) return existing
    const writer = new TraceSessionWriter(
      sessionId,
      this.paths,
      this.config,
      this.onEvent,
    )
    this.writers.set(sessionId, writer)
    return writer
  }

  /** 读取某会话事件（分页/过滤）；不存在时返回空结果 */
  async readSession(
    sessionId: string,
    options: TraceReadOptions = {},
  ): Promise<TraceReadResult> {
    const scanned = await scanSessionLog(this.logPathFor(sessionId))
    const page = paginateEvents(scanned, options)
    // 按轮用量在读取侧折叠（用于展示），避免渲染端重复实现聚合逻辑
    const usageByTurn = [...foldUsageByTurn(scanned.events).entries()]
      .map(([turn, usage]) => ({ turn, usage }))
      .sort((a, b) => a.turn - b.turn)
    return { ...page, usageByTurn }
  }

  /** 列出全部已知会话 id（由文件读取；会跳过损坏/不可读文件） */
  async listSessionIds(): Promise<string[]> {
    let names: string[]
    try {
      names = await readdir(this.paths.sessions)
    } catch {
      return []
    }
    const ids: string[] = []
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue
      const scanned = await scanSessionLog(path.join(this.paths.sessions, name)).catch(
        () => null,
      )
      if (scanned?.header) ids.push(scanned.header.sessionId)
    }
    return ids.sort()
  }

  /** 读取全部会话事件（供跨会话统计等只读投影使用） */
  async readAllSessions(): Promise<Array<{ sessionId: string; events: TraceEvent[] }>> {
    const ids = await this.listSessionIds()
    const out: Array<{ sessionId: string; events: TraceEvent[] }> = []
    for (const sessionId of ids) {
      const scanned = await scanSessionLog(this.logPathFor(sessionId)).catch(() => null)
      out.push({ sessionId, events: scanned?.events ?? [] })
    }
    return out
  }

  /** 会话摘要（轮数/用量/工具成功率），供会话列表与聊天窗用量展示 */
  async summarizeSession(sessionId: string): Promise<TraceSessionSummary | null> {
    const scanned = await scanSessionLog(this.logPathFor(sessionId)).catch(() => null)
    if (!scanned?.header) return null
    return summarizeSession(scanned.header, scanned.events)
  }

  /** 全部会话摘要，按最近更新倒序 */
  async listSessions(): Promise<TraceSessionSummary[]> {
    const scanned = await Promise.all(
      (await this.listSessionIds()).map(async (sessionId) => {
        const log = await scanSessionLog(this.logPathFor(sessionId)).catch(() => null)
        return log?.header ? summarizeSession(log.header, log.events) : null
      }),
    )
    return scanned
      .filter((item): item is TraceSessionSummary => item !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /** 上下文压力投影（真值来自按次落盘的 request/context 事件） */
  async contextPressure(sessionId: string): Promise<TraceContextProjection> {
    const scanned = await scanSessionLog(this.logPathFor(sessionId)).catch(() => null)
    return foldContextPressure(scanned?.events ?? [])
  }

  /** 会话统计；缺省 sessionId 时汇总全部会话 */
  async stats(sessionId?: string): Promise<TraceStats> {
    if (sessionId) {
      const scanned = await scanSessionLog(this.logPathFor(sessionId)).catch(() => null)
      return foldStats(scanned?.events ?? [])
    }
    const all = await this.readAllSessions()
    return foldStats(all.flatMap((item) => item.events))
  }

  /** 应用启动时的崩溃修复：为停在轮次中间的日志追加合成收尾 */
  async repairInterrupted(): Promise<number> {
    return repairAllSessions(this.paths, this.config)
  }

  /** 保留策略清理（超期 / 超额 / 超单文件上限 + 无引用原文回收） */
  async collectGarbage(now?: number): Promise<TraceGcResult> {
    const result = await collectTraceGarbage(this.paths, this.config, now)
    for (const sessionId of [...this.writers.keys()]) {
      // 已被清理的会话不再持有写入器缓存
      const stillExists = await this.summarizeSession(sessionId)
      if (!stillExists) this.writers.delete(sessionId)
    }
    return result
  }

  /** 会话删除时清理其链路日志 */
  async deleteSession(sessionId: string): Promise<boolean> {
    this.writers.delete(sessionId)
    return deleteSessionLog(this.paths, sessionId)
  }

  /** 导出某会话（structured JSON 或可读 Markdown），导出副本再次遮罩 */
  async exportSession(
    sessionId: string,
    format: TraceExportFormat,
  ): Promise<string | null> {
    const scanned = await scanSessionLog(this.logPathFor(sessionId)).catch(() => null)
    if (!scanned?.header) return null
    const header = scanned.header
    const summary = summarizeSession(header, scanned.events)
    return format === 'json'
      ? exportSessionToJson({ header, events: scanned.events, summary })
      : exportSessionToMarkdown({ header, events: scanned.events, summary })
  }

  async flush(sessionId?: string): Promise<void> {
    const targets = sessionId
      ? [this.writers.get(sessionId)].filter(Boolean)
      : [...this.writers.values()]
    await Promise.all(
      (targets as TraceSessionWriter[]).map((writer) => writer.flush()),
    )
  }
}
