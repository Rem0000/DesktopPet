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
import { chunkMarkdownParentChild } from '../retrieval/markdownChunker'
import { extractSearchTerms } from '../retrieval/tokenize'
import { AnnVectorStore } from '../retrieval/annVectorStore'
import { atomicWriteTextFile } from '../fsAtomic'
import * as rerankService from '../retrieval/rerankerService'
import { EmbeddingModelError, type RerankItem } from '../retrieval/types'

const KNOWLEDGE_INDEX_VERSION = 3
const REBUILD_BATCH_SIZE = 8

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
  parentChunkId: string
  childChunkId?: string
  parentStartOffset?: number
  parentEndOffset?: number
  kind: 'parent' | 'child'
}

export type KnowledgeHit = {
  documentId: string
  /** 兼容既有调用方：始终是被返回、可注入上下文的父块 ID。 */
  chunkId: string
  parentChunkId: string
  /** 实际检索命中的子块 ID，供精确引用。 */
  childChunkId: string
  title: string
  sourceName: string
  /** 父块全文。 */
  content: string
  headingPath: string[]
  startOffset: number
  endOffset: number
  childStartOffset: number
  childEndOffset: number
  score: number
  recallSource?: 'sparse' | 'vector' | 'both'
}

type KnowledgeIndex = {
  version: typeof KNOWLEDGE_INDEX_VERSION
  documents: KnowledgeDocument[]
  chunks: KnowledgeChunk[]
}

function emptyIndex(): KnowledgeIndex {
  return { version: KNOWLEDGE_INDEX_VERSION, documents: [], chunks: [] }
}

function normalizeChunk(chunk: Partial<KnowledgeChunk> & Pick<KnowledgeChunk, 'chunkId' | 'documentId' | 'title' | 'content'>): KnowledgeChunk {
  const kind = chunk.kind === 'child' ? 'child' : 'parent'
  const parentChunkId = typeof chunk.parentChunkId === 'string' ? chunk.parentChunkId : chunk.chunkId
  return {
    chunkId: chunk.chunkId,
    documentId: chunk.documentId,
    title: chunk.title,
    content: chunk.content,
    headingPath: Array.isArray(chunk.headingPath) ? chunk.headingPath : [],
    startOffset: typeof chunk.startOffset === 'number' ? chunk.startOffset : 0,
    endOffset: typeof chunk.endOffset === 'number' ? chunk.endOffset : chunk.content.length,
    parentChunkId,
    ...(typeof chunk.childChunkId === 'string' ? { childChunkId: chunk.childChunkId } : {}),
    ...(typeof chunk.parentStartOffset === 'number' ? { parentStartOffset: chunk.parentStartOffset } : {}),
    ...(typeof chunk.parentEndOffset === 'number' ? { parentEndOffset: chunk.parentEndOffset } : {}),
    kind,
  }
}

export function assertKnowledgeIndexIntegrity(index: Pick<KnowledgeIndex, 'chunks'>): void {
  const parents = new Map(
    index.chunks
      .filter((chunk) => chunk.kind === 'parent')
      .map((chunk) => [chunk.parentChunkId, chunk]),
  )
  const ids = new Set<string>()
  for (const chunk of index.chunks) {
    if (ids.has(chunk.chunkId)) throw new Error(`知识库 chunk ID 重复：${chunk.chunkId}`)
    ids.add(chunk.chunkId)
    if (chunk.kind === 'parent' && chunk.parentChunkId !== chunk.chunkId) {
      throw new Error(`父块 ID 不一致：${chunk.chunkId}`)
    }
    if (chunk.kind === 'child' && (!chunk.childChunkId || !parents.has(chunk.parentChunkId))) {
      throw new Error(`知识库存在孤儿子块：${chunk.chunkId}`)
    }
  }
}

/** 兼容旧测试：导出分词工具。 */
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
  return hits === 0 ? 0 : score
}

export type KnowledgeStoreOptions = {
  enableRerank?: boolean
  vectorScoreThreshold?: number
  rerankTopK?: number
  rerankCandidateTopK?: number
}

export class KnowledgeStore {
  private readonly root: string
  private readonly docsDir: string
  private readonly indexPath: string
  private readonly vectorStore: AnnVectorStore
  private readonly enableRerank: boolean
  private readonly vectorScoreThreshold: number
  private readonly rerankTopK: number
  private readonly rerankCandidateTopK: number
  private index = emptyIndex()
  private initialized = false
  private rebuildRequired = false
  private writeQueue: Promise<void> = Promise.resolve()
  private rebuildQueue: Promise<void> = Promise.resolve()

  constructor(storageDirectory: string, options: KnowledgeStoreOptions = {}) {
    this.root = storageDirectory
    this.docsDir = path.join(this.root, 'documents')
    this.indexPath = path.join(this.root, 'index.json')
    this.vectorStore = new AnnVectorStore(path.join(this.root, 'vectors.json'))
    this.enableRerank = options.enableRerank ?? false
    this.vectorScoreThreshold = options.vectorScoreThreshold ?? 0.55
    this.rerankTopK = options.rerankTopK ?? 20
    this.rerankCandidateTopK = options.rerankCandidateTopK ?? 10
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
      if (parsed.version === KNOWLEDGE_INDEX_VERSION && Array.isArray(parsed.documents) && Array.isArray(parsed.chunks)) {
        this.index = {
          version: KNOWLEDGE_INDEX_VERSION,
          documents: parsed.documents,
          chunks: parsed.chunks.map((chunk) => normalizeChunk(chunk)),
        }
        try {
          assertKnowledgeIndexIntegrity(this.index)
        } catch {
          this.rebuildRequired = true
          this.index.chunks = []
        }
      } else if (parsed && Array.isArray(parsed.documents)) {
        // 旧单层索引没有可信的父子边界，保留源文档元数据但拒绝混用。
        this.index = { version: KNOWLEDGE_INDEX_VERSION, documents: parsed.documents, chunks: [] }
        this.rebuildRequired = this.index.documents.length > 0
        await this.persist()
      } else {
        this.index = emptyIndex()
        await this.persist()
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') this.rebuildRequired = true
      this.index = emptyIndex()
      await this.persist()
    }
    this.initialized = true
    if (!this.rebuildRequired) await this.ensureVectorConsistency()
  }

  listDocuments(): KnowledgeDocument[] {
    this.assertInitialized()
    return structuredClone(this.index.documents).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  /** 兼容既有评测：默认只暴露父块，即可被 Agent 实际注入的正文块。 */
  listChunks(): KnowledgeChunk[] {
    this.assertInitialized()
    return structuredClone(this.index.chunks.filter((chunk) => chunk.kind === 'parent'))
  }

  listParentChunks(): KnowledgeChunk[] {
    return this.listChunks()
  }

  listChildChunks(): KnowledgeChunk[] {
    this.assertInitialized()
    return structuredClone(this.index.chunks.filter((chunk) => chunk.kind === 'child'))
  }

  isRebuildRequired(): boolean {
    this.assertInitialized()
    return this.rebuildRequired
  }

  async importFile(sourcePath: string): Promise<KnowledgeDocument> {
    this.assertInitialized()
    const ext = path.extname(sourcePath).toLowerCase()
    if (ext !== '.md' && ext !== '.txt') throw new Error('仅支持导入 .md / .txt 文件')
    const sourceName = path.basename(sourcePath)
    const title = sourceName.replace(/\.(md|txt)$/i, '')
    const text = await readFile(sourcePath, 'utf8')
    if (!text.trim()) throw new Error('文档内容为空')

    const id = randomUUID()
    const relativePath = `${id}${ext}`
    await copyFile(sourcePath, path.join(this.docsDir, relativePath))
    const document = this.createDocument(id, title, sourceName, relativePath)
    await this.addDocument(document, text)
    return document
  }

  async importText(title: string, text: string, sourceName = `${title}.md`): Promise<KnowledgeDocument> {
    this.assertInitialized()
    if (!text.trim()) throw new Error('文档内容为空')
    const id = randomUUID()
    const relativePath = `${id}.md`
    await writeFile(path.join(this.docsDir, relativePath), text, 'utf8')
    const document = this.createDocument(id, title, sourceName, relativePath)
    await this.addDocument(document, text)
    return document
  }

  async deleteDocument(documentId: string): Promise<boolean> {
    this.assertInitialized()
    const document = this.index.documents.find((item) => item.id === documentId)
    if (!document) return false
    const childIds = this.index.chunks
      .filter((chunk) => chunk.documentId === documentId && chunk.kind === 'child')
      .map((chunk) => chunk.chunkId)
    await this.mutate(() => {
      this.index.documents = this.index.documents.filter((item) => item.id !== documentId)
      this.index.chunks = this.index.chunks.filter((item) => item.documentId !== documentId)
      if (this.index.documents.length === 0) this.rebuildRequired = false
      return undefined
    })
    await this.vectorStore.deleteMany(childIds)
    await rm(path.join(this.docsDir, document.relativePath), { force: true })
    return true
  }

  async search(query: string, topK = 4): Promise<KnowledgeHit[]> {
    this.assertInitialized()
    this.assertIndexReady()
    if (!query.trim()) return []
    const documents = new Map(this.index.documents.map((item) => [item.id, item]))
    const parents = new Map(this.listParentChunks().map((chunk) => [chunk.parentChunkId, chunk]))
    const children = this.index.chunks.filter((chunk) => chunk.kind === 'child')
    if (children.length === 0) return []
    const candidateTopK = Math.max(topK * 4, this.rerankCandidateTopK, 16)
    const corpus = children.map((child) => ({
      id: child.chunkId,
      text: `${child.title}\n${child.headingPath.join(' / ')}\n${child.content}`,
      metadata: { documentId: child.documentId, parentChunkId: child.parentChunkId, headingPath: child.headingPath },
    }))
    const candidateHits = await hybridSearch(query, corpus, {
      topK: candidateTopK,
      embedQuery,
      getVector: (id) => this.vectorStore.get(id),
      searchVector: (queryVector, k) => this.vectorStore.searchVector(queryVector, k),
      ...(this.enableRerank
        ? {
            rerankTopK: candidateTopK,
            reranker: (q: string, candidates: RerankItem[]) => rerankService.rerank(q, candidates, this.rerankTopK),
          }
        : {}),
      metadataBoost: (item) => {
        const headingPath = (item.metadata?.headingPath as string[] | undefined) ?? []
        const joined = headingPath.join(' ').toLowerCase()
        const terms = extractSearchTerms(query)
        return Math.min(terms.reduce((boost, term) => boost + (joined.includes(term) ? 0.2 : 0), 0), 1)
      },
    })

    const byParent = new Map<string, (typeof candidateHits)[number]>()
    for (const hit of candidateHits) {
      if (!(hit.sparseScore > 0 || hit.vectorScore >= this.vectorScoreThreshold)) continue
      const child = children.find((item) => item.chunkId === hit.id)
      if (!child) continue
      const previous = byParent.get(child.parentChunkId)
      if (!previous || hit.score > previous.score || (hit.score === previous.score && hit.id < previous.id)) {
        byParent.set(child.parentChunkId, hit)
      }
    }

    return [...byParent.values()]
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, topK)
      .flatMap((hit) => {
        const child = children.find((item) => item.chunkId === hit.id)
        if (!child) return []
        const parent = parents.get(child.parentChunkId)
        if (!parent) throw new Error(`子块缺少父块：${child.chunkId}`)
        return [{
          documentId: parent.documentId,
          chunkId: parent.parentChunkId,
          parentChunkId: parent.parentChunkId,
          childChunkId: child.childChunkId ?? child.chunkId,
          title: parent.title,
          sourceName: documents.get(parent.documentId)?.sourceName ?? parent.title,
          content: parent.content,
          headingPath: parent.headingPath,
          startOffset: parent.startOffset,
          endOffset: parent.endOffset,
          childStartOffset: child.startOffset,
          childEndOffset: child.endOffset,
          score: hit.score,
          recallSource: hit.recallSource,
        }]
      })
  }

  async rebuildIndex(onProgress?: (done: number, total: number) => void): Promise<void> {
    this.assertInitialized()
    const operation = this.rebuildQueue.then(async () => {
      const documents = [...this.index.documents]
      const rebuiltChunks: KnowledgeChunk[] = []
      const childBatches: KnowledgeChunk[][] = []
      await this.vectorStore.clear()
      for (let index = 0; index < documents.length; index += REBUILD_BATCH_SIZE) {
        const batch = documents.slice(index, index + REBUILD_BATCH_SIZE)
        const children: KnowledgeChunk[] = []
        for (const document of batch) {
          const text = await readFile(path.join(this.docsDir, document.relativePath), 'utf8')
          const chunks = this.createChunks(document, text)
          rebuiltChunks.push(...chunks)
          children.push(...chunks.filter((chunk) => chunk.kind === 'child'))
        }
        childBatches.push(children)
        onProgress?.(Math.min(index + batch.length, documents.length), documents.length)
      }
      assertKnowledgeIndexIntegrity({ chunks: rebuiltChunks })
      await this.mutate(() => {
        this.index.chunks = rebuiltChunks
        this.rebuildRequired = false
        return undefined
      })
      for (const children of childBatches) await this.indexChunks(children)
    })
    this.rebuildQueue = operation.catch(() => undefined)
    await operation
  }

  private createDocument(id: string, title: string, sourceName: string, relativePath: string): KnowledgeDocument {
    const now = new Date().toISOString()
    return { id, title, sourceName, relativePath, createdAt: now, updatedAt: now }
  }

  private createChunks(document: KnowledgeDocument, text: string): KnowledgeChunk[] {
    const { parents, children } = chunkMarkdownParentChild(document.id, text)
    const result: KnowledgeChunk[] = [
      ...parents.map((chunk) => ({
        chunkId: chunk.parentChunkId,
        parentChunkId: chunk.parentChunkId,
        documentId: document.id,
        title: document.title,
        content: chunk.content,
        headingPath: chunk.headingPath,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        kind: 'parent' as const,
      })),
      ...children.map((chunk) => ({
        chunkId: chunk.childChunkId,
        childChunkId: chunk.childChunkId,
        parentChunkId: chunk.parentChunkId,
        documentId: document.id,
        title: document.title,
        content: chunk.content,
        headingPath: chunk.headingPath,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        parentStartOffset: chunk.parentStartOffset,
        parentEndOffset: chunk.parentEndOffset,
        kind: 'child' as const,
      })),
    ]
    assertKnowledgeIndexIntegrity({ chunks: result })
    return result
  }

  private async addDocument(document: KnowledgeDocument, text: string): Promise<void> {
    const chunks = this.createChunks(document, text)
    await this.mutate(() => {
      this.index.documents.push(document)
      this.index.chunks.push(...chunks)
      assertKnowledgeIndexIntegrity(this.index)
      return undefined
    })
    await this.indexChunks(chunks.filter((chunk) => chunk.kind === 'child'))
  }

  private async indexChunks(chunks: KnowledgeChunk[]): Promise<void> {
    const children = chunks.filter((chunk) => chunk.kind === 'child')
    if (children.length === 0) return
    try {
      const vectors = await embedTexts(children.map((chunk) => `${chunk.title}\n${chunk.headingPath.join(' / ')}\n${chunk.content}`))
      await this.vectorStore.upsertMany(
        children.flatMap((chunk, index) => {
          const vector = vectors[index]
          return vector ? [{ id: chunk.chunkId, vector }] : []
        }),
      )
    } catch (error) {
      if (error instanceof EmbeddingModelError) throw error
      throw error
    }
  }

  private async ensureVectorConsistency(): Promise<void> {
    const children = this.index.chunks.filter((chunk) => chunk.kind === 'child')
    const ids = new Set(children.map((chunk) => chunk.chunkId))
    const extras = this.vectorStore.listIds().filter((id) => !ids.has(id))
    if (extras.length > 0) await this.vectorStore.deleteMany(extras)
    const missing = children.filter((chunk) => !this.vectorStore.has(chunk.chunkId))
    if (missing.length > 0) await this.indexChunks(missing)
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('KnowledgeStore 尚未初始化')
  }

  private assertIndexReady(): void {
    if (this.rebuildRequired) {
      throw new Error('知识库索引版本不兼容或关联不完整，请先重建索引')
    }
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
    return names.filter((name) => /\.(md|txt)$/i.test(name)).map((name) => path.join(demoDir, name))
  } catch {
    return []
  }
}
