import { randomUUID } from 'node:crypto'
import type { ProviderRuntimeConfig } from '../../src/chat/contracts'
import type {
  AcceptChapterInput,
  AssembledChapterContext,
  BookMeta,
  BookOutline,
  BookShelfItem,
  CreateBookInput,
  GuardWarning,
  NovelBookSnapshot,
  NovelExportFormat,
  NovelManuscript,
  NovelStreamEvent,
  OutlineChapterCard,
  RejectChapterInput,
  ReviseChapterInput,
} from '../../src/novel/contracts'
import { getEmbeddingModelStatus } from '../retrieval/embeddingService'
import {
  dropNovelBookIndex,
  getNovelBookIndex,
  type NovelBookIndex,
} from './novelBookIndex'
import {
  buildManuscriptFromStore,
  buildManuscriptHtmlDocument,
} from './novelManuscript'
import {
  NovelRuntime,
  assembleChapterContext,
  normalizeStateDiff,
  runContinuityGuard,
  type NovelLlm,
} from './novelRuntime'
import { NovelStoryStore } from './novelStoryStore'

export class NovelServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NovelServiceError'
  }
}

type StreamSink = {
  send: (event: NovelStreamEvent) => void
}

export class NovelService {
  private readonly runtime: NovelRuntime
  private readonly aborts = new Map<string, AbortController>()

  constructor(
    private readonly store: NovelStoryStore,
    private readonly getRuntimeConfig: () => ProviderRuntimeConfig | null,
    llm?: NovelLlm,
  ) {
    this.runtime = new NovelRuntime(store, llm)
  }

  private requireConfig(): ProviderRuntimeConfig {
    const config = this.getRuntimeConfig()
    if (!config?.apiKey) {
      throw new NovelServiceError(
        '????????? DeepSeek API Key??????????????????',
      )
    }
    return config
  }

  private async indexFor(bookId: string): Promise<NovelBookIndex> {
    return getNovelBookIndex(bookId, this.store.bookDir(bookId))
  }

  listBooks(): Promise<BookShelfItem[]> {
    return this.store.listBooks()
  }

  createBook(input: CreateBookInput): Promise<BookMeta> {
    return this.store.createBook(input)
  }

  async deleteBook(bookId: string): Promise<boolean> {
    await dropNovelBookIndex(bookId)
    return this.store.deleteBook(bookId)
  }

  getSnapshot(bookId: string): Promise<NovelBookSnapshot> {
    return this.store.getSnapshot(bookId)
  }

  getOutline(bookId: string): Promise<BookOutline> {
    return this.store.getOutline(bookId)
  }

  saveOutline(bookId: string, outline: BookOutline, lock?: boolean): Promise<BookOutline> {
    return this.store.saveOutline(bookId, outline, lock)
  }

  async generateOutline(
    bookId: string,
    guidance?: string,
  ): Promise<{ draft: BookOutline; lockedExisting: boolean }> {
    const existing = await this.store.getOutline(bookId)
    const config = this.requireConfig()
    const controller = new AbortController()
    const draft = await this.runtime.generateOutlineDraft({
      bookId,
      config,
      signal: controller.signal,
      guidance,
    })
    return { draft, lockedExisting: existing.locked }
  }

  async reviseOutlineChapter(
    bookId: string,
    chapterNumber: number,
    guidance: string,
    currentOutline?: BookOutline,
  ): Promise<OutlineChapterCard> {
    const config = this.requireConfig()
    if (!guidance.trim()) throw new NovelServiceError('???????')
    return this.runtime.reviseOutlineChapter({
      bookId,
      chapterNumber,
      guidance: guidance.trim(),
      currentOutline,
      config,
      signal: new AbortController().signal,
    })
  }

  async reviseOutline(
    bookId: string,
    guidance: string,
    currentOutline?: BookOutline,
  ): Promise<{ draft: BookOutline; lockedExisting: boolean }> {
    const existing = await this.store.getOutline(bookId)
    const base = currentOutline ?? existing
    if (!base.volumes.length) {
      throw new NovelServiceError('?????????????????')
    }
    if (!guidance.trim()) throw new NovelServiceError('???????')
    const config = this.requireConfig()
    const draft = await this.runtime.reviseOutlineDraft({
      bookId,
      currentOutline: base,
      guidance: guidance.trim(),
      config,
      signal: new AbortController().signal,
    })
    return { draft, lockedExisting: existing.locked }
  }

  async resolveDivergenceAndRewriteOutline(
    bookId: string,
    divergenceId: string,
    chapterNumber: number,
    newBeatSummary: string,
  ): Promise<BookOutline> {
    const outline = await this.store.getOutline(bookId)
    for (const volume of outline.volumes) {
      const card = volume.chapters.find((item) => item.chapterNumber === chapterNumber)
      if (card) {
        card.beatSummary = newBeatSummary.trim() || card.beatSummary
      }
    }
    await this.store.resolveDivergence(bookId, divergenceId)
    return this.store.saveOutline(bookId, outline, outline.locked)
  }

  getEmbeddingStatus() {
    return getEmbeddingModelStatus()
  }

  async assemble(
    bookId: string,
    chapterNumber: number,
  ): Promise<AssembledChapterContext> {
    const meta = await this.store.getMeta(bookId)
    const chapterCard = await this.store.getChapterCard(bookId, chapterNumber)
    const characters = await this.store.listCharacters(bookId)
    const openPromises = await this.store.listOpenPromises(bookId)
    const endingHook = await this.store.getEndingHook(bookId, chapterNumber)
    const canon = await this.store.listCanon(bookId)
    const query = [
      chapterCard?.title,
      chapterCard?.beatSummary,
      chapterCard?.conflict,
      openPromises
        .slice(0, 5)
        .map((item) => item.description)
        .join(' '),
    ]
      .filter(Boolean)
      .join('\n')

    const index = await this.indexFor(bookId)
    const search = await index.search(query || meta.premise, {
      topK: 6,
      allowSparseDegrade: true,
    })

    return assembleChapterContext({
      meta,
      chapterNumber,
      chapterCard,
      characters,
      openPromises,
      endingHook,
      canonTexts: canon.map((item) => item.content),
      retrievalHits: search.hits,
      degraded: search.degraded,
      degradeReason: search.degradeReason,
    })
  }

  async writeChapter(
    bookId: string,
    chapterNumber: number,
    sink: StreamSink,
    feedback?: string,
  ): Promise<{ requestId: string }> {
    const config = this.requireConfig()
    const requestId = randomUUID()
    const controller = new AbortController()
    this.aborts.set(requestId, controller)

    void (async () => {
      try {
        const assembled = await this.assemble(bookId, chapterNumber)
        const content = await this.runtime.draftChapter({
          bookId,
          chapterNumber,
          assembled,
          config,
          signal: controller.signal,
          feedback,
          onToken: (chunk) => {
            sink.send({
              type: 'chunk',
              requestId,
              bookId,
              chapterNumber,
              chunk,
            })
          },
        })

        const revision = await this.store.nextDraftRevision(bookId, chapterNumber)
        const card = assembled.chapterCard
        const draft = await this.store.saveDraft(bookId, {
          chapterNumber,
          revision,
          title: card?.title || `? ${chapterNumber} ?`,
          content,
          feedback,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })

        sink.send({
          type: 'draft_complete',
          requestId,
          bookId,
          chapterNumber,
          draft,
          assembled,
        })

        const diff = await this.runtime.extractStateDiff({
          bookId,
          chapterNumber,
          draft: content,
          config,
          signal: controller.signal,
        })
        const characters = await this.store.listCharacters(bookId)
        const knowledge = await this.store.listKnowledge(bookId)
        const openPromises = await this.store.listOpenPromises(bookId)
        const warnings = runContinuityGuard({
          draft: content,
          characters,
          knowledge,
          openPromises,
          outlineDivergence: diff.outlineDivergence,
        })

        sink.send({
          type: 'diff_ready',
          requestId,
          bookId,
          chapterNumber,
          diff,
          warnings,
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : '??????????'
        sink.send({ type: 'error', requestId, bookId, message })
      } finally {
        this.aborts.delete(requestId)
      }
    })()

    return { requestId }
  }

  cancel(requestId: string): boolean {
    const controller = this.aborts.get(requestId)
    if (!controller) return false
    controller.abort()
    this.aborts.delete(requestId)
    return true
  }

  async acceptChapter(input: AcceptChapterInput): Promise<{
    ok: true
    warnings: GuardWarning[]
    embeddingOk: boolean
  }> {
    const draft =
      (await this.store.listDrafts(input.bookId, input.chapterNumber)).find(
        (item) => item.revision === input.revision,
      ) ?? null
    if (!draft && !input.content?.trim()) {
      throw new NovelServiceError('???????')
    }

    const content = (input.content ?? draft?.content ?? '').trim()
    const title = (input.title ?? draft?.title ?? `? ${input.chapterNumber} ?`).trim()
    if (!content) throw new NovelServiceError('??????')

    const normalizedDiff = normalizeStateDiff(input.diff)

    const characters = await this.store.listCharacters(input.bookId)
    const knowledge = await this.store.listKnowledge(input.bookId)
    const openPromises = await this.store.listOpenPromises(input.bookId)
    const warnings =
      input.warnings ??
      runContinuityGuard({
        draft: content,
        characters,
        knowledge,
        openPromises,
        outlineDivergence: normalizedDiff.outlineDivergence,
      })

    const blocking = warnings.filter((item) => item.severity === 'error')
    if (blocking.length > 0 && !input.forceAccept) {
      throw new NovelServiceError(
        `???????????????? Accept?${blocking.map((w) => w.message).join('?')}`,
      )
    }

    await this.store.acceptChapter({
      bookId: input.bookId,
      chapterNumber: input.chapterNumber,
      title,
      content,
      diff: normalizedDiff,
      overrideWarnings: input.forceAccept ? warnings : undefined,
    })

    const summary = await this.store.getChapterSummary(
      input.bookId,
      input.chapterNumber,
    )
    const index = await this.indexFor(input.bookId)
    const indexed = await index.indexAcceptedChapter({
      chapterNumber: input.chapterNumber,
      title,
      content,
      summary: summary ?? undefined,
    })

    return { ok: true, warnings, embeddingOk: indexed.embeddingOk }
  }

  async rejectChapter(input: RejectChapterInput): Promise<{ ok: true }> {
    const draft = await this.store.getLatestDraft(input.bookId, input.chapterNumber)
    if (!draft || draft.revision !== input.revision) {
      throw new NovelServiceError('????????')
    }
    return { ok: true }
  }

  async reviseChapter(
    input: ReviseChapterInput,
    sink: StreamSink,
  ): Promise<{ requestId: string }> {
    return this.writeChapter(
      input.bookId,
      input.chapterNumber,
      sink,
      input.feedback,
    )
  }

  async rebuildIndex(bookId: string): Promise<{ chapters: number; embeddingOk: boolean }> {
    const index = await this.indexFor(bookId)
    return index.rebuildFromStore(this.store)
  }

  async getManuscript(bookId: string): Promise<NovelManuscript> {
    return buildManuscriptFromStore(this.store, bookId)
  }

  async getManuscriptHtml(
    bookId: string,
  ): Promise<{ html: string; manuscript: NovelManuscript }> {
    const manuscript = await this.getManuscript(bookId)
    return { html: buildManuscriptHtmlDocument(manuscript), manuscript }
  }

  suggestExportFileName(title: string, format: NovelExportFormat): string {
    const safe = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'novel'
    if (format === 'markdown') return `${safe}.md`
    if (format === 'html') return `${safe}.html`
    return `${safe}.pdf`
  }

  getNovelsRootHint(): string {
    return this.store.bookDir('__probe__').replace(/[/\\]__probe__$/, '')
  }
}
