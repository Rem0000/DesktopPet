import { mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteTextFile } from '../fsAtomic'
import { embedQuery, embedTexts, getEmbeddingModelStatus } from '../retrieval/embeddingService'
import { hybridSearch } from '../retrieval/hybridSearch'
import { chunkMarkdown } from '../retrieval/markdownChunker'
import { EmbeddingModelError } from '../retrieval/types'
import { VectorStore } from '../retrieval/vectorStore'
import type { ChapterSummary } from '../../src/novel/contracts'
import type { NovelStoryStore } from './novelStoryStore'

export type NovelIndexChunk = {
  chunkId: string
  bookId: string
  chapterNumber?: number
  kind: 'chapter' | 'summary'
  title: string
  content: string
  headingPath: string[]
}

export type NovelSearchHit = {
  chunkId: string
  chapterNumber?: number
  kind: 'chapter' | 'summary'
  title: string
  content: string
  score: number
  recallSource?: 'sparse' | 'vector' | 'both'
}

type NovelIndexFile = {
  version: 1
  bookId: string
  chunks: NovelIndexChunk[]
}

export type NovelSearchOptions = {
  topK?: number
  /** 允许在 Embedding 不可用时仅用稀疏检索 */
  allowSparseDegrade?: boolean
}

export type NovelSearchResult = {
  hits: NovelSearchHit[]
  degraded: boolean
  degradeReason?: string
}

function emptyIndex(bookId: string): NovelIndexFile {
  return { version: 1, bookId, chunks: [] }
}

/**
 * 书内检索索引：落在 novels/<bookId>/index/，不写 knowledge/memory。
 */
export class NovelBookIndex {
  private readonly bookId: string
  private readonly indexDir: string
  private readonly indexPath: string
  private readonly vectorStore: VectorStore
  private index = emptyIndex('')

  constructor(bookId: string, bookDir: string) {
    this.bookId = bookId
    this.indexDir = path.join(bookDir, 'index')
    this.indexPath = path.join(this.indexDir, 'chunks.json')
    this.vectorStore = new VectorStore(path.join(this.indexDir, 'vectors.json'))
    this.index = emptyIndex(bookId)
  }

  async initialize(): Promise<void> {
    await mkdir(this.indexDir, { recursive: true })
    await this.vectorStore.initialize()
    try {
      const raw = await readFile(this.indexPath, 'utf8')
      const parsed = JSON.parse(raw) as NovelIndexFile
      if (parsed?.version === 1 && Array.isArray(parsed.chunks)) {
        this.index = parsed
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.index = emptyIndex(this.bookId)
      }
    }
  }

  getIndexDir(): string {
    return this.indexDir
  }

  private async persist(): Promise<void> {
    await atomicWriteTextFile(this.indexPath, `${JSON.stringify(this.index, null, 2)}\n`)
  }

  async clear(): Promise<void> {
    this.index = emptyIndex(this.bookId)
    await this.vectorStore.clear()
    await this.persist()
  }

  async removeAllFiles(): Promise<void> {
    await rm(this.indexDir, { recursive: true, force: true })
  }

  private removeChapterChunks(chapterNumber: number): string[] {
    const removed: string[] = []
    this.index.chunks = this.index.chunks.filter((chunk) => {
      if (chunk.chapterNumber === chapterNumber) {
        removed.push(chunk.chunkId)
        return false
      }
      return true
    })
    return removed
  }

  async indexAcceptedChapter(input: {
    chapterNumber: number
    title: string
    content: string
    summary?: ChapterSummary
  }): Promise<{ chunkCount: number; embeddingOk: boolean }> {
    const removed = this.removeChapterChunks(input.chapterNumber)
    if (removed.length) await this.vectorStore.deleteMany(removed)

    const markdown = `# ${input.title}\n\n${input.content}`
    const parts = chunkMarkdown(`ch${input.chapterNumber}`, markdown)
    const newChunks: NovelIndexChunk[] = parts.map((part) => ({
      chunkId: part.chunkId,
      bookId: this.bookId,
      chapterNumber: input.chapterNumber,
      kind: 'chapter' as const,
      title: input.title,
      content: part.content,
      headingPath: part.headingPath,
    }))

    if (input.summary?.summary) {
      newChunks.push({
        chunkId: `summary-ch${String(input.chapterNumber).padStart(3, '0')}`,
        bookId: this.bookId,
        chapterNumber: input.chapterNumber,
        kind: 'summary',
        title: `${input.title}·摘要`,
        content: [
          input.summary.summary,
          input.summary.endingHook ? `钩子：${input.summary.endingHook}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        headingPath: ['摘要'],
      })
    }

    this.index.chunks.push(...newChunks)
    await this.persist()

    const status = getEmbeddingModelStatus()
    if (status.state !== 'ready') {
      return { chunkCount: newChunks.length, embeddingOk: false }
    }

    try {
      const vectors = await embedTexts(newChunks.map((chunk) => chunk.content))
      await this.vectorStore.upsertMany(
        newChunks.map((chunk, index) => ({
          id: chunk.chunkId,
          vector: vectors[index]!,
        })),
      )
      return { chunkCount: newChunks.length, embeddingOk: true }
    } catch (error) {
      if (error instanceof EmbeddingModelError) {
        return { chunkCount: newChunks.length, embeddingOk: false }
      }
      throw error
    }
  }

  async rebuildFromStore(storyStore: NovelStoryStore): Promise<{
    chapters: number
    embeddingOk: boolean
  }> {
    await this.clear()
    const accepted = await storyStore.listAcceptedChapterSummaries(this.bookId)
    let embeddingOk = true
    for (const item of accepted) {
      const chapter = await storyStore.getAcceptedChapter(this.bookId, item.chapterNumber)
      if (!chapter) continue
      const summary = await storyStore.getChapterSummary(this.bookId, item.chapterNumber)
      const result = await this.indexAcceptedChapter({
        chapterNumber: chapter.chapterNumber,
        title: chapter.title,
        content: chapter.content,
        summary: summary ?? undefined,
      })
      if (!result.embeddingOk) embeddingOk = false
    }
    return { chapters: accepted.length, embeddingOk }
  }

  async search(query: string, options: NovelSearchOptions = {}): Promise<NovelSearchResult> {
    const topK = options.topK ?? 6
    const allowSparseDegrade = options.allowSparseDegrade ?? true
    if (!query.trim() || this.index.chunks.length === 0) {
      return { hits: [], degraded: false }
    }

    const status = getEmbeddingModelStatus()
    const embeddingReady = status.state === 'ready'

    if (!embeddingReady) {
      if (!allowSparseDegrade) {
        return {
          hits: [],
          degraded: true,
          degradeReason:
            status.state === 'error'
              ? status.message
              : 'Embedding 模型未就绪，无法完成书内 Hybrid 检索',
        }
      }
      const hits = await hybridSearch(
        query,
        this.index.chunks.map((chunk) => ({
          id: chunk.chunkId,
          text: `${chunk.title}\n${chunk.content}`,
          metadata: { chunk },
        })),
        {
          topK,
          embedQuery: async () => [],
          getVector: () => undefined,
        },
      )
      return {
        hits: hits.map((hit) => {
          const chunk = hit.metadata?.chunk as NovelIndexChunk
          return {
            chunkId: hit.id,
            chapterNumber: chunk?.chapterNumber,
            kind: chunk?.kind ?? 'chapter',
            title: chunk?.title ?? '',
            content: chunk?.content ?? hit.text,
            score: hit.score,
            recallSource: hit.recallSource,
          }
        }),
        degraded: true,
        degradeReason: 'Embedding 不可用，已降级为稀疏检索；连续性风险较高',
      }
    }

    const hits = await hybridSearch(
      query,
      this.index.chunks.map((chunk) => ({
        id: chunk.chunkId,
        text: `${chunk.title}\n${chunk.content}`,
        metadata: { chunk },
      })),
      {
        topK,
        embedQuery,
        getVector: (id) => this.vectorStore.get(id),
      },
    )

    return {
      hits: hits.map((hit) => {
        const chunk = hit.metadata?.chunk as NovelIndexChunk
        return {
          chunkId: hit.id,
          chapterNumber: chunk?.chapterNumber,
          kind: chunk?.kind ?? 'chapter',
          title: chunk?.title ?? '',
          content: chunk?.content ?? hit.text,
          score: hit.score,
          recallSource: hit.recallSource,
        }
      }),
      degraded: false,
    }
  }
}

const indexCache = new Map<string, NovelBookIndex>()

export async function getNovelBookIndex(
  bookId: string,
  bookDir: string,
): Promise<NovelBookIndex> {
  const cached = indexCache.get(bookId)
  if (cached) return cached
  const index = new NovelBookIndex(bookId, bookDir)
  await index.initialize()
  indexCache.set(bookId, index)
  return index
}

export async function dropNovelBookIndex(bookId: string): Promise<void> {
  const cached = indexCache.get(bookId)
  if (cached) {
    await cached.removeAllFiles()
    indexCache.delete(bookId)
  }
}

export function novelIndexCacheSize(): number {
  return indexCache.size
}

/** 测试辅助：清空缓存 */
export function clearNovelIndexCache(): void {
  indexCache.clear()
}
