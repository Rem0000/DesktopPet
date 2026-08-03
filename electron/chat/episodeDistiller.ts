import type {
  ChatMessage,
  EpisodeConfig,
  MemoryImportance,
  ProviderRuntimeConfig,
} from '../../src/chat/contracts'
import { scoreMemoryItem } from './memoryService'
import type { MemoryStore } from './memoryStore'
import { assertSafeMemoryContent } from './memoryStore'
import { episodeConfigValues } from './episodeConfig'

/** 传给抽取 LLM 的消息片段字符上限 */
const DISTILL_INPUT_CHARS = 8_000
/** 抽取失败/空结果时写入的 episode 条数上限 */
const MAX_EPISODES_LIMIT = 6
/** 去重相似度阈值：与既有记忆条目打分超过该值视为重复 */
const DEDUPE_THRESHOLD = 10
/**
 * 冷启动历史判定：首次遇到某会话且 complete 消息数达到该值，视为应用重启后
 * 重新加载的旧会话——把基准线预置为当前消息数并跳过本轮，避免把整段历史当
 * 「新消息」白烧一次抽取 LLM。全新会话（消息少）不受影响，首轮关键事实仍可即时触发。
 */
const COLD_START_HISTORY_THRESHOLD = 8

/** 关键事实意图：决定/约定/身份/目标等「值得长期记住」信号 */
export function hasKeyFactIntent(text: string): boolean {
  return /(我(决定|约定|答应|计划|打算|希望|目标|想)|我的(名字|姓名|生日|职业|公司|学校|家乡|电话|邮箱|微信|地址)|下(周|月)|之后|别忘了|记得|求职|考研|喜欢|讨厌|需要)/.test(
    text,
  )
}

export type EpisodeCandidate = {
  content: string
  importance: MemoryImportance
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 12))}…(已裁剪)`
}

function buildTranscript(messages: ChatMessage[]): string {
  const lines = messages
    .filter((message) => message.status === 'complete' && message.content.trim())
    .slice(-60)
    .map(
      (message) =>
        `${message.role === 'user' ? '用户' : '桌宠'}：${message.content.replace(/\s+/g, ' ').trim()}`,
    )
  return lines.join('\n')
}

export function parseEpisodes(text: string): EpisodeCandidate[] {
  let candidateText = text
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  if (fenced?.[1]) candidateText = fenced[1]
  const start = candidateText.indexOf('{')
  const end = candidateText.lastIndexOf('}')
  if (start < 0 || end <= start) return []
  try {
    const parsed = JSON.parse(candidateText.slice(start, end + 1)) as {
      episodes?: unknown
    }
    const list = Array.isArray(parsed.episodes) ? parsed.episodes : []
    const result: EpisodeCandidate[] = []
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      const content = String(row.content ?? '').trim()
      if (!content) continue
      const importance =
        row.importance === 1 || row.importance === 2 || row.importance === 3
          ? (row.importance as MemoryImportance)
          : 2
      result.push({ content: content.slice(0, 500), importance })
      if (result.length >= MAX_EPISODES_LIMIT) break
    }
    return result
  } catch {
    return []
  }
}

const DISTILL_SYSTEM_PROMPT = [
  '你是桌宠与用户对话的关键事实记录员。',
  '请从以下对话中抽取值得长期记住的关键事实：用户的决定、约定、身份信息、目标计划、稳定偏好等。',
  '忽略寒暄、一次性问题、临时情绪与输出风格要求（输出风格应写入人设）。',
  '只输出 JSON：{"episodes":[{"content":"精炼的中文事实描述，不超过 60 字","importance":1|2|3}]}。',
  '若没有值得记住的事实，输出 {"episodes":[]}。不要输出解释。',
].join('\n')

export type EpisodeComplete = (
  systemPrompt: string,
  userPrompt: string,
  config: ProviderRuntimeConfig,
  signal: AbortSignal,
) => Promise<string>

export type DistillResult = {
  triggered: boolean
  reason: string
  episodesWritten: number
}

/**
 * 对话关键事实自动 episode 沉淀：事件驱动（非阻塞队列），
 * 触发闸门（enabled + 关键事实意图/累计未沉淀数 + 间隔）→ LLM 抽取 → 容错解析 → 去重 → 写入。
 */
export class EpisodeDistiller {
  constructor(
    private readonly store: MemoryStore,
    private readonly complete: EpisodeComplete,
    private readonly config: EpisodeConfig,
    /** 供测试注入固定时间 */
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** 每个会话上次抽取时的已沉淀消息数（跨会话互不干扰） */
  private lastDistillCountBySession = new Map<string, number>()

  async maybeDistill(input: {
    packageId: string
    sessionId: string
    messages: ChatMessage[]
    config: ProviderRuntimeConfig
    signal: AbortSignal
  }): Promise<DistillResult> {
    const cfg = episodeConfigValues(this.config)
    if (!cfg.enabled) return { triggered: false, reason: 'disabled', episodesWritten: 0 }

    const complete = input.messages.filter(
      (message) => message.status === 'complete' && message.content.trim(),
    )
    // 首次遇到该会话：若消息量较大，视为应用重启后重新加载的旧会话——
    // 预置基准线并跳过本轮，避免把整段历史当新消息白烧一次 LLM。
    if (!this.lastDistillCountBySession.has(input.sessionId)) {
      if (complete.length >= COLD_START_HISTORY_THRESHOLD) {
        this.lastDistillCountBySession.set(input.sessionId, complete.length)
        return { triggered: false, reason: 'cold_start_history', episodesWritten: 0 }
      }
      this.lastDistillCountBySession.set(input.sessionId, 0)
    }
    const lastCount = this.lastDistillCountBySession.get(input.sessionId) ?? 0
    const newMessages = complete.length - lastCount
    if (newMessages <= 0) {
      return { triggered: false, reason: 'nothing_new', episodesWritten: 0 }
    }
    const hasKeyFact = complete
      .slice(lastCount)
      .some((message) => message.role === 'user' && hasKeyFactIntent(message.content))
    // 关键事实意图即时触发；否则需攒够未沉淀消息（间隔 + 最小量）才抽取
    if (!hasKeyFact && (newMessages < cfg.intervalMessages || complete.length < cfg.minMessages)) {
      return { triggered: false, reason: 'no_key_fact', episodesWritten: 0 }
    }

    // 用「尚未沉淀」的最近片段做抽取输入；抽取成功才推进基准线，避免频繁重复调用
    const transcript = buildTranscript(complete)
    const episodes = await this.extractEpisodes(
      transcript,
      input.config,
      input.signal,
    )
    if (input.signal.aborted) {
      return { triggered: true, reason: 'aborted', episodesWritten: 0 }
    }

    let written = 0
    for (const episode of episodes) {
      if (input.signal.aborted) break
      if (written >= cfg.maxEpisodes) break
      if (this.isDuplicate(episode.content)) continue
      try {
        assertSafeMemoryContent(episode.content)
      } catch {
        continue
      }
      await this.store.writeItem({
        type: 'episode',
        content: episode.content,
        importance: episode.importance,
        sourceSessionId: input.sessionId,
        sourceMessageIds: complete
          .filter((message) => message.role === 'user')
          .slice(-cfg.maxEpisodes)
          .map((message) => message.id),
      })
      written += 1
    }

    if (complete.length > lastCount) {
      this.lastDistillCountBySession.set(input.sessionId, complete.length)
    }
    return { triggered: true, reason: written ? 'written' : 'empty', episodesWritten: written }
  }

  private async extractEpisodes(
    transcript: string,
    config: ProviderRuntimeConfig,
    signal: AbortSignal,
  ): Promise<EpisodeCandidate[]> {
    if (!transcript.trim()) return []
    try {
      const text = await this.complete(
        DISTILL_SYSTEM_PROMPT,
        `对话记录：\n${clip(transcript, DISTILL_INPUT_CHARS)}`,
        config,
        signal,
      )
      return parseEpisodes(text)
    } catch {
      return []
    }
  }

  private isDuplicate(content: string): boolean {
    const existing = this.store
      .getActiveItems()
      .filter((item) => item.type === 'fact' || item.type === 'episode')
    for (const item of existing) {
      if (scoreMemoryItem(item, content, this.now()) >= DEDUPE_THRESHOLD) return true
    }
    return false
  }
}
