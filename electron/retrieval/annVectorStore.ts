import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteTextFile } from '../fsAtomic'
import { HnswIndex, type HnswParams } from './hnswIndex'
import type { VectorRecord, VectorSearchHit } from './vectorStore'

/**
 * HNSW 向量存储：与 VectorStore 保持同一接口（get/has/upsert/upsertMany/delete/…），
 * 区别在 search 是 ANN（近似最近邻）查询，而非全量余弦扫描。
 *
 * 维度像 VectorStore 一样在首条写入时确定（延迟建索引），三个调用方无需预先知道维度。
 * 持久化复用现有 vectors.json 快照格式，版本升到 2 并附 hnsw 图参数；
 * 图连接在 initialize() 加载时用同参数重建——以重建代价换磁盘格式兼容与
 * "图损坏可自愈"的容错（详见 highlight_resume_pet.md）。
 */

type AnnVectorStoreSnapshot = {
  version: 2
  dim: number
  records: VectorRecord[]
  hnsw?: HnswParams
}

type V1Snapshot = {
  version: 1
  dim: number
  records: VectorRecord[]
}

export type AnnVectorStoreOptions = {
  m?: number
  maxM0?: number
  efConstruction?: number
  efSearch?: number
  levelMult?: number
  /** 可注入的均匀随机源（确定性重建/测试用） */
  rng?: () => number
  /** 落盘时是否写入 hnsw 图参数；默认 true */
  persistParams?: boolean
}

export class AnnVectorStore {
  private readonly filePath: string
  private readonly options: AnnVectorStoreOptions
  private readonly persistParams: boolean
  private index: HnswIndex | null = null
  private dim = 0

  constructor(filePath: string, options: AnnVectorStoreOptions = {}) {
    this.filePath = filePath
    this.options = options
    this.persistParams = options.persistParams ?? true
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as AnnVectorStoreSnapshot | V1Snapshot
      if (parsed?.version === 2 && Array.isArray(parsed.records)) {
        this.loadRecords(parsed.records, parsed.dim)
      } else if (parsed?.version === 1 && Array.isArray(parsed.records)) {
        // v1 旧文件：逐条 add 重建图后落盘 v2（迁移一次性完成）
        this.loadRecords(parsed.records, parsed.dim)
        await this.persist()
      } else {
        this.reset()
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        // corrupt snapshot -> start empty
      }
      this.reset()
    }
  }

  get(id: string): number[] | undefined {
    return this.index?.get(id)
  }

  has(id: string): boolean {
    return this.index?.has(id) ?? false
  }

  listIds(): string[] {
    return this.index?.listIds() ?? []
  }

  async upsert(id: string, vector: number[]): Promise<void> {
    this.applyUpsert(id, vector)
    await this.persist()
  }

  /** 批量写入：内存更新后单次落盘 */
  async upsertMany(entries: Array<{ id: string; vector: number[] }>): Promise<void> {
    if (entries.length === 0) return
    for (const entry of entries) {
      this.applyUpsert(entry.id, entry.vector)
    }
    await this.persist()
  }

  async delete(id: string): Promise<void> {
    if (!this.index?.delete(id)) return
    await this.persist()
  }

  /** 批量删除：内存更新后单次落盘 */
  async deleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    let changed = false
    for (const id of ids) {
      if (this.index?.delete(id)) changed = true
    }
    if (changed) await this.persist()
  }

  async clear(): Promise<void> {
    this.index?.clear()
    this.index = null
    this.dim = 0
    await this.persist()
  }

  /** ANN 近似最近邻查询（topK 精确性由 HNSW 参数与 efSearch 决定） */
  search(queryVector: number[], topK = 20, opts?: { efSearch?: number }): VectorSearchHit[] {
    if (!this.index || queryVector.length === 0) return []
    return this.index.search(queryVector, topK, opts?.efSearch)
  }

  /** hybridSearch 的 searchVector 回调同义别名，避免语义歧义 */
  searchVector(
    queryVector: number[],
    topK = 20,
    opts?: { efSearch?: number },
  ): VectorSearchHit[] {
    return this.search(queryVector, topK, opts)
  }

  private ensureIndex(dim: number): HnswIndex {
    if (this.index && this.index.dim === dim) return this.index
    this.index = new HnswIndex({
      dim,
      m: this.options.m,
      maxM0: this.options.maxM0,
      efConstruction: this.options.efConstruction,
      efSearch: this.options.efSearch,
      levelMult: this.options.levelMult,
      rng: this.options.rng,
    })
    return this.index
  }

  private applyUpsert(id: string, vector: number[]): void {
    if (vector.length === 0) throw new Error('向量不能为空')
    if (this.dim === 0) this.dim = vector.length
    if (vector.length !== this.dim) {
      throw new Error(`向量维度不匹配：期望 ${this.dim}，实际 ${vector.length}`)
    }
    this.ensureIndex(this.dim).add(id, vector)
  }

  private loadRecords(records: VectorRecord[], dim: number): void {
    this.reset()
    this.dim = dim
    const index = this.ensureIndex(dim)
    for (const record of records) {
      if (typeof record.id === 'string' && Array.isArray(record.vector)) {
        index.add(record.id, record.vector)
      }
    }
  }

  private reset(): void {
    this.index = null
    this.dim = 0
  }

  private async persist(): Promise<void> {
    const index = this.index
    const payload: AnnVectorStoreSnapshot = {
      version: 2,
      dim: this.dim,
      records: index ? index.listIds().map((id) => ({ id, vector: index.get(id) ?? [] })) : [],
      ...(this.persistParams && index ? { hnsw: index.getParams() } : {}),
    }
    await atomicWriteTextFile(this.filePath, JSON.stringify(payload))
  }
}
