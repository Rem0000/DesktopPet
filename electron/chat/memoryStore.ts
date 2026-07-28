import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteTextFile } from '../fsAtomic'
import { MemoryVectorIndex } from '../retrieval/memoryVectorIndex'
import type {
  MemoryImportance,
  MemoryItem,
  MemoryType,
  MemoryUpdateInput,
  MemoryWriteInput,
  SessionMemorySummary,
} from '../../src/chat/contracts'

const STORE_VERSION = 1
const MAX_ITEMS = 500

type MemoryDatabase = {
  version: typeof STORE_VERSION
  items: MemoryItem[]
  summaries: SessionMemorySummary[]
}

function emptyDatabase(): MemoryDatabase {
  return { version: STORE_VERSION, items: [], summaries: [] }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function isMemoryDatabase(value: unknown): value is MemoryDatabase {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<MemoryDatabase>
  return (
    candidate.version === STORE_VERSION &&
    Array.isArray(candidate.items) &&
    Array.isArray(candidate.summaries)
  )
}

/** 兼容旧 JSON：补齐可选字段默认值 */
function normalizeLoadedItem(item: MemoryItem): MemoryItem {
  const next = { ...item }
  if (next.pinned !== true) delete next.pinned
  if (typeof next.lastAccessedAt !== 'string') delete next.lastAccessedAt
  return next
}

const SENSITIVE_PATTERN =
  /(api[_-]?key|sk-[a-z0-9]{10,}|password|passwd|secret|token|bearer\s+[a-z0-9._-]+)/i

export function assertSafeMemoryContent(content: string): void {
  const trimmed = content.trim()
  if (!trimmed) throw new Error('记忆内容不能为空')
  if (trimmed.length > 2_000) throw new Error('单条记忆不能超过 2000 个字符')
  if (SENSITIVE_PATTERN.test(trimmed)) {
    throw new Error('拒绝写入疑似密钥或敏感机密内容')
  }
}

function normalizeKey(key: string | undefined, type: MemoryType): string | undefined {
  if (type !== 'profile' && type !== 'preference') return undefined
  const normalized = key?.trim()
  if (!normalized) throw new Error(`${type} 类型记忆必须提供 key`)
  if (normalized.length > 120) throw new Error('记忆 key 过长')
  return normalized
}

function normalizeImportance(value: MemoryImportance | undefined): MemoryImportance {
  if (value === 1 || value === 2 || value === 3) return value
  return 2
}

function memoryEmbeddingText(item: MemoryItem): string {
  return `${item.key ?? ''} ${item.content}`.trim()
}

export class MemoryStore {
  private readonly dataPath: string
  private readonly vectorIndex: MemoryVectorIndex
  private database = emptyDatabase()
  private initialized = false
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(storageDirectory: string) {
    this.dataPath = path.join(storageDirectory, 'memory-data.json')
    this.vectorIndex = new MemoryVectorIndex(storageDirectory)
  }

  async initialize(): Promise<void> {
    await this.vectorIndex.initialize()
    await mkdir(path.dirname(this.dataPath), { recursive: true })
    try {
      const raw = await readFile(this.dataPath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (!isMemoryDatabase(parsed)) throw new Error('不支持的记忆数据格式')
      this.database = {
        version: STORE_VERSION,
        items: parsed.items.map(normalizeLoadedItem),
        summaries: parsed.summaries,
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        const backupPath = `${this.dataPath}.corrupt-${Date.now()}`
        try {
          await rename(this.dataPath, backupPath)
        } catch {
          // ignore
        }
      }
      this.database = emptyDatabase()
      await this.persist()
    }
    this.initialized = true
    await this.ensureVectorConsistency()
  }

  getVector(memoryId: string): number[] | undefined {
    return this.vectorIndex.get(memoryId)
  }

  async rebuildVectorIndex(): Promise<void> {
    this.assertInitialized()
    const entries = this.getActiveItems().map((item) => ({
      id: item.id,
      text: memoryEmbeddingText(item),
    }))
    await this.vectorIndex.rebuild(entries)
  }

  listItems(): MemoryItem[] {
    this.assertInitialized()
    return clone(this.database.items).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    )
  }

  getItem(id: string): MemoryItem | null {
    this.assertInitialized()
    const item = this.database.items.find((entry) => entry.id === id)
    return item ? clone(item) : null
  }

  getActiveItems(now = new Date()): MemoryItem[] {
    this.assertInitialized()
    const iso = now.toISOString()
    return this.database.items.filter(
      (item) =>
        item.type !== 'preference' &&
        (!item.expiresAt || item.expiresAt > iso),
    )
  }

  async writeItem(input: MemoryWriteInput): Promise<MemoryItem> {
    if (input.type === 'preference') {
      throw new Error('已不支持 preference；请将模型个性化要求写入人设文件')
    }
    assertSafeMemoryContent(input.content)
    const key = normalizeKey(input.key, input.type)
    const importance = normalizeImportance(input.importance)
    const content = input.content.trim()
    const item = await this.mutate(() => {
      const now = new Date().toISOString()
      if (key && (input.type === 'profile' || input.type === 'preference')) {
        const existing = this.database.items.find(
          (item) => item.type === input.type && item.key === key,
        )
        if (existing) {
          existing.content = content
          existing.importance = importance
          existing.updatedAt = now
          existing.sourceSessionId = input.sourceSessionId ?? existing.sourceSessionId
          existing.sourceMessageIds =
            input.sourceMessageIds ?? existing.sourceMessageIds
          if (input.expiresAt) existing.expiresAt = input.expiresAt
          else delete existing.expiresAt
          return clone(existing)
        }
      }

      if (this.database.items.length >= MAX_ITEMS) {
        throw new Error('长期记忆条目已达上限，请先清理部分记忆')
      }

      const item: MemoryItem = {
        id: randomUUID(),
        type: input.type,
        content,
        importance,
        createdAt: now,
        updatedAt: now,
      }
      if (key) item.key = key
      if (input.pinned) item.pinned = true
      if (input.sourceSessionId) item.sourceSessionId = input.sourceSessionId
      if (input.sourceMessageIds?.length) {
        item.sourceMessageIds = [...input.sourceMessageIds]
      }
      if (input.expiresAt) item.expiresAt = input.expiresAt
      this.database.items.push(item)
      return clone(item)
    })
    await this.vectorIndex.upsert(item.id, memoryEmbeddingText(item))
    return item
  }

  async updateItem(id: string, patch: MemoryUpdateInput): Promise<MemoryItem> {
    const item = await this.mutate(() => {
      const item = this.database.items.find((entry) => entry.id === id)
      if (!item) throw new Error('记忆条目不存在')
      if (patch.content !== undefined) {
        assertSafeMemoryContent(patch.content)
        item.content = patch.content.trim()
      }
      if (patch.key !== undefined) {
        item.key = normalizeKey(patch.key, item.type)
      }
      if (patch.importance !== undefined) {
        item.importance = normalizeImportance(patch.importance)
      }
      if (patch.pinned === true) item.pinned = true
      else if (patch.pinned === false) delete item.pinned
      if (patch.expiresAt === null) delete item.expiresAt
      else if (typeof patch.expiresAt === 'string') item.expiresAt = patch.expiresAt
      item.updatedAt = new Date().toISOString()
      return clone(item)
    })
    await this.vectorIndex.upsert(item.id, memoryEmbeddingText(item))
    return item
  }

  async deleteItem(id: string): Promise<boolean> {
    const deleted = await this.mutate(() => {
      const index = this.database.items.findIndex((entry) => entry.id === id)
      if (index < 0) return false
      this.database.items.splice(index, 1)
      return true
    })
    if (deleted) await this.vectorIndex.delete(id)
    return deleted
  }

  async clearItems(): Promise<number> {
    const count = await this.mutate(() => {
      const count = this.database.items.length
      this.database.items = []
      return count
    })
    await this.vectorIndex.clear()
    return count
  }

  getSummary(sessionId: string): SessionMemorySummary | null {
    this.assertInitialized()
    const summary = this.database.summaries.find((entry) => entry.sessionId === sessionId)
    return summary ? clone(summary) : null
  }

  async upsertSummary(summary: SessionMemorySummary): Promise<SessionMemorySummary> {
    return this.mutate(() => {
      const index = this.database.summaries.findIndex(
        (entry) => entry.sessionId === summary.sessionId,
      )
      if (index >= 0) this.database.summaries[index] = summary
      else this.database.summaries.push(summary)
      return clone(summary)
    })
  }

  async touchAccessed(ids: string[], at = new Date().toISOString()): Promise<void> {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    await this.mutate(() => {
      for (const item of this.database.items) {
        if (idSet.has(item.id)) item.lastAccessedAt = at
      }
      return undefined
    })
  }

  /** 删除会话时不级联删除 L2；仅清理该会话摘要。 */
  async deleteSessionSummary(sessionId: string): Promise<boolean> {
    return this.mutate(() => {
      const index = this.database.summaries.findIndex(
        (entry) => entry.sessionId === sessionId,
      )
      if (index < 0) return false
      this.database.summaries.splice(index, 1)
      return true
    })
  }

  async deleteSessionSummaries(sessionIds: string[]): Promise<number> {
    if (sessionIds.length === 0) return 0
    const idSet = new Set(sessionIds)
    return this.mutate(() => {
      const before = this.database.summaries.length
      this.database.summaries = this.database.summaries.filter(
        (entry) => !idSet.has(entry.sessionId),
      )
      return before - this.database.summaries.length
    })
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('MemoryStore 尚未初始化')
  }

  private async mutate<T>(mutation: () => T): Promise<T> {
    this.assertInitialized()
    let result!: T
    const operation = this.writeQueue.then(async () => {
      result = mutation()
      await this.persist()
    })
    this.writeQueue = operation.catch(() => undefined)
    await operation
    return result
  }

  private async persist(): Promise<void> {
    await atomicWriteTextFile(this.dataPath, JSON.stringify(this.database, null, 2))
  }

  private async ensureVectorConsistency(): Promise<void> {
    const missing = this.getActiveItems().filter((item) => !this.vectorIndex.has(item.id))
    if (missing.length === 0) return
    await this.vectorIndex.upsertMany(
      missing.map((item) => ({ id: item.id, text: memoryEmbeddingText(item) })),
    )
  }
}
