import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteTextFile } from '../fsAtomic'
import type {
  AcceptedChapter,
  BookMeta,
  BookOutline,
  BookShelfItem,
  CanonFact,
  ChapterDraft,
  ChapterSummary,
  CreateBookInput,
  DivergenceNote,
  KnowledgeEntry,
  NarrativePromise,
  NovelBookSnapshot,
  NovelCharacter,
  OutlineChapterCard,
  PromiseStatus,
  RelationshipEdge,
  StateDiff,
  TimelineEvent,
} from '../../src/novel/contracts'
import { validateUUID } from '../security/pathValidator'
import { auditFileAccess } from '../security/fileAccessAudit'

const META_FILE = 'meta.json'
const OUTLINE_FILE = 'outline.json'
const RELATIONSHIPS_FILE = 'relationships.json'
const KNOWLEDGE_FILE = 'knowledge.json'
const TIMELINE_FILE = 'timeline.json'
const PROMISES_FILE = 'promises.json'
const CANON_FILE = 'canon.json'
const DIVERGENCES_FILE = 'divergences.json'
const DEFAULT_DORMANT_CHAPTERS = 3

function nowIso(): string {
  return new Date().toISOString()
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function emptyOutline(): BookOutline {
  return {
    version: 1,
    locked: false,
    volumes: [],
    updatedAt: nowIso(),
  }
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, 'utf8')
    return JSON.parse(raw) as T
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return fallback
    throw error
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  // Layer 3: 审计文件写入
  const startTime = Date.now()
  let success = false
  let errorMessage: string | undefined

  try {
    await mkdir(path.dirname(filePath), { recursive: true })
    await atomicWriteTextFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
    success = true
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    await auditFileAccess({
      operation: 'write',
      filePath: filePath.replace(/\\/g, '/'),
      toolName: 'novel_store',
      success,
      errorMessage,
      latencyMs: Date.now() - startTime,
      fileSize: success ? JSON.stringify(value).length : undefined,
    }).catch(() => {
      // 审计失败不影响主流程
    })
  }
}

function chapterFileName(chapterNumber: number): string {
  return `ch-${String(chapterNumber).padStart(3, '0')}.md`
}

function draftFileName(chapterNumber: number, revision: number): string {
  return `ch-${String(chapterNumber).padStart(3, '0')}-r${revision}.json`
}

function parseFrontMatter(markdown: string): { title: string; body: string; acceptedAt?: string } {
  if (!markdown.startsWith('---\n')) {
    return { title: '', body: markdown }
  }
  const end = markdown.indexOf('\n---\n', 4)
  if (end < 0) return { title: '', body: markdown }
  const front = markdown.slice(4, end)
  const body = markdown.slice(end + 5)
  const titleMatch = /^title:\s*(.*)$/m.exec(front)
  const acceptedMatch = /^acceptedAt:\s*(.*)$/m.exec(front)
  return {
    title: titleMatch?.[1]?.trim() ?? '',
    acceptedAt: acceptedMatch?.[1]?.trim(),
    body,
  }
}

function toAcceptedMarkdown(chapter: AcceptedChapter): string {
  return `---\ntitle: ${chapter.title}\nacceptedAt: ${chapter.acceptedAt}\n---\n\n${chapter.content.trim()}\n`
}

export class NovelStoryStore {
  private readonly root: string
  private initialized = false

  constructor(storageDirectory: string) {
    this.root = storageDirectory
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true })
    this.initialized = true
  }

  bookDir(bookId: string): string {
    return path.join(this.root, bookId)
  }

  private assertReady(): void {
    if (!this.initialized) throw new Error('NovelStoryStore 未初始化')
  }

  private assertBookId(bookId: string): string {
    // Layer 1 & 2: 使用 UUID 验证
    try {
      return validateUUID(bookId.trim())
    } catch {
      throw new Error('无效的书籍标识：必须是有效的 UUID 格式')
    }
  }

  async listBooks(): Promise<BookShelfItem[]> {
    this.assertReady()
    const entries = await readdir(this.root, { withFileTypes: true })
    const items: BookShelfItem[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        const meta = await this.getMeta(entry.name)
        items.push({
          id: meta.id,
          title: meta.title,
          genre: meta.genre,
          premise: meta.premise,
          updatedAt: meta.updatedAt,
          acceptedChapterCount: meta.acceptedChapterCount,
          lastAcceptedChapter: meta.lastAcceptedChapter,
        })
      } catch {
        // skip corrupt book folders
      }
    }
    return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async createBook(input: CreateBookInput): Promise<BookMeta> {
    this.assertReady()
    const title = input.title.trim()
    if (!title) throw new Error('书名不能为空')
    const premise = input.premise.trim()
    if (!premise) throw new Error('故事前提不能为空')

    const id = randomUUID()
    const stamp = nowIso()
    const meta: BookMeta = {
      id,
      title,
      genre: 'realistic',
      premise,
      themes: (input.themes ?? []).map((item) => item.trim()).filter(Boolean),
      era: input.era?.trim() || undefined,
      styleNotes: input.styleNotes?.trim() || undefined,
      targetChapterChars: input.targetChapterChars ?? 3000,
      createdAt: stamp,
      updatedAt: stamp,
      acceptedChapterCount: 0,
    }

    const dir = this.bookDir(id)
    await mkdir(path.join(dir, 'characters'), { recursive: true })
    await mkdir(path.join(dir, 'chapters'), { recursive: true })
    await mkdir(path.join(dir, 'drafts'), { recursive: true })
    await mkdir(path.join(dir, 'summaries'), { recursive: true })
    await mkdir(path.join(dir, 'index'), { recursive: true })

    await writeJsonFile(path.join(dir, META_FILE), meta)
    await writeJsonFile(path.join(dir, OUTLINE_FILE), emptyOutline())
    await writeJsonFile(path.join(dir, RELATIONSHIPS_FILE), [])
    await writeJsonFile(path.join(dir, KNOWLEDGE_FILE), [])
    await writeJsonFile(path.join(dir, TIMELINE_FILE), [])
    await writeJsonFile(path.join(dir, PROMISES_FILE), [])
    await writeJsonFile(path.join(dir, CANON_FILE), [])
    await writeJsonFile(path.join(dir, DIVERGENCES_FILE), [])

    for (const seed of input.seedCharacters ?? []) {
      const name = seed.name.trim()
      if (!name) continue
      await this.upsertCharacter(id, {
        id: randomUUID(),
        name,
        role: seed.role?.trim(),
        motivation: seed.motivation?.trim(),
        secret: seed.secret?.trim(),
        status: 'alive',
        updatedAt: stamp,
      })
    }

    return clone(meta)
  }

  async deleteBook(bookId: string): Promise<boolean> {
    this.assertReady()
    const id = this.assertBookId(bookId)
    const dir = this.bookDir(id)
    try {
      await rm(dir, { recursive: true, force: true })
      return true
    } catch {
      return false
    }
  }

  async getMeta(bookId: string): Promise<BookMeta> {
    this.assertReady()
    const id = this.assertBookId(bookId)
    const meta = await readJsonFile<BookMeta | null>(
      path.join(this.bookDir(id), META_FILE),
      null,
    )
    if (!meta?.id) throw new Error('书籍不存在或元信息损坏')
    return clone(meta)
  }

  async updateMeta(bookId: string, patch: Partial<BookMeta>): Promise<BookMeta> {
    const meta = await this.getMeta(bookId)
    const next: BookMeta = {
      ...meta,
      title: patch.title?.trim() || meta.title,
      premise: patch.premise?.trim() || meta.premise,
      themes: patch.themes ?? meta.themes,
      era: patch.era !== undefined ? patch.era.trim() || undefined : meta.era,
      styleNotes:
        patch.styleNotes !== undefined
          ? patch.styleNotes.trim() || undefined
          : meta.styleNotes,
      targetChapterChars: patch.targetChapterChars ?? meta.targetChapterChars,
      updatedAt: nowIso(),
    }
    await writeJsonFile(path.join(this.bookDir(meta.id), META_FILE), next)
    return clone(next)
  }

  private async touchMeta(bookId: string, extra?: Partial<BookMeta>): Promise<BookMeta> {
    const meta = await this.getMeta(bookId)
    const next = { ...meta, ...extra, updatedAt: nowIso() }
    await writeJsonFile(path.join(this.bookDir(meta.id), META_FILE), next)
    return clone(next)
  }

  async getOutline(bookId: string): Promise<BookOutline> {
    this.assertReady()
    const id = this.assertBookId(bookId)
    const outline = await readJsonFile(
      path.join(this.bookDir(id), OUTLINE_FILE),
      emptyOutline(),
    )
    return clone(outline)
  }

  async saveOutline(bookId: string, outline: BookOutline, lock?: boolean): Promise<BookOutline> {
    this.assertReady()
    const id = this.assertBookId(bookId)
    const stamp = nowIso()
    const next: BookOutline = {
      ...outline,
      version: Math.max(1, outline.version || 1),
      locked: lock ?? outline.locked,
      lockedAt: lock || outline.locked ? outline.lockedAt ?? stamp : undefined,
      updatedAt: stamp,
    }
    await writeJsonFile(path.join(this.bookDir(id), OUTLINE_FILE), next)
    await this.touchMeta(id)
    return clone(next)
  }

  async getChapterCard(
    bookId: string,
    chapterNumber: number,
  ): Promise<OutlineChapterCard | undefined> {
    const outline = await this.getOutline(bookId)
    for (const volume of outline.volumes) {
      const card = volume.chapters.find((item) => item.chapterNumber === chapterNumber)
      if (card) return clone(card)
    }
    return undefined
  }

  async listCharacters(bookId: string): Promise<NovelCharacter[]> {
    this.assertReady()
    const id = this.assertBookId(bookId)
    const dir = path.join(this.bookDir(id), 'characters')
    await mkdir(dir, { recursive: true })
    const files = await readdir(dir)
    const characters: NovelCharacter[] = []
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const item = await readJsonFile<NovelCharacter | null>(path.join(dir, file), null)
      if (item?.id) characters.push(item)
    }
    return characters.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  }

  async getCharacter(bookId: string, characterId: string): Promise<NovelCharacter | null> {
    const characters = await this.listCharacters(bookId)
    return characters.find((item) => item.id === characterId) ?? null
  }

  async upsertCharacter(bookId: string, character: NovelCharacter): Promise<NovelCharacter> {
    this.assertReady()
    const id = this.assertBookId(bookId)
    const next = { ...character, updatedAt: nowIso() }
    await writeJsonFile(
      path.join(this.bookDir(id), 'characters', `${character.id}.json`),
      next,
    )
    await this.touchMeta(id)
    return clone(next)
  }

  async deleteCharacter(bookId: string, characterId: string): Promise<boolean> {
    this.assertReady()
    const id = this.assertBookId(bookId)
    try {
      await rm(path.join(this.bookDir(id), 'characters', `${characterId}.json`), {
        force: true,
      })
      await this.touchMeta(id)
      return true
    } catch {
      return false
    }
  }

  async listRelationships(bookId: string): Promise<RelationshipEdge[]> {
    this.assertReady()
    const id = this.assertBookId(bookId)
    return clone(
      await readJsonFile<RelationshipEdge[]>(
        path.join(this.bookDir(id), RELATIONSHIPS_FILE),
        [],
      ),
    )
  }

  async saveRelationships(
    bookId: string,
    relationships: RelationshipEdge[],
  ): Promise<RelationshipEdge[]> {
    this.assertReady()
    const id = this.assertBookId(bookId)
    await writeJsonFile(path.join(this.bookDir(id), RELATIONSHIPS_FILE), relationships)
    await this.touchMeta(id)
    return clone(relationships)
  }

  async listKnowledge(bookId: string): Promise<KnowledgeEntry[]> {
    this.assertReady()
    const id = this.assertBookId(bookId)
    return clone(
      await readJsonFile<KnowledgeEntry[]>(path.join(this.bookDir(id), KNOWLEDGE_FILE), []),
    )
  }

  async saveKnowledge(bookId: string, entries: KnowledgeEntry[]): Promise<KnowledgeEntry[]> {
    this.assertReady()
    const id = this.assertBookId(bookId)
    await writeJsonFile(path.join(this.bookDir(id), KNOWLEDGE_FILE), entries)
    await this.touchMeta(id)
    return clone(entries)
  }

  async listTimeline(bookId: string): Promise<TimelineEvent[]> {
    this.assertReady()
    const id = this.assertBookId(bookId)
    return clone(
      await readJsonFile<TimelineEvent[]>(path.join(this.bookDir(id), TIMELINE_FILE), []),
    )
  }

  async saveTimeline(bookId: string, events: TimelineEvent[]): Promise<TimelineEvent[]> {
    this.assertReady()
    const id = this.assertBookId(bookId)
    await writeJsonFile(path.join(this.bookDir(id), TIMELINE_FILE), events)
    await this.touchMeta(id)
    return clone(events)
  }

  async listPromises(bookId: string): Promise<NarrativePromise[]> {
    this.assertReady()
    const id = this.assertBookId(bookId)
    return clone(
      await readJsonFile<NarrativePromise[]>(path.join(this.bookDir(id), PROMISES_FILE), []),
    )
  }

  async savePromises(bookId: string, promises: NarrativePromise[]): Promise<NarrativePromise[]> {
    this.assertReady()
    const id = this.assertBookId(bookId)
    await writeJsonFile(path.join(this.bookDir(id), PROMISES_FILE), promises)
    await this.touchMeta(id)
    return clone(promises)
  }

  async listDormantPromises(
    bookId: string,
    currentChapter: number,
    dormantAfter = DEFAULT_DORMANT_CHAPTERS,
  ): Promise<NarrativePromise[]> {
    const open: PromiseStatus[] = ['planted', 'reinforced']
    const promises = await this.listPromises(bookId)
    return promises.filter(
      (item) =>
        open.includes(item.status) &&
        currentChapter - item.lastTouchedChapter >= dormantAfter,
    )
  }

  async listOpenPromises(bookId: string): Promise<NarrativePromise[]> {
    const open: PromiseStatus[] = ['planted', 'reinforced']
    return (await this.listPromises(bookId)).filter((item) => open.includes(item.status))
  }

  async listCanon(bookId: string): Promise<CanonFact[]> {
    this.assertReady()
    const id = this.assertBookId(bookId)
    return clone(
      await readJsonFile<CanonFact[]>(path.join(this.bookDir(id), CANON_FILE), []),
    )
  }

  async saveCanon(bookId: string, facts: CanonFact[]): Promise<CanonFact[]> {
    this.assertReady()
    const id = this.assertBookId(bookId)
    await writeJsonFile(path.join(this.bookDir(id), CANON_FILE), facts)
    await this.touchMeta(id)
    return clone(facts)
  }

  async listDivergences(bookId: string): Promise<DivergenceNote[]> {
    this.assertReady()
    const id = this.assertBookId(bookId)
    return clone(
      await readJsonFile<DivergenceNote[]>(
        path.join(this.bookDir(id), DIVERGENCES_FILE),
        [],
      ),
    )
  }

  async addDivergence(
    bookId: string,
    note: Omit<DivergenceNote, 'id' | 'createdAt' | 'resolved'> & {
      id?: string
      resolved?: boolean
    },
  ): Promise<DivergenceNote> {
    const list = await this.listDivergences(bookId)
    const entry: DivergenceNote = {
      id: note.id ?? randomUUID(),
      chapterNumber: note.chapterNumber,
      summary: note.summary,
      resolved: note.resolved ?? false,
      createdAt: nowIso(),
    }
    list.push(entry)
    await writeJsonFile(path.join(this.bookDir(bookId), DIVERGENCES_FILE), list)
    await this.touchMeta(bookId)
    return clone(entry)
  }

  async resolveDivergence(bookId: string, divergenceId: string): Promise<boolean> {
    const list = await this.listDivergences(bookId)
    const target = list.find((item) => item.id === divergenceId)
    if (!target) return false
    target.resolved = true
    target.resolvedAt = nowIso()
    await writeJsonFile(path.join(this.bookDir(bookId), DIVERGENCES_FILE), list)
    await this.touchMeta(bookId)
    return true
  }

  async listDrafts(bookId: string, chapterNumber?: number): Promise<ChapterDraft[]> {
    this.assertReady()
    const id = this.assertBookId(bookId)
    const dir = path.join(this.bookDir(id), 'drafts')
    await mkdir(dir, { recursive: true })
    const files = await readdir(dir)
    const drafts: ChapterDraft[] = []
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const draft = await readJsonFile<ChapterDraft | null>(path.join(dir, file), null)
      if (!draft) continue
      if (chapterNumber !== undefined && draft.chapterNumber !== chapterNumber) continue
      drafts.push(draft)
    }
    return drafts.sort(
      (a, b) =>
        a.chapterNumber - b.chapterNumber || b.revision - a.revision,
    )
  }

  async getLatestDraft(
    bookId: string,
    chapterNumber: number,
  ): Promise<ChapterDraft | null> {
    const drafts = await this.listDrafts(bookId, chapterNumber)
    return drafts[0] ?? null
  }

  async saveDraft(bookId: string, draft: ChapterDraft): Promise<ChapterDraft> {
    this.assertReady()
    const id = this.assertBookId(bookId)
    const next = { ...draft, updatedAt: nowIso() }
    await writeJsonFile(
      path.join(this.bookDir(id), 'drafts', draftFileName(draft.chapterNumber, draft.revision)),
      next,
    )
    await this.touchMeta(id)
    return clone(next)
  }

  async nextDraftRevision(bookId: string, chapterNumber: number): Promise<number> {
    const drafts = await this.listDrafts(bookId, chapterNumber)
    if (drafts.length === 0) return 1
    return Math.max(...drafts.map((item) => item.revision)) + 1
  }

  async getAcceptedChapter(
    bookId: string,
    chapterNumber: number,
  ): Promise<AcceptedChapter | null> {
    this.assertReady()
    const id = this.assertBookId(bookId)
    const filePath = path.join(this.bookDir(id), 'chapters', chapterFileName(chapterNumber))
    try {
      const raw = await readFile(filePath, 'utf8')
      const parsed = parseFrontMatter(raw)
      return {
        chapterNumber,
        title: parsed.title || `第 ${chapterNumber} 章`,
        content: parsed.body.trim(),
        acceptedAt: parsed.acceptedAt || nowIso(),
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async listAcceptedChapterSummaries(
    bookId: string,
  ): Promise<Array<Pick<AcceptedChapter, 'chapterNumber' | 'title' | 'acceptedAt'>>> {
    this.assertReady()
    const id = this.assertBookId(bookId)
    const dir = path.join(this.bookDir(id), 'chapters')
    await mkdir(dir, { recursive: true })
    const files = await readdir(dir)
    const items: Array<Pick<AcceptedChapter, 'chapterNumber' | 'title' | 'acceptedAt'>> = []
    for (const file of files) {
      const match = /^ch-(\d+)\.md$/.exec(file)
      if (!match) continue
      const chapterNumber = Number(match[1])
      const chapter = await this.getAcceptedChapter(id, chapterNumber)
      if (chapter) {
        items.push({
          chapterNumber: chapter.chapterNumber,
          title: chapter.title,
          acceptedAt: chapter.acceptedAt,
        })
      }
    }
    return items.sort((a, b) => a.chapterNumber - b.chapterNumber)
  }

  async getChapterSummary(
    bookId: string,
    chapterNumber: number,
  ): Promise<ChapterSummary | null> {
    this.assertReady()
    const id = this.assertBookId(bookId)
    return readJsonFile<ChapterSummary | null>(
      path.join(this.bookDir(id), 'summaries', `ch-${String(chapterNumber).padStart(3, '0')}.json`),
      null,
    )
  }

  async listChapterSummaries(bookId: string): Promise<ChapterSummary[]> {
    this.assertReady()
    const id = this.assertBookId(bookId)
    const dir = path.join(this.bookDir(id), 'summaries')
    await mkdir(dir, { recursive: true })
    const files = await readdir(dir)
    const summaries: ChapterSummary[] = []
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const summary = await readJsonFile<ChapterSummary | null>(path.join(dir, file), null)
      if (summary) summaries.push(summary)
    }
    return summaries.sort((a, b) => a.chapterNumber - b.chapterNumber)
  }

  async saveChapterSummary(bookId: string, summary: ChapterSummary): Promise<ChapterSummary> {
    this.assertReady()
    const id = this.assertBookId(bookId)
    const next = { ...summary, updatedAt: nowIso() }
    await writeJsonFile(
      path.join(
        this.bookDir(id),
        'summaries',
        `ch-${String(summary.chapterNumber).padStart(3, '0')}.json`,
      ),
      next,
    )
    return clone(next)
  }

  async getEndingHook(bookId: string, beforeChapter: number): Promise<string | undefined> {
    if (beforeChapter <= 1) return undefined
    const summary = await this.getChapterSummary(bookId, beforeChapter - 1)
    return summary?.endingHook
  }

  /**
   * Accept 章节：写正文、应用 Diff、更新摘要与 meta。
   * 索引更新由调用方（NovelIndex）负责，保持 Store 与检索解耦。
   */
  async acceptChapter(input: {
    bookId: string
    chapterNumber: number
    title: string
    content: string
    diff: StateDiff
    overrideWarnings?: AcceptedChapter['overrideWarnings']
  }): Promise<{ chapter: AcceptedChapter; summary: ChapterSummary }> {
    this.assertReady()
    const bookId = this.assertBookId(input.bookId)
    const stamp = nowIso()
    const chapter: AcceptedChapter = {
      chapterNumber: input.chapterNumber,
      title: input.title.trim() || `第 ${input.chapterNumber} 章`,
      content: input.content.trim(),
      acceptedAt: stamp,
      overrideWarnings: input.overrideWarnings,
    }

    await atomicWriteTextFile(
      path.join(this.bookDir(bookId), 'chapters', chapterFileName(input.chapterNumber)),
      toAcceptedMarkdown(chapter),
    )

    await this.applyStateDiff(bookId, input.chapterNumber, input.diff)

    const summary: ChapterSummary = {
      chapterNumber: input.chapterNumber,
      title: chapter.title,
      summary:
        (typeof input.diff.chapterSummary === 'string'
          ? input.diff.chapterSummary.trim()
          : '') || chapter.content.slice(0, 400),
      endingHook:
        typeof input.diff.endingHook === 'string'
          ? input.diff.endingHook.trim() || undefined
          : undefined,
      updatedAt: stamp,
    }
    await this.saveChapterSummary(bookId, summary)

    if (input.diff.outlineDivergence?.trim()) {
      await this.addDivergence(bookId, {
        chapterNumber: input.chapterNumber,
        summary: input.diff.outlineDivergence.trim(),
      })
    }

    const accepted = await this.listAcceptedChapterSummaries(bookId)
    await this.touchMeta(bookId, {
      acceptedChapterCount: accepted.length,
      lastAcceptedChapter: input.chapterNumber,
    })

    return { chapter: clone(chapter), summary: clone(summary) }
  }

  async applyStateDiff(
    bookId: string,
    chapterNumber: number,
    diff: StateDiff,
  ): Promise<void> {
    const stamp = nowIso()
    const characters = await this.listCharacters(bookId)
    const safeDiff = {
      characters: Array.isArray(diff.characters) ? diff.characters : [],
      relationships: Array.isArray(diff.relationships) ? diff.relationships : [],
      knowledge: Array.isArray(diff.knowledge) ? diff.knowledge : [],
      timeline: Array.isArray(diff.timeline) ? diff.timeline : [],
      promises: Array.isArray(diff.promises) ? diff.promises : [],
      canonCandidates: Array.isArray(diff.canonCandidates) ? diff.canonCandidates : [],
      newVoiceSamples: Array.isArray(diff.newVoiceSamples) ? diff.newVoiceSamples : [],
      outlineDivergence:
        typeof diff.outlineDivergence === 'string' ? diff.outlineDivergence : undefined,
      chapterSummary:
        typeof diff.chapterSummary === 'string' ? diff.chapterSummary : undefined,
      endingHook: typeof diff.endingHook === 'string' ? diff.endingHook : undefined,
    }

    for (const item of safeDiff.characters) {
      let target =
        (item.characterId
          ? characters.find((c) => c.id === item.characterId)
          : undefined) ??
        (item.name ? characters.find((c) => c.name === item.name) : undefined)
      if (!target && item.name) {
        target = {
          id: randomUUID(),
          name: item.name,
          status: 'alive',
          updatedAt: stamp,
        }
        characters.push(target)
      }
      if (!target) continue
      const patch = item.patch && typeof item.patch === 'object' ? item.patch : {}
      Object.assign(target, patch, { updatedAt: stamp })
      if (Array.isArray(patch.voiceSamples)) {
        target.voiceSamples = patch.voiceSamples.filter((s) => typeof s === 'string')
      }
      await this.upsertCharacter(bookId, target)
    }

    if (safeDiff.relationships.length) {
      const relationships = await this.listRelationships(bookId)
      for (const edge of safeDiff.relationships) {
        if (!edge.fromCharacterId || !edge.toCharacterId) continue
        const existing = relationships.find(
          (item) =>
            item.fromCharacterId === edge.fromCharacterId &&
            item.toCharacterId === edge.toCharacterId,
        )
        if (existing) {
          if (edge.closeness !== undefined) existing.closeness = edge.closeness
          if (edge.tension !== undefined) existing.tension = edge.tension
          if (edge.unspoken !== undefined) existing.unspoken = edge.unspoken
          if (edge.notes !== undefined) existing.notes = edge.notes
          existing.updatedAt = stamp
        } else {
          relationships.push({
            id: randomUUID(),
            fromCharacterId: edge.fromCharacterId,
            toCharacterId: edge.toCharacterId,
            closeness: edge.closeness ?? 0,
            tension: edge.tension ?? 0,
            unspoken: edge.unspoken,
            notes: edge.notes,
            updatedAt: stamp,
          })
        }
      }
      await this.saveRelationships(bookId, relationships)
    }

    if (safeDiff.knowledge.length) {
      const knowledge = await this.listKnowledge(bookId)
      for (const entry of safeDiff.knowledge) {
        if (!entry.secretLabel) continue
        const existing = knowledge.find((item) => item.secretLabel === entry.secretLabel)
        if (existing) {
          if (entry.content !== undefined) existing.content = entry.content
          if (Array.isArray(entry.knowerCharacterIds)) {
            existing.knowerCharacterIds = entry.knowerCharacterIds
          }
          if (entry.readerKnows !== undefined) existing.readerKnows = entry.readerKnows
          existing.updatedAt = stamp
        } else {
          knowledge.push({
            id: randomUUID(),
            secretLabel: entry.secretLabel,
            content: entry.content ?? entry.secretLabel,
            knowerCharacterIds: Array.isArray(entry.knowerCharacterIds)
              ? entry.knowerCharacterIds
              : [],
            readerKnows: entry.readerKnows ?? false,
            plantedChapter: chapterNumber,
            updatedAt: stamp,
          })
        }
      }
      await this.saveKnowledge(bookId, knowledge)
    }

    if (safeDiff.timeline.length) {
      const timeline = await this.listTimeline(bookId)
      for (const event of safeDiff.timeline) {
        if (!event.label) continue
        timeline.push({
          id: randomUUID(),
          label: event.label,
          dateText: event.dateText,
          chapterNumber,
          characterIds: Array.isArray(event.characterIds) ? event.characterIds : undefined,
          notes: event.notes,
          updatedAt: stamp,
        })
      }
      await this.saveTimeline(bookId, timeline)
    }

    if (safeDiff.promises.length) {
      const promises = await this.listPromises(bookId)
      for (const item of safeDiff.promises) {
        if (!item.description) continue
        if (item.action === 'plant') {
          promises.push({
            id: item.id ?? randomUUID(),
            description: item.description,
            status: 'planted',
            plantedChapter: chapterNumber,
            lastTouchedChapter: chapterNumber,
            relatedCharacterIds: Array.isArray(item.relatedCharacterIds)
              ? item.relatedCharacterIds
              : undefined,
            notes: item.notes,
            updatedAt: stamp,
          })
          continue
        }
        const target =
          (item.id ? promises.find((p) => p.id === item.id) : undefined) ??
          promises.find((p) => p.description === item.description)
        if (!target) continue
        target.lastTouchedChapter = chapterNumber
        target.updatedAt = stamp
        if (item.notes) target.notes = item.notes
        if (item.action === 'reinforce') target.status = 'reinforced'
        if (item.action === 'pay_off') {
          target.status = 'paid_off'
          target.payoffChapter = chapterNumber
        }
        if (item.action === 'subvert') {
          target.status = 'subverted'
          target.payoffChapter = chapterNumber
        }
        if (item.action === 'abandon') target.status = 'abandoned'
      }
      await this.savePromises(bookId, promises)
    }

    if (safeDiff.canonCandidates.length) {
      const canon = await this.listCanon(bookId)
      for (const content of safeDiff.canonCandidates) {
        const trimmed = typeof content === 'string' ? content.trim() : ''
        if (!trimmed) continue
        if (canon.some((item) => item.content === trimmed)) continue
        canon.push({
          id: randomUUID(),
          content: trimmed,
          sourceChapter: chapterNumber,
          updatedAt: stamp,
        })
      }
      await this.saveCanon(bookId, canon)
    }

    if (safeDiff.newVoiceSamples.length) {
      const latestCharacters = await this.listCharacters(bookId)
      for (const sample of safeDiff.newVoiceSamples) {
        const target =
          (sample.characterId
            ? latestCharacters.find((c) => c.id === sample.characterId)
            : undefined) ??
          (sample.name ? latestCharacters.find((c) => c.name === sample.name) : undefined)
        if (!target || !sample.sample?.trim()) continue
        const previous = Array.isArray(target.voiceSamples) ? target.voiceSamples : []
        const voices = [...previous, sample.sample.trim()].slice(-5)
        await this.upsertCharacter(bookId, { ...target, voiceSamples: voices })
      }
    }
  }

  async getSnapshot(bookId: string): Promise<NovelBookSnapshot> {
    const id = this.assertBookId(bookId)
    const [
      meta,
      outline,
      characters,
      relationships,
      knowledge,
      timeline,
      promises,
      canon,
      summaries,
      divergences,
      drafts,
      acceptedChapters,
    ] = await Promise.all([
      this.getMeta(id),
      this.getOutline(id),
      this.listCharacters(id),
      this.listRelationships(id),
      this.listKnowledge(id),
      this.listTimeline(id),
      this.listPromises(id),
      this.listCanon(id),
      this.listChapterSummaries(id),
      this.listDivergences(id),
      this.listDrafts(id),
      this.listAcceptedChapterSummaries(id),
    ])
    return {
      meta,
      outline,
      characters,
      relationships,
      knowledge,
      timeline,
      promises,
      canon,
      summaries,
      divergences,
      drafts,
      acceptedChapters,
    }
  }
}
