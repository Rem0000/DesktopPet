import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteTextFile } from '../fsAtomic'
import type {
  EvolutionProposal,
  RelationshipHistoryEntry,
  RelationshipPatch,
  RelationshipStage,
  RelationshipState,
  RelationshipWriteInput,
} from '../../src/chat/contracts'
import {
  stageForAffinity,
  STAGE_ORDER,
} from './relationshipStages'

export { stageForAffinity, STAGE_ORDER } from './relationshipStages'

export const AFFINITY_MIN = 0
export const AFFINITY_MAX = 100
export const DEFAULT_AFFINITY = 20
export const MAX_AFFINITY_DELTA = 10
export const MAX_NOTE_LENGTH = 120
export const MAX_TEMPERATURE_NOTE_LENGTH = 200

export function clampAffinity(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_AFFINITY
  return Math.min(AFFINITY_MAX, Math.max(AFFINITY_MIN, Math.round(value)))
}

/** 单次好感增量钳制 ±MAX_AFFINITY_DELTA；非有限值视为 0 */
export function clampAffinityDelta(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(MAX_AFFINITY_DELTA, Math.max(-MAX_AFFINITY_DELTA, Math.round(value)))
}

function nowIso(): string {
  return new Date().toISOString()
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

export function defaultRelationshipState(): RelationshipState {
  return {
    policy: 'layered',
    affinity: DEFAULT_AFFINITY,
    stage: 'stranger',
    temperatureNote: '',
    evolutions: [],
    history: [],
    updatedAt: nowIso(),
  }
}

function isStage(value: unknown): value is RelationshipStage {
  return typeof value === 'string' && (STAGE_ORDER as string[]).includes(value)
}

/** 兼容旧/缺失字段：按默认值补齐，避免脏数据破坏渲染 */
function normalizeLoadedState(raw: unknown): RelationshipState {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<RelationshipState>
  const state = defaultRelationshipState()
  state.policy =
    value.policy === 'persona-first' || value.policy === 'dynamic-first'
      ? value.policy
      : 'layered'
  state.affinity = clampAffinity(value.affinity ?? DEFAULT_AFFINITY)
  state.stage = isStage(value.stage) ? value.stage : stageForAffinity(state.affinity)
  state.temperatureNote =
    typeof value.temperatureNote === 'string' ? value.temperatureNote : ''
  state.evolutions = Array.isArray(value.evolutions)
    ? value.evolutions.filter(
        (item): item is EvolutionProposal =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as EvolutionProposal).id === 'string' &&
          typeof (item as EvolutionProposal).change === 'string',
      )
    : []
  state.history = Array.isArray(value.history) ? value.history : []
  state.lastEvaluatedAt =
    typeof value.lastEvaluatedAt === 'string' ? value.lastEvaluatedAt : undefined
  state.updatedAt =
    typeof value.updatedAt === 'string' ? value.updatedAt : state.updatedAt
  return state
}

/** 将 packageId 安全化为文件名（Windows 非法字符替换） */
function safeFileName(packageId: string): string {
  return packageId.replace(/[^\w.-]/g, '_')
}

/**
 * 按包关系状态存储：`data/relationships/<packageId>.json`。
 * 文件不存在时按默认值使用；写入走原子写 + 串行队列，避免并发读改写丢失。
 */
export class RelationshipStore {
  private readonly root: string
  /** 每包串行化 读-改-写 队列，避免并发读改写丢失；不同包互不阻塞 */
  private readonly writeQueues = new Map<string, Promise<void>>()

  constructor(storageDirectory: string) {
    this.root = storageDirectory
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true })
  }

  private filePath(packageId: string): string {
    return path.join(this.root, `${safeFileName(packageId)}.json`)
  }

  async getState(packageId: string): Promise<RelationshipState> {
    try {
      const raw = await readFile(this.filePath(packageId), 'utf8')
      return normalizeLoadedState(JSON.parse(raw))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return defaultRelationshipState()
      throw error
    }
  }

  /** 仅返回供 UI 只读展示的状态；不触发写入 */
  async peekState(packageId: string): Promise<RelationshipState> {
    return this.getState(packageId)
  }

  /** 串行化 读-改-写（按包独立队列；同包内严格 FIFO） */
  private mutate<T>(
    packageId: string,
    mutation: (state: RelationshipState) => T,
  ): Promise<T> {
    const previous = this.writeQueues.get(packageId) ?? Promise.resolve()
    const operation = previous.then(async () => {
      const state = await this.getState(packageId)
      const next = mutation(state)
      await this.persist(packageId, state)
      return next
    })
    // 队列尾部跟踪吞掉错误，避免一条失败连带毒化整链；
    // 调用方仍能拿到各自的 rejection。
    this.writeQueues.set(
      packageId,
      operation.then(
        () => undefined,
        () => undefined,
      ),
    )
    return operation
  }

  private async persist(packageId: string, state: RelationshipState): Promise<void> {
    await atomicWriteTextFile(
      this.filePath(packageId),
      `${JSON.stringify(state, null, 2)}\n`,
    )
  }

  /** update_relationship 工具路径：应用好感增量 + 关系笔记 */
  async applyWrite(
    packageId: string,
    input: RelationshipWriteInput,
  ): Promise<RelationshipState> {
    return this.mutate(packageId, (state) => {
      const delta = clampAffinityDelta(input.delta ?? 0)
      const note = (input.note ?? '').trim().slice(0, MAX_NOTE_LENGTH)
      if (delta === 0 && !note) return clone(state)
      const beforeStage = state.stage
      state.affinity = clampAffinity(state.affinity + delta)
      state.stage = stageForAffinity(state.affinity)
      const entry: RelationshipHistoryEntry = {
        at: nowIso(),
        type: 'affinity',
        note: note || undefined,
        sessionId: input.sessionId,
      }
      if (delta !== 0) entry.delta = delta
      if (state.stage !== beforeStage) {
        entry.beforeStage = beforeStage
        entry.afterStage = state.stage
      }
      state.history.push(entry)
      state.updatedAt = nowIso()
      return clone(state)
    })
  }

  /** 面板手工修正：affinity / temperatureNote / policy */
  async patch(packageId: string, patch: RelationshipPatch): Promise<RelationshipState> {
    return this.mutate(packageId, (state) => {
      const entries: RelationshipHistoryEntry[] = []
      if (patch.affinity !== undefined) {
        const clamped = clampAffinity(patch.affinity)
        if (clamped !== state.affinity) {
          const beforeStage = state.stage
          state.affinity = clamped
          state.stage = stageForAffinity(clamped)
          const entry: RelationshipHistoryEntry = { at: nowIso(), type: 'manual' }
          if (state.stage !== beforeStage) {
            entry.beforeStage = beforeStage
            entry.afterStage = state.stage
          }
          entries.push(entry)
        }
      }
      if (patch.temperatureNote !== undefined) {
        const nextNote = patch.temperatureNote
          .trim()
          .slice(0, MAX_TEMPERATURE_NOTE_LENGTH)
        // 仅在描述真正变化时记录，避免面板反复保存刷历史
        if (nextNote !== state.temperatureNote) {
          state.temperatureNote = nextNote
          entries.push({ at: nowIso(), type: 'manual', note: '更新当下态度描述' })
        }
      }
      if (patch.policy !== undefined) {
        state.policy = patch.policy
        entries.push({ at: nowIso(), type: 'manual', note: `策略改为 ${patch.policy}` })
      }
      if (entries.length > 0) {
        state.history.push(...entries)
        state.updatedAt = nowIso()
      }
      return clone(state)
    })
  }

  /** 面板重置：回到默认（policy=layered、affinity=默认、stage=stranger、清空演化与历史） */
  async reset(packageId: string): Promise<RelationshipState> {
    return this.mutate(packageId, (state) => {
      const fresh = defaultRelationshipState()
      fresh.history.push({ at: nowIso(), type: 'reset', note: '重置关系状态' })
      Object.assign(state, fresh)
      return clone(state)
    })
  }

  async listProposals(packageId: string): Promise<EvolutionProposal[]> {
    const state = await this.getState(packageId)
    return state.evolutions.filter((item) => item.status === 'proposed')
  }

  async addProposal(
    packageId: string,
    input: { personaQuote: string; change: string; evidence: string },
    sessionId?: string,
  ): Promise<EvolutionProposal> {
    return this.mutate(packageId, (state) => {
      const proposal: EvolutionProposal = {
        id: randomUUID(),
        personaQuote: input.personaQuote.trim().slice(0, 200),
        change: input.change.trim().slice(0, 200),
        evidence: input.evidence.trim().slice(0, 300),
        status: 'proposed',
        createdAt: nowIso(),
        sessionId,
      }
      if (!proposal.personaQuote || !proposal.change) {
        throw new Error('演化候选缺少 personaQuote 或 change')
      }
      state.evolutions.push(proposal)
      state.updatedAt = nowIso()
      return clone(proposal)
    })
  }

  async respondProposal(
    packageId: string,
    proposalId: string,
    accept: boolean,
  ): Promise<EvolutionProposal> {
    return this.mutate(packageId, (state) => {
      const proposal = state.evolutions.find((item) => item.id === proposalId)
      if (!proposal) throw new Error('演化候选不存在')
      if (proposal.status !== 'proposed') throw new Error('该候选已处理')
      proposal.status = accept ? 'applied' : 'rejected'
      if (accept) {
        proposal.appliedAt = nowIso()
        state.history.push({
          at: nowIso(),
          type: 'evolution',
          note: `接受演化：${proposal.change}`,
        })
      }
      state.updatedAt = nowIso()
      return clone(proposal)
    })
  }

  /** 记录一次评估时间（用于触发间隔闸门） */
  async markEvaluated(packageId: string): Promise<void> {
    await this.mutate(packageId, (state) => {
      state.lastEvaluatedAt = nowIso()
      state.updatedAt = nowIso()
    })
  }

  /** 删除包时级联清理关系状态 */
  async deletePackage(packageId: string): Promise<boolean> {
    try {
      await rm(this.filePath(packageId), { force: true })
      return true
    } catch {
      return false
    }
  }
}
