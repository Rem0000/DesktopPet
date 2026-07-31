import { randomUUID } from 'node:crypto'
import {
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import type { ProviderRuntimeConfig } from '../../src/chat/contracts'
import type {
  AssembledChapterContext,
  BookMeta,
  BookOutline,
  GuardWarning,
  NarrativePromise,
  NovelCharacter,
  OutlineChapterCard,
  OutlineVolume,
  StateDiff,
} from '../../src/novel/contracts'
import type { NovelSearchHit } from './novelBookIndex'
import type { NovelStoryStore } from './novelStoryStore'

const FIXED_BUDGET = 6_000
const RETRIEVAL_BUDGET = 8_000
const OPEN_PROMISE_TOP_N = 8

export type NovelLlm = {
  streamText: (
    systemPrompt: string,
    userPrompt: string,
    config: ProviderRuntimeConfig,
    signal: AbortSignal,
    onToken: (token: string) => void,
  ) => Promise<string>
  completeText: (
    systemPrompt: string,
    userPrompt: string,
    config: ProviderRuntimeConfig,
    signal: AbortSignal,
  ) => Promise<string>
}

export class DeepSeekNovelLlm implements NovelLlm {
  async streamText(
    systemPrompt: string,
    userPrompt: string,
    config: ProviderRuntimeConfig,
    signal: AbortSignal,
    onToken: (token: string) => void,
  ): Promise<string> {
    const model = new ChatOpenAI({
      apiKey: config.apiKey,
      model: config.model,
      streaming: true,
      timeout: 120_000,
      maxRetries: 1,
      configuration: { baseURL: config.baseUrl },
    })
    let reply = ''
    const stream = await model.stream(
      [new SystemMessage(systemPrompt), new HumanMessage(userPrompt)],
      { signal },
    )
    for await (const chunk of stream) {
      const token =
        typeof chunk.content === 'string'
          ? chunk.content
          : Array.isArray(chunk.content)
            ? chunk.content
                .map((part) =>
                  typeof part === 'string'
                    ? part
                    : part && typeof part === 'object' && 'text' in part
                      ? String(part.text ?? '')
                      : '',
                )
                .join('')
            : ''
      if (!token) continue
      reply += token
      onToken(token)
    }
    return reply.trim()
  }

  async completeText(
    systemPrompt: string,
    userPrompt: string,
    config: ProviderRuntimeConfig,
    signal: AbortSignal,
  ): Promise<string> {
    const model = new ChatOpenAI({
      apiKey: config.apiKey,
      model: config.model,
      streaming: false,
      timeout: 120_000,
      maxRetries: 1,
      configuration: { baseURL: config.baseUrl },
    })
    const result = await model.invoke(
      [new SystemMessage(systemPrompt), new HumanMessage(userPrompt)],
      { signal },
    )
    if (typeof result.content === 'string') return result.content.trim()
    if (Array.isArray(result.content)) {
      return result.content
        .map((part) =>
          typeof part === 'string'
            ? part
            : part && typeof part === 'object' && 'text' in part
              ? String(part.text ?? '')
              : '',
        )
        .join('')
        .trim()
    }
    return ''
  }
}

function clip(text: string, budget: number): string {
  if (text.length <= budget) return text
  return `${text.slice(0, Math.max(0, budget - 12))}…(已裁剪)`
}

function extractJsonObject(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const candidate = fenced?.[1]?.trim() || text.trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型未返回 JSON 对象')
  return JSON.parse(candidate.slice(start, end + 1))
}

function normalizeOutline(raw: unknown): BookOutline {
  const value = (raw && typeof raw === 'object' ? raw : {}) as {
    volumes?: unknown
  }
  const volumesIn = Array.isArray(value.volumes) ? value.volumes : []
  const volumes: OutlineVolume[] = volumesIn.map((volume, volumeIndex) => {
    const item = (volume && typeof volume === 'object' ? volume : {}) as Record<
      string,
      unknown
    >
    const chaptersIn = Array.isArray(item.chapters) ? item.chapters : []
    const chapters: OutlineChapterCard[] = chaptersIn.map((chapter, chapterIndex) => {
      const card = (chapter && typeof chapter === 'object' ? chapter : {}) as Record<
        string,
        unknown
      >
      return {
        id: typeof card.id === 'string' ? card.id : randomUUID(),
        chapterNumber:
          typeof card.chapterNumber === 'number'
            ? card.chapterNumber
            : chapterIndex + 1,
        title: typeof card.title === 'string' ? card.title : `第 ${chapterIndex + 1} 章`,
        beatSummary:
          typeof card.beatSummary === 'string' ? card.beatSummary : '',
        povCharacterId:
          typeof card.povCharacterId === 'string' ? card.povCharacterId : undefined,
        targetEmotion:
          typeof card.targetEmotion === 'string' ? card.targetEmotion : undefined,
        conflict: typeof card.conflict === 'string' ? card.conflict : undefined,
      }
    })
    return {
      id: typeof item.id === 'string' ? item.id : randomUUID(),
      title: typeof item.title === 'string' ? item.title : `第 ${volumeIndex + 1} 卷`,
      order: typeof item.order === 'number' ? item.order : volumeIndex + 1,
      chapters,
    }
  })
  return {
    version: 1,
    locked: false,
    volumes,
    updatedAt: new Date().toISOString(),
  }
}

function emptyDiff(): StateDiff {
  return {}
}

/** 将 LLM 可能返回的「伪数组对象」规范成真正的数组 */
export function asArray<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (value == null) return []
  if (typeof value === 'object') {
    return Object.values(value as Record<string, T>)
  }
  return []
}

function asStringArray(value: unknown): string[] {
  return asArray(value)
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object' && 'content' in item) {
        return String((item as { content?: unknown }).content ?? '')
      }
      return String(item ?? '')
    })
    .map((item) => item.trim())
    .filter(Boolean)
}

/** 规范化 StateDiff，避免 Accept 时 for...of 撞上非数组对象 */
export function normalizeStateDiff(raw: unknown): StateDiff {
  if (!raw || typeof raw !== 'object') return emptyDiff()
  const value = raw as Record<string, unknown>
  const diff: StateDiff = {}

  const characters = asArray(value.characters)
  if (characters.length) {
    diff.characters = characters.map((item) => {
      const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
      const patchRaw =
        row.patch && typeof row.patch === 'object'
          ? (row.patch as Record<string, unknown>)
          : row
      return {
        characterId: typeof row.characterId === 'string' ? row.characterId : undefined,
        name: typeof row.name === 'string' ? row.name : undefined,
        patch: {
          role: typeof patchRaw.role === 'string' ? patchRaw.role : undefined,
          motivation:
            typeof patchRaw.motivation === 'string' ? patchRaw.motivation : undefined,
          secret: typeof patchRaw.secret === 'string' ? patchRaw.secret : undefined,
          trauma: typeof patchRaw.trauma === 'string' ? patchRaw.trauma : undefined,
          emotionBaseline:
            typeof patchRaw.emotionBaseline === 'string'
              ? patchRaw.emotionBaseline
              : undefined,
          status:
            patchRaw.status === 'alive' ||
            patchRaw.status === 'dead' ||
            patchRaw.status === 'missing' ||
            patchRaw.status === 'unknown'
              ? patchRaw.status
              : undefined,
          notes: typeof patchRaw.notes === 'string' ? patchRaw.notes : undefined,
          voiceSamples: asStringArray(patchRaw.voiceSamples),
        },
      }
    })
  }

  const relationships = asArray(value.relationships)
  if (relationships.length) {
    diff.relationships = relationships
      .map((item) => {
        const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
        return {
          fromCharacterId: String(row.fromCharacterId ?? ''),
          toCharacterId: String(row.toCharacterId ?? ''),
          closeness: typeof row.closeness === 'number' ? row.closeness : undefined,
          tension: typeof row.tension === 'number' ? row.tension : undefined,
          unspoken: typeof row.unspoken === 'string' ? row.unspoken : undefined,
          notes: typeof row.notes === 'string' ? row.notes : undefined,
        }
      })
      .filter((item) => item.fromCharacterId && item.toCharacterId)
  }

  const knowledge = asArray(value.knowledge)
  if (knowledge.length) {
    diff.knowledge = knowledge
      .map((item) => {
        const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
        return {
          secretLabel: String(row.secretLabel ?? row.label ?? ''),
          content: typeof row.content === 'string' ? row.content : undefined,
          knowerCharacterIds: asStringArray(row.knowerCharacterIds),
          readerKnows: typeof row.readerKnows === 'boolean' ? row.readerKnows : undefined,
        }
      })
      .filter((item) => item.secretLabel)
  }

  const timeline = asArray(value.timeline)
  if (timeline.length) {
    diff.timeline = timeline
      .map((item) => {
        const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
        return {
          label: String(row.label ?? ''),
          dateText: typeof row.dateText === 'string' ? row.dateText : undefined,
          notes: typeof row.notes === 'string' ? row.notes : undefined,
          characterIds: asStringArray(row.characterIds),
        }
      })
      .filter((item) => item.label)
  }

  const promises = asArray(value.promises)
  if (promises.length) {
    diff.promises = promises
      .map((item) => {
        const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
        const actionRaw = String(row.action ?? 'plant')
        const action: 'plant' | 'reinforce' | 'pay_off' | 'subvert' | 'abandon' =
          actionRaw === 'reinforce' ||
          actionRaw === 'pay_off' ||
          actionRaw === 'subvert' ||
          actionRaw === 'abandon'
            ? actionRaw
            : 'plant'
        return {
          id: typeof row.id === 'string' ? row.id : undefined,
          description: String(row.description ?? ''),
          action,
          relatedCharacterIds: asStringArray(row.relatedCharacterIds),
          notes: typeof row.notes === 'string' ? row.notes : undefined,
        }
      })
      .filter((item) => item.description)
  }

  const canonCandidates = asStringArray(value.canonCandidates)
  if (canonCandidates.length) diff.canonCandidates = canonCandidates

  if (typeof value.outlineDivergence === 'string') {
    diff.outlineDivergence = value.outlineDivergence
  }
  if (typeof value.chapterSummary === 'string') {
    diff.chapterSummary = value.chapterSummary
  } else if (value.chapterSummary && typeof value.chapterSummary === 'object') {
    const summaryObj = value.chapterSummary as Record<string, unknown>
    diff.chapterSummary = String(summaryObj.summary ?? summaryObj.text ?? '')
  }
  if (typeof value.endingHook === 'string') {
    diff.endingHook = value.endingHook
  }

  const voiceSamples = asArray(value.newVoiceSamples)
  if (voiceSamples.length) {
    diff.newVoiceSamples = voiceSamples
      .map((item) => {
        const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
        return {
          characterId: typeof row.characterId === 'string' ? row.characterId : undefined,
          name: typeof row.name === 'string' ? row.name : undefined,
          sample: String(row.sample ?? ''),
        }
      })
      .filter((item) => item.sample.trim())
  }

  return diff
}

/** @deprecated 使用 normalizeStateDiff */
function normalizeDiff(raw: unknown): StateDiff {
  return normalizeStateDiff(raw)
}

export function assembleChapterContext(input: {
  meta: BookMeta
  chapterNumber: number
  chapterCard?: OutlineChapterCard
  characters: NovelCharacter[]
  openPromises: NarrativePromise[]
  endingHook?: string
  canonTexts: string[]
  retrievalHits: NovelSearchHit[]
  degraded?: boolean
  degradeReason?: string
}): AssembledChapterContext {
  const pov = input.chapterCard?.povCharacterId
    ? input.characters.find((item) => item.id === input.chapterCard?.povCharacterId)
    : undefined
  const featured = pov
    ? [pov]
    : input.characters.slice(0, 3)

  const promiseLines = input.openPromises
    .slice(0, OPEN_PROMISE_TOP_N)
    .map(
      (item) =>
        `- [${item.status}] ${item.description}（种于第${item.plantedChapter}章，近触第${item.lastTouchedChapter}章）`,
    )

  const voiceLines = featured.flatMap((character) =>
    (character.voiceSamples ?? []).slice(0, 3).map((sample) => `- ${character.name}：${sample}`),
  )

  const fixedParts = [
    `【书设定】标题：${input.meta.title}；文类：现实向`,
    `前提：${input.meta.premise}`,
    input.meta.themes.length ? `主题：${input.meta.themes.join('、')}` : '',
    input.meta.styleNotes ? `文风：${input.meta.styleNotes}` : '',
    input.meta.era ? `时代：${input.meta.era}` : '',
    `【本章大纲】第 ${input.chapterNumber} 章 ${input.chapterCard?.title ?? ''}`.trim(),
    input.chapterCard?.beatSummary
      ? `节拍：${input.chapterCard.beatSummary}`
      : '节拍：（无）',
    input.chapterCard?.targetEmotion
      ? `目标情绪：${input.chapterCard.targetEmotion}`
      : '',
    input.chapterCard?.conflict ? `冲突：${input.chapterCard.conflict}` : '',
    featured.length
      ? `【主要角色】\n${featured
          .map((c) => {
            const bits = [
              c.name,
              c.role,
              c.motivation && `动机:${c.motivation}`,
              c.secret && `秘密:${c.secret}`,
              c.status && `状态:${c.status}`,
            ].filter(Boolean)
            return `- ${bits.join(' · ')}`
          })
          .join('\n')}`
      : '',
    promiseLines.length ? `【未回收伏笔】\n${promiseLines.join('\n')}` : '',
    input.endingHook ? `【上章钩子】${input.endingHook}` : '',
    voiceLines.length ? `【声口样例】\n${voiceLines.join('\n')}` : '',
    input.canonTexts.length
      ? `【Canon 摘录】\n${input.canonTexts
          .slice(0, 12)
          .map((item) => `- ${item}`)
          .join('\n')}`
      : '',
  ].filter(Boolean)

  const retrievalParts = input.retrievalHits.map(
    (hit) =>
      `· [${hit.kind}${hit.chapterNumber ? `/ch${hit.chapterNumber}` : ''}] ${hit.title}\n${hit.content}`,
  )

  return {
    fixedBlock: clip(fixedParts.join('\n\n'), FIXED_BUDGET),
    retrievalBlock: clip(retrievalParts.join('\n\n'), RETRIEVAL_BUDGET),
    degraded: Boolean(input.degraded),
    degradeReason: input.degradeReason,
    openPromises: input.openPromises.slice(0, OPEN_PROMISE_TOP_N),
    chapterCard: input.chapterCard,
  }
}

export function runContinuityGuard(input: {
  draft: string
  characters: NovelCharacter[]
  knowledge: Array<{ secretLabel: string; content: string; knowerCharacterIds: string[] }>
  openPromises: NarrativePromise[]
  outlineDivergence?: string
}): GuardWarning[] {
  const warnings: GuardWarning[] = []
  const text = input.draft

  for (const character of input.characters) {
    if (character.status === 'dead' && text.includes(character.name)) {
      warnings.push({
        code: 'dead_character',
        severity: 'error',
        message: `疑似已终结角色「${character.name}」出现在正文中`,
        relatedIds: [character.id],
      })
    }
  }

  for (const entry of input.knowledge) {
    const needle = entry.secretLabel.trim()
    if (needle.length < 2) continue
    if (!text.includes(needle) && !text.includes(entry.content.slice(0, 12))) continue
    // 粗检：正文提到秘密标签时，若没有任何知情者姓名同现，提示知情风险
    const knowers = input.characters.filter((c) =>
      entry.knowerCharacterIds.includes(c.id),
    )
    const knowerMentioned = knowers.some((c) => text.includes(c.name))
    if (knowers.length > 0 && !knowerMentioned) {
      warnings.push({
        code: 'knowledge_leak',
        severity: 'warn',
        message: `正文提及「${entry.secretLabel}」，但未见知情角色同场，请核对知情差`,
      })
    }
  }

  for (const promise of input.openPromises) {
    if (
      /回收|揭晓|真相大白/.test(text) &&
      text.includes(promise.description.slice(0, Math.min(6, promise.description.length)))
    ) {
      warnings.push({
        code: 'early_payoff',
        severity: 'info',
        message: `正文可能回收伏笔「${promise.description}」，请确认是否过早`,
        relatedIds: [promise.id],
      })
    }
  }

  if (input.outlineDivergence?.trim()) {
    warnings.push({
      code: 'outline_divergence',
      severity: 'info',
      message: `相对大纲偏离：${input.outlineDivergence.trim()}`,
    })
  }

  // 简单时间词冲突提示
  if (/昨天/.test(text) && /明天/.test(text) && /同一天|当天/.test(text)) {
    warnings.push({
      code: 'timeline_conflict',
      severity: 'warn',
      message: '正文同时出现冲突时间表述，请核对时间线',
    })
  }

  return warnings
}

export class NovelRuntime {
  constructor(
    private readonly store: NovelStoryStore,
    private readonly llm: NovelLlm = new DeepSeekNovelLlm(),
  ) {}

  async generateOutlineDraft(input: {
    bookId: string
    config: ProviderRuntimeConfig
    signal: AbortSignal
    guidance?: string
  }): Promise<BookOutline> {
    const meta = await this.store.getMeta(input.bookId)
    const characters = await this.store.listCharacters(input.bookId)
    const system = [
      '你是长篇现实向小说的大纲策划。',
      '只输出 JSON，不要 Markdown 解释。',
      'JSON schema: {"volumes":[{"id":"string","title":"string","order":1,"chapters":[{"id":"string","chapterNumber":1,"title":"string","beatSummary":"string","targetEmotion":"string","conflict":"string"}]}]}',
      '章节数量建议 8-20，按现实向人物关系与秘密推进，不要玄幻设定。',
    ].join('\n')
    const user = [
      `书名：${meta.title}`,
      `前提：${meta.premise}`,
      `主题：${meta.themes.join('、') || '（无）'}`,
      `时代：${meta.era || '当代'}`,
      `角色：${characters.map((c) => c.name).join('、') || '（待定）'}`,
      input.guidance ? `补充要求：${input.guidance}` : '',
    ]
      .filter(Boolean)
      .join('\n')

    const text = await this.llm.completeText(system, user, input.config, input.signal)
    return normalizeOutline(extractJsonObject(text))
  }

  async reviseOutlineChapter(input: {
    bookId: string
    chapterNumber: number
    config: ProviderRuntimeConfig
    signal: AbortSignal
    guidance: string
    /** 未保存的编辑区大纲；缺省则读已存大纲 */
    currentOutline?: BookOutline
  }): Promise<OutlineChapterCard> {
    const outline = input.currentOutline ?? (await this.store.getOutline(input.bookId))
    let card: OutlineChapterCard | undefined
    for (const volume of outline.volumes) {
      card = volume.chapters.find((item) => item.chapterNumber === input.chapterNumber)
      if (card) break
    }
    if (!card) throw new Error('找不到该章大纲卡')

    const meta = await this.store.getMeta(input.bookId)
    const system = [
      '你是现实向长篇小说的大纲修订助手。',
      '在保留章节编号与 id 的前提下修订该章；只输出单个章节 JSON。',
      '字段：{"id","chapterNumber","title","beatSummary","targetEmotion","conflict","povCharacterId"}',
      '不要玄幻设定；加强人物关系、秘密与冲突即可。',
    ].join('\n')
    const user = [
      `书名：${meta.title}`,
      `前提：${meta.premise}`,
      `原章卡：${JSON.stringify(card)}`,
      `相邻章概要：${JSON.stringify(
        outline.volumes
          .flatMap((v) => v.chapters)
          .filter(
            (c) =>
              Math.abs(c.chapterNumber - input.chapterNumber) <= 1 &&
              c.chapterNumber !== input.chapterNumber,
          )
          .map((c) => ({
            chapterNumber: c.chapterNumber,
            title: c.title,
            beatSummary: c.beatSummary,
          })),
      )}`,
      `修订要求：${input.guidance}`,
    ].join('\n')
    const text = await this.llm.completeText(system, user, input.config, input.signal)
    const parsed = extractJsonObject(text) as Partial<OutlineChapterCard>
    return {
      ...card,
      title: parsed.title?.trim() || card.title,
      beatSummary: parsed.beatSummary?.trim() || card.beatSummary,
      targetEmotion: parsed.targetEmotion?.trim() || card.targetEmotion,
      conflict: parsed.conflict?.trim() || card.conflict,
      povCharacterId: parsed.povCharacterId?.trim() || card.povCharacterId,
    }
  }

  /**
   * 基于现有大纲按指引整体调整（非整本推倒重来）。
   * 尽量保留 volume/chapter id 与 chapterNumber。
   */
  async reviseOutlineDraft(input: {
    bookId: string
    currentOutline: BookOutline
    guidance: string
    config: ProviderRuntimeConfig
    signal: AbortSignal
  }): Promise<BookOutline> {
    if (!input.currentOutline.volumes.length) {
      throw new Error('当前没有可调整的大纲，请先生成草案')
    }
    const meta = await this.store.getMeta(input.bookId)
    const characters = await this.store.listCharacters(input.bookId)
    const system = [
      '你是长篇现实向小说的大纲修订编辑。',
      '在「现有大纲」基础上按用户要求调整，不要无视原文另起炉灶，除非用户明确要求大幅重构。',
      '尽量保留各卷/章的 id 与 chapterNumber；可增删章，但需保持 chapterNumber 连续或合理。',
      '只输出 JSON，不要 Markdown 解释。',
      'JSON schema: {"volumes":[{"id":"string","title":"string","order":1,"chapters":[{"id":"string","chapterNumber":1,"title":"string","beatSummary":"string","targetEmotion":"string","conflict":"string","povCharacterId":"string"}]}]}',
    ].join('\n')
    const user = [
      `书名：${meta.title}`,
      `前提：${meta.premise}`,
      `主题：${meta.themes.join('、') || '（无）'}`,
      `时代：${meta.era || '当代'}`,
      `角色：${characters.map((c) => `${c.name}${c.secret ? `（秘密:${c.secret})` : ''}`).join('、') || '（待定）'}`,
      `调整要求：${input.guidance}`,
      `现有大纲：${JSON.stringify(input.currentOutline)}`,
    ].join('\n')

    const text = await this.llm.completeText(system, user, input.config, input.signal)
    const revised = normalizeOutline(extractJsonObject(text))
    // 保留锁定标记由调用方决定；此处返回可编辑草案
    return {
      ...revised,
      locked: false,
      version: Math.max(1, input.currentOutline.version) + 1,
      updatedAt: new Date().toISOString(),
    }
  }

  async draftChapter(input: {
    bookId: string
    chapterNumber: number
    assembled: AssembledChapterContext
    config: ProviderRuntimeConfig
    signal: AbortSignal
    feedback?: string
    onToken: (token: string) => void
  }): Promise<string> {
    const meta = await this.store.getMeta(input.bookId)
    const target = meta.targetChapterChars ?? 3000
    const system = [
      '你是现实向长篇小说作者，文笔克制、重视人物心理与对话声口。',
      '严格遵守给定 Canon、知情差与未回收伏笔约束；不要提前无故回收伏笔。',
      '只输出章节正文（可含小节标题），不要输出分析说明。',
    ].join('\n')
    const user = [
      input.assembled.fixedBlock,
      input.assembled.retrievalBlock
        ? `【检索参考】\n${input.assembled.retrievalBlock}`
        : '',
      `请撰写第 ${input.chapterNumber} 章，目标约 ${target} 字。`,
      input.feedback ? `改稿意见：${input.feedback}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')

    return this.llm.streamText(system, user, input.config, input.signal, input.onToken)
  }

  async extractStateDiff(input: {
    bookId: string
    chapterNumber: number
    draft: string
    config: ProviderRuntimeConfig
    signal: AbortSignal
  }): Promise<StateDiff> {
    const characters = await this.store.listCharacters(input.bookId)
    const openPromises = await this.store.listOpenPromises(input.bookId)
    const system = [
      '你是叙事状态抽取器。只输出 JSON StateDiff，不要解释。',
      '字段可包含: characters, relationships, knowledge, timeline, promises, canonCandidates, outlineDivergence, chapterSummary, endingHook, newVoiceSamples',
      'promises.action 只能是 plant|reinforce|pay_off|subvert|abandon',
      '现实向：关注关系、秘密、知情差、时间锚点与情感伏笔。',
    ].join('\n')
    const user = [
      `章节：${input.chapterNumber}`,
      `已知角色：${JSON.stringify(characters.map((c) => ({ id: c.id, name: c.name })))}`,
      `未回收伏笔：${JSON.stringify(openPromises.map((p) => ({ id: p.id, description: p.description, status: p.status })))}`,
      `正文：\n${clip(input.draft, 12_000)}`,
    ].join('\n\n')
    try {
      const text = await this.llm.completeText(system, user, input.config, input.signal)
      return normalizeDiff(extractJsonObject(text))
    } catch {
      return {
        chapterSummary: input.draft.slice(0, 280),
        endingHook: '',
      }
    }
  }
}
