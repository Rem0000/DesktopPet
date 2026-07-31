/** 小说工坊契约：与聊天 MemoryStore 完全隔离 */

export type NovelGenre = 'realistic'

export type PromiseStatus =
  | 'planted'
  | 'reinforced'
  | 'paid_off'
  | 'subverted'
  | 'abandoned'

export type GuardWarningCode =
  | 'timeline_conflict'
  | 'knowledge_leak'
  | 'dead_character'
  | 'early_payoff'
  | 'outline_divergence'
  | 'other'

export type BookMeta = {
  id: string
  title: string
  genre: NovelGenre
  premise: string
  themes: string[]
  era?: string
  styleNotes?: string
  targetChapterChars?: number
  createdAt: string
  updatedAt: string
  /** 已接受章数 */
  acceptedChapterCount: number
  /** 最近 Accept 的章节号，从 1 起 */
  lastAcceptedChapter?: number
}

export type BookShelfItem = Pick<
  BookMeta,
  'id' | 'title' | 'genre' | 'updatedAt' | 'acceptedChapterCount' | 'lastAcceptedChapter' | 'premise'
>

export type CreateBookInput = {
  title: string
  premise: string
  themes?: string[]
  era?: string
  styleNotes?: string
  targetChapterChars?: number
  seedCharacters?: Array<{
    name: string
    role?: string
    motivation?: string
    secret?: string
  }>
}

export type OutlineChapterCard = {
  id: string
  chapterNumber: number
  title: string
  beatSummary: string
  povCharacterId?: string
  targetEmotion?: string
  conflict?: string
}

export type OutlineVolume = {
  id: string
  title: string
  order: number
  chapters: OutlineChapterCard[]
}

export type BookOutline = {
  version: number
  locked: boolean
  lockedAt?: string
  volumes: OutlineVolume[]
  updatedAt: string
}

export type NovelCharacter = {
  id: string
  name: string
  role?: string
  motivation?: string
  secret?: string
  trauma?: string
  emotionBaseline?: string
  status?: 'alive' | 'dead' | 'missing' | 'unknown'
  voiceSamples?: string[]
  notes?: string
  updatedAt: string
}

export type RelationshipEdge = {
  id: string
  fromCharacterId: string
  toCharacterId: string
  closeness: number
  tension: number
  unspoken?: string
  notes?: string
  updatedAt: string
}

export type KnowledgeEntry = {
  id: string
  secretLabel: string
  content: string
  knowerCharacterIds: string[]
  readerKnows: boolean
  plantedChapter?: number
  updatedAt: string
}

export type TimelineEvent = {
  id: string
  label: string
  dateText?: string
  chapterNumber?: number
  characterIds?: string[]
  notes?: string
  updatedAt: string
}

export type NarrativePromise = {
  id: string
  description: string
  status: PromiseStatus
  plantedChapter: number
  lastTouchedChapter: number
  relatedCharacterIds?: string[]
  payoffChapter?: number
  notes?: string
  updatedAt: string
}

export type CanonFact = {
  id: string
  content: string
  sourceChapter?: number
  pinned?: boolean
  updatedAt: string
}

export type ChapterSummary = {
  chapterNumber: number
  title: string
  summary: string
  endingHook?: string
  updatedAt: string
}

export type ChapterDraft = {
  chapterNumber: number
  revision: number
  title: string
  content: string
  feedback?: string
  createdAt: string
  updatedAt: string
}

export type AcceptedChapter = {
  chapterNumber: number
  title: string
  content: string
  acceptedAt: string
  overrideWarnings?: GuardWarning[]
}

export type DivergenceNote = {
  id: string
  chapterNumber: number
  summary: string
  resolved: boolean
  createdAt: string
  resolvedAt?: string
}

export type GuardWarning = {
  code: GuardWarningCode
  message: string
  severity: 'info' | 'warn' | 'error'
  relatedIds?: string[]
}

export type CharacterDiff = {
  characterId?: string
  name?: string
  patch: Partial<
    Pick<
      NovelCharacter,
      | 'role'
      | 'motivation'
      | 'secret'
      | 'trauma'
      | 'emotionBaseline'
      | 'status'
      | 'notes'
      | 'voiceSamples'
    >
  >
}

export type RelationshipDiff = {
  fromCharacterId: string
  toCharacterId: string
  closeness?: number
  tension?: number
  unspoken?: string
  notes?: string
}

export type KnowledgeDiff = {
  secretLabel: string
  content?: string
  knowerCharacterIds?: string[]
  readerKnows?: boolean
}

export type PromiseDiff = {
  id?: string
  description: string
  action: 'plant' | 'reinforce' | 'pay_off' | 'subvert' | 'abandon'
  relatedCharacterIds?: string[]
  notes?: string
}

export type StateDiff = {
  characters?: CharacterDiff[]
  relationships?: RelationshipDiff[]
  knowledge?: KnowledgeDiff[]
  timeline?: Array<{
    label: string
    dateText?: string
    notes?: string
    characterIds?: string[]
  }>
  promises?: PromiseDiff[]
  canonCandidates?: string[]
  outlineDivergence?: string
  chapterSummary?: string
  endingHook?: string
  newVoiceSamples?: Array<{ characterId?: string; name?: string; sample: string }>
}

export type AssembledChapterContext = {
  fixedBlock: string
  retrievalBlock: string
  degraded: boolean
  degradeReason?: string
  openPromises: NarrativePromise[]
  chapterCard?: OutlineChapterCard
}

export type NovelStreamEvent =
  | {
      type: 'chunk'
      requestId: string
      bookId: string
      chapterNumber: number
      chunk: string
    }
  | {
      type: 'draft_complete'
      requestId: string
      bookId: string
      chapterNumber: number
      draft: ChapterDraft
      assembled: AssembledChapterContext
    }
  | {
      type: 'diff_ready'
      requestId: string
      bookId: string
      chapterNumber: number
      diff: StateDiff
      warnings: GuardWarning[]
    }
  | {
      type: 'error'
      requestId: string
      bookId: string
      message: string
    }

export type AcceptChapterInput = {
  bookId: string
  chapterNumber: number
  revision: number
  title?: string
  content?: string
  diff: StateDiff
  forceAccept?: boolean
  warnings?: GuardWarning[]
}

export type RejectChapterInput = {
  bookId: string
  chapterNumber: number
  revision: number
}

export type ReviseChapterInput = {
  bookId: string
  chapterNumber: number
  feedback: string
  baseRevision?: number
}

export type NovelBookSnapshot = {
  meta: BookMeta
  outline: BookOutline
  characters: NovelCharacter[]
  relationships: RelationshipEdge[]
  knowledge: KnowledgeEntry[]
  timeline: TimelineEvent[]
  promises: NarrativePromise[]
  canon: CanonFact[]
  summaries: ChapterSummary[]
  divergences: DivergenceNote[]
  drafts: ChapterDraft[]
  acceptedChapters: Array<Pick<AcceptedChapter, 'chapterNumber' | 'title' | 'acceptedAt'>>
}

/** 已接受章节拼成的全书稿（按需生成，不另存双份正文） */
export type NovelManuscriptChapter = {
  chapterNumber: number
  title: string
  content: string
  acceptedAt: string
}

export type NovelManuscript = {
  bookId: string
  title: string
  premise: string
  chapterCount: number
  wordCount: number
  chapters: NovelManuscriptChapter[]
  markdown: string
  generatedAt: string
}

export type NovelExportFormat = 'markdown' | 'pdf' | 'html'

export type NovelExportResult =
  | { ok: true; format: NovelExportFormat; filePath: string }
  | { ok: false; canceled: true }
  | { ok: false; canceled?: false; error: string }
