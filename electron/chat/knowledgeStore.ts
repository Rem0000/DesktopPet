import { randomUUID } from 'node:crypto'
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { embedQuery, embedTexts } from '../retrieval/embeddingService'
import { hybridSearch } from '../retrieval/hybridSearch'
import { chunkMarkdown } from '../retrieval/markdownChunker'
import { extractSearchTerms } from '../retrieval/tokenize'
import { AnnVectorStore } from '../retrieval/annVectorStore'
import { atomicWriteTextFile } from '../fsAtomic'
import { EmbeddingModelError } from '../retrieval/types'

export type KnowledgeDocument = {
  id: string
  title: string
  sourceName: string
  relativePath: string
  createdAt: string
  updatedAt: string
}

export type KnowledgeChunk = {
  chunkId: string
  documentId: string
  title: string
  content: string
  headingPath: string[]
  startOffset: number
  endOffset: number
}

export type KnowledgeHit = {
  documentId: string
  chunkId: string
  title: string
  sourceName: string
  content: string
  headingPath: string[]
  score: number
  recallSource?: 'sparse' | 'vector' | 'both'
}

type KnowledgeIndex = {
  version: 2
  documents: KnowledgeDocument[]
  chunks: KnowledgeChunk[]
}

function emptyIndex(): KnowledgeIndex {
  return { version: 2, documents: [], chunks: [] }
}

function normalizeChunk(chunk: Partial<KnowledgeChunk> & Pick<KnowledgeChunk, 'chunkId' | 'documentId' | 'title' | 'content'>): KnowledgeChunk {
  return {
    chunkId: chunk.chunkId,
    documentId: chunk.documentId,
    title: chunk.title,
    content: chunk.content,
    headingPath: Array.isArray(chunk.headingPath) ? chunk.headingPath : [],
    startOffset: typeof chunk.startOffset === 'number' ? chunk.startOffset : 0,
    endOffset: typeof chunk.endOffset === 'number' ? chunk.endOffset : chunk.content.length,
  }
}

/** 兼容旧测试：导出分词工具 */
export { extractSearchTerms }

export function scoreChunk(chunk: KnowledgeChunk, query: string): number {
  const normalizedQuery = query.toLowerCase().trim()
  const haystack = `${chunk.title} ${chunk.content} ${chunk.headingPath.join(' ')}`.toLowerCase()
  if (!normalizedQuery) return 0

  let score = 0
  if (haystack.includes(normalizedQuery)) score += 8

  const terms = extractSearchTerms(normalizedQuery)
  if (terms.length === 0) return score

  let hits = 0
  for (const term of terms) {
    if (!haystack.includes(term)) continue
    hits += 1
    score += term.length >= 4 ? 3 : term.length >= 3 ? 2 : 1
  }
  if (hits === 0) return 0
  return score
}

export class KnowledgeStore {
  private readonly root: string
  private readonly docsDir: string
  private readonly indexPath: string
  private readonly vectorStore: AnnVectorStore
  private index = emptyIndex()
  private initialized = false
  private writeQueue: Promise<void> = Promise.resolve()
  private rebuildQueue: Promise<void> = Promise.resolve()

  constructor(storageDirectory: string) {
    this.root = storageDirectory
    this.docsDir = path.join(this.root, 'documents')
    this.indexPath = path.join(this.root, 'index.json')
    this.vectorStore = new AnnVectorStore(path.join(this.root, 'vectors.json'))
  }

  async initialize(): Promise<void> {
    await mkdir(this.docsDir, { recursive: true })
    await this.vectorStore.initialize()
    try {
      const raw = await readFile(this.indexPath, 'utf8')
      const parsed = JSON.parse(raw) as {
        version?: number
        documents?: KnowledgeDocument[]
        chunks?: Array<Partial<KnowledgeChunk> & Pick<KnowledgeChunk, 'chunkId' | 'documentId' | 'title' | 'content'>>
      }
      if (parsed?.version === 2 && Array.isArray(parsed.documents) && Array.isArray(parsed.chunks)) {
        this.index = {
          version: 2,
          documents: parsed.documents,
          chunks: parsed.chunks.map((chunk) => normalizeChunk(chunk as KnowledgeChunk)),
        }
      } else if (
        parsed &&
        parsed.version === 1 &&
        Array.isArray(parsed.documents) &&
        Array.isArray(parsed.chunks)
      ) {
        this.index = {
          version: 2,
          documents: parsed.documents as KnowledgeDocument[],
          chunks: (parsed.chunks as Array<Record<string, unknown>>).map((chunk) =>
            normalizeChunk({
              chunkId: String(chunk.chunkId),
              documentId: String(chunk.documentId),
              title: String(chunk.title),
              content: String(chunk.content),
              headingPath: [],
              startOffset: Number(chunk.startOffset ?? 0),
              endOffset: Number(chunk.endOffset ?? String(chunk.content).length),
            }),
          ),
        }
        await this.persist()
        await this.rebuildIndex()
      } else {
        this.index = emptyIndex()
        await this.persist()
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        // corrupt -> reset
      }
      this.index = emptyIndex()
      await this.persist()
    }
    this.initialized = true
    await this.ensureVectorConsistency()
  }

  listDocuments(): KnowledgeDocument[] {
    this.assertInitialized()
    return structuredClone(this.index.documents).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    )
  }

  async importFile(sourcePath: string): Promise<KnowledgeDocument> {
    this.assertInitialized()
    const ext = path.extname(sourcePath).toLowerCase()
    if (ext !== '.md' && ext !== '.txt') {
      throw new Error('仅支持导入 .md / .txt 文件')
    }
    const sourceName = path.basename(sourcePath)
    const title = sourceName.replace(/\.(md|txt)$/i, '')
    const text = await readFile(sourcePath, 'utf8')
    if (!text.trim()) throw new Error('文档内容为空')

    const id = randomUUID()
    const relativePath = `${id}${ext}`
    const dest = path.join(this.docsDir, relativePath)
    await copyFile(sourcePath, dest)
    const now = new Date().toISOString()
    const document: KnowledgeDocument = {
      id,
      title,
      sourceName,
      relativePath,
      createdAt: now,
      updatedAt: now,
    }
    const chunks = chunkMarkdown(id, text).map((chunk) => ({
      chunkId: chunk.chunkId,
      documentId: id,
      title,
      content: chunk.content,
      headingPath: chunk.headingPath,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
    }))
    const saved = await this.mutate(() => {
      this.index.documents.push(document)
      this.index.chunks.push(...chunks)
      return structuredClone(document)
    })
    await this.indexChunks(chunks)
    return saved
  }

  async deleteDocument(documentId: string): Promise<boolean> {
    this.assertInitialized()
    const document = this.index.documents.find((item) => item.id === documentId)
    if (!document) return false
    const chunkIds = this.index.chunks
      .filter((item) => item.documentId === documentId)
      .map((item) => item.chunkId)
    const filePath = path.join(this.docsDir, document.relativePath)
    await this.mutate(() => {
      this.index.documents = this.index.documents.filter((item) => item.id !== documentId)
      this.index.chunks = this.index.chunks.filter((item) => item.documentId !== documentId)
      return true
    })
    await this.vectorStore.deleteMany(chunkIds)
    await rm(filePath, { force: true })
    return true
  }

  async search(query: string, topK = 4): Promise<KnowledgeHit[]> {
    this.assertInitialized()
    if (!query.trim()) return []
    const docs = new Map(this.index.documents.map((item) => [item.id, item]))
    const corpus = this.index.chunks.map((chunk) => ({
      id: chunk.chunkId,
      text: `${chunk.title}\n${chunk.headingPath.join(' / ')}\n${chunk.content}`,
      metadata: {
        documentId: chunk.documentId,
        headingPath: chunk.headingPath,
      },
    }))

    const hits = await hybridSearch(query, corpus, {
      topK,
      embedQuery,
      getVector: (id) => this.vectorStore.get(id),
      searchVector: (queryVector, k) => this.vectorStore.searchVector(queryVector, k),
      metadataBoost: (item) => {
        const headingPath = (item.metadata?.headingPath as string[] | undefined) ?? []
        const joined = headingPath.join(' ').toLowerCase()
        const terms = extractSearchTerms(query)
        let boost = 0
        for (const term of terms) {
          if (joined.includes(term)) boost += 0.2
        }
        return Math.min(boost, 1)
      },
    })

    return hits
      .filter((hit) => hit.sparseScore > 0 || hit.vectorScore >= 0.55).map((hit) => {
      const chunk = this.index.chunks.find((item) => item.chunkId === hit.id)
      if (!chunk) {
        throw new Error(`缺失 chunk：${hit.id}`)
      }
      return {
        documentId: chunk.documentId,
        chunkId: chunk.chunkId,
        title: chunk.title,
        sourceName: docs.get(chunk.documentId)?.sourceName ?? chunk.title,
        content: chunk.content,
        headingPath: chunk.headingPath,
        score: hit.score,
        recallSource: hit.recallSource,
      }
    })
  }

  async importText(title: string, text: string, sourceName = `${title}.md`): Promise<KnowledgeDocument> {
    this.assertInitialized()
    const id = randomUUID()
    const relativePath = `${id}.md`
    await writeFile(path.join(this.docsDir, relativePath), text, 'utf8')
    const now = new Date().toISOString()
    const document: KnowledgeDocument = {
      id,
      title,
      sourceName,
      relativePath,
      createdAt: now,
      updatedAt: now,
    }
    const chunks = chunkMarkdown(id, text).map((chunk) => ({
      chunkId: chunk.chunkId,
      documentId: id,
      title,
      content: chunk.content,
      headingPath: chunk.headingPath,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
    }))
    const saved = await this.mutate(() => {
      this.index.documents.push(document)
      this.index.chunks.push(...chunks)
      return structuredClone(document)
    })
    await this.indexChunks(chunks)
    return saved
  }

  async rebuildIndex(onProgress?: (done: number, total: number) => void): Promise<void> {
    this.assertInitialized()
    const operation = this.rebuildQueue.then(async () => {
      await this.vectorStore.clear()
      const chunks = [...this.index.chunks]
      const batchSize = 16
      for (let index = 0; index < chunks.length; index += batchSize) {
        const batch = chunks.slice(index, index + batchSize)
        await this.indexChunks(batch)
        onProgress?.(Math.min(index + batch.length, chunks.length), chunks.length)
      }
    })
    this.rebuildQueue = operation.catch(() => undefined)
    await operation
  }

  private async indexChunks(chunks: KnowledgeChunk[]): Promise<void> {
    if (chunks.length === 0) return
    try {
      const vectors = await embedTexts(
        chunks.map(
          (chunk) => `${chunk.title}\n${chunk.headingPath.join(' / ')}\n${chunk.content}`,
        ),
      )
      const batch: Array<{ id: string; vector: number[] }> = []
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index]
        const vector = vectors[index]
        if (!chunk || !vector) continue
        batch.push({ id: chunk.chunkId, vector })
      }
      await this.vectorStore.upsertMany(batch)
    } catch (error) {
      if (error instanceof EmbeddingModelError) throw error
      throw error
    }
  }

  private async ensureVectorConsistency(): Promise<void> {
    const missing = this.index.chunks.filter((chunk) => !this.vectorStore.has(chunk.chunkId))
    if (missing.length === 0) return
    await this.indexChunks(missing)
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('KnowledgeStore 尚未初始化')
  }

  private async mutate<T>(mutation: () => T): Promise<T> {
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
    await atomicWriteTextFile(this.indexPath, JSON.stringify(this.index, null, 2))
  }
}

export async function listDemoKnowledgeFiles(demoDir: string): Promise<string[]> {
  try {
    const names = await readdir(demoDir)
    return names
      .filter((name) => /\.(md|txt)$/i.test(name))
      .map((name) => path.join(demoDir, name))
  } catch {
    return []
  }
}
