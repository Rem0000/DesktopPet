import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteTextFile } from '../fsAtomic'

export type VectorRecord = {
  id: string
  vector: number[]
}

export type VectorSearchHit = {
  id: string
  score: number
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let index = 0; index < a.length; index += 1) {
    const av = a[index] ?? 0
    const bv = b[index] ?? 0
    dot += av * bv
    normA += av * av
    normB += bv * bv
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

type VectorStoreSnapshot = {
  version: 1
  dim: number
  records: VectorRecord[]
}

export class VectorStore {
  private readonly filePath: string
  private dim = 0
  private records = new Map<string, number[]>()

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as VectorStoreSnapshot
      if (parsed?.version !== 1 || !Array.isArray(parsed.records)) return
      this.dim = parsed.dim
      this.records.clear()
      for (const record of parsed.records) {
        if (typeof record.id === 'string' && Array.isArray(record.vector)) {
          this.records.set(record.id, record.vector)
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        // corrupt snapshot -> start empty
      }
      this.records.clear()
      this.dim = 0
    }
  }

  get(id: string): number[] | undefined {
    return this.records.get(id)
  }

  has(id: string): boolean {
    return this.records.has(id)
  }

  listIds(): string[] {
    return [...this.records.keys()]
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
    if (!this.records.delete(id)) return
    await this.persist()
  }

  /** 批量删除：内存更新后单次落盘 */
  async deleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    let changed = false
    for (const id of ids) {
      if (this.records.delete(id)) changed = true
    }
    if (changed) await this.persist()
  }

  private applyUpsert(id: string, vector: number[]): void {
    if (vector.length === 0) throw new Error('向量不能为空')
    if (this.dim === 0) this.dim = vector.length
    if (vector.length !== this.dim) {
      throw new Error(`向量维度不匹配：期望 ${this.dim}，实际 ${vector.length}`)
    }
    this.records.set(id, vector)
  }

  async clear(): Promise<void> {
    this.records.clear()
    this.dim = 0
    await this.persist()
  }

  search(queryVector: number[], topK = 20): VectorSearchHit[] {
    if (queryVector.length === 0 || this.records.size === 0) return []
    if (this.dim !== 0 && queryVector.length !== this.dim) return []

    const hits: VectorSearchHit[] = []
    for (const [id, vector] of this.records) {
      hits.push({ id, score: cosineSimilarity(queryVector, vector) })
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, topK)
  }

  private async persist(): Promise<void> {
    const payload: VectorStoreSnapshot = {
      version: 1,
      dim: this.dim,
      records: [...this.records.entries()].map(([id, vector]) => ({ id, vector })),
    }
    await atomicWriteTextFile(this.filePath, JSON.stringify(payload))
  }
}

export { cosineSimilarity }
