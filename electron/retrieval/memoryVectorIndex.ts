import path from 'node:path'
import { embedTexts } from './embeddingService'
import { AnnVectorStore } from './annVectorStore'
import { EmbeddingModelError } from './types'
import type { VectorSearchHit } from './vectorStore'

export class MemoryVectorIndex {
  private readonly store: AnnVectorStore

  constructor(storageDirectory: string) {
    this.store = new AnnVectorStore(path.join(storageDirectory, 'vectors.json'))
  }

  async initialize(): Promise<void> {
    await this.store.initialize()
  }

  get(memoryId: string): number[] | undefined {
    return this.store.get(memoryId)
  }

  has(memoryId: string): boolean {
    return this.store.has(memoryId)
  }

  /** ANN 向量召回：供 MemoryService 的 hybridSearch 注入 searchVector */
  searchVector(queryVector: number[], topK = 20): VectorSearchHit[] {
    return this.store.searchVector(queryVector, topK)
  }

  async upsert(memoryId: string, text: string): Promise<void> {
    const [vector] = await embedTexts([text])
    if (!vector) throw new Error('记忆向量生成失败')
    await this.store.upsert(memoryId, vector)
  }

  async upsertMany(entries: Array<{ id: string; text: string }>): Promise<void> {
    if (entries.length === 0) return
    const vectors = await embedTexts(entries.map((entry) => entry.text))
    const batch: Array<{ id: string; vector: number[] }> = []
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]
      const vector = vectors[index]
      if (!entry || !vector) continue
      batch.push({ id: entry.id, vector })
    }
    await this.store.upsertMany(batch)
  }

  async delete(memoryId: string): Promise<void> {
    await this.store.delete(memoryId)
  }

  async clear(): Promise<void> {
    await this.store.clear()
  }

  async rebuild(entries: Array<{ id: string; text: string }>): Promise<void> {
    await this.clear()
    try {
      await this.upsertMany(entries)
    } catch (error) {
      if (error instanceof EmbeddingModelError) throw error
      throw error
    }
  }
}
