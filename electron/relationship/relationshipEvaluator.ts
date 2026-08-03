import type {
  ChatMessage,
  ProviderRuntimeConfig,
  RelationshipState,
} from '../../src/chat/contracts'
import { RelationshipStore } from './relationshipStore'

/** 触发演化的最小好感温度 */
export const EVOLUTION_MIN_AFFINITY = 60
/** 距上次评估的最小间隔（天） */
export const EVOLUTION_INTERVAL_DAYS = 1
/** 演化限频窗口（天） */
export const EVOLUTION_WINDOW_DAYS = 7
/** 每个窗口最多生效的演化条数 */
export const EVOLUTION_MAX_PER_WINDOW = 1
/** 传给反思 LLM 的证据/人设字符上限 */
export const EVOLUTION_EVIDENCE_CHARS = 8_000
export const EVOLUTION_PERSONA_CHARS = 4_000

const DAY_MS = 86_400_000

export type EvaluateGateResult = { ok: true } | { ok: false; reason: string }

export function shouldEvaluate(
  state: RelationshipState,
  now = new Date(),
): EvaluateGateResult {
  if (state.affinity < EVOLUTION_MIN_AFFINITY) {
    return { ok: false, reason: 'affinity_too_low' }
  }
  const last = state.lastEvaluatedAt ? Date.parse(state.lastEvaluatedAt) : 0
  if (!Number.isNaN(last) && now.getTime() - last < EVOLUTION_INTERVAL_DAYS * DAY_MS) {
    return { ok: false, reason: 'interval_not_elapsed' }
  }
  const windowStart = now.getTime() - EVOLUTION_WINDOW_DAYS * DAY_MS
  const appliedInWindow = state.evolutions.filter(
    (item) =>
      item.status === 'applied' &&
      item.appliedAt &&
      Date.parse(item.appliedAt) >= windowStart,
  ).length
  if (appliedInWindow >= EVOLUTION_MAX_PER_WINDOW) {
    return { ok: false, reason: 'limit' }
  }
  return { ok: true }
}

export type EvolutionCandidate = {
  personaQuote: string
  change: string
  evidence: string
}

export type RelationshipComplete = (
  systemPrompt: string,
  userPrompt: string,
  config: ProviderRuntimeConfig,
  signal: AbortSignal,
) => Promise<string>

function clip(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 12))}…(已裁剪)`
}

function buildTranscript(messages: ChatMessage[]): string {
  const lines = messages
    .filter((message) => message.status === 'complete' && message.content.trim())
    .slice(-40)
    .map(
      (message) =>
        `${message.role === 'user' ? '用户' : '桌宠'}：${message.content.replace(/\s+/g, ' ').trim()}`,
    )
  return lines.join('\n')
}

function parseCandidates(text: string): EvolutionCandidate[] {
  let candidateText = text
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  if (fenced?.[1]) candidateText = fenced[1]
  const start = candidateText.indexOf('{')
  const end = candidateText.lastIndexOf('}')
  if (start < 0 || end <= start) return []
  try {
    const parsed = JSON.parse(candidateText.slice(start, end + 1)) as {
      candidates?: unknown
    }
    const list = Array.isArray(parsed.candidates) ? parsed.candidates : []
    const result: EvolutionCandidate[] = []
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      const personaQuote = String(row.personaQuote ?? '').trim()
      const change = String(row.change ?? '').trim()
      const evidence = String(row.evidence ?? '').trim()
      if (!personaQuote || !change) continue
      result.push({
        personaQuote: personaQuote.slice(0, 200),
        change: change.slice(0, 200),
        evidence: evidence.slice(0, 300),
      })
    }
    return result
  } catch {
    return []
  }
}

const REFLECTION_SYSTEM_PROMPT = [
  '你是桌宠与用户长期关系的观察者。',
  '请对比人设原文与近期对话证据，找出人设中与稳定证据明显不符、且值得更新为「最近已经改变」的固有设定。',
  '只输出 JSON：{"candidates":[{"personaQuote":"人设原文中的片段","change":"建议的最新现状描述","evidence":"近期对话证据摘要"}]}。',
  '若没有这样的设定，输出 {"candidates":[]}。不要输出解释。',
].join('\n')

/**
 * 慢速演化：事件驱动触发（阈值 + 间隔 + 限频），反思 LLM 产出候选，
 * 候选仅进入 proposed 状态，由用户在人审面板决定是否 applied。
 */
export class RelationshipEvaluator {
  constructor(
    private readonly store: RelationshipStore,
    private readonly complete: RelationshipComplete,
  ) {}

  async maybeEvaluate(input: {
    packageId: string
    persona: string
    messages: ChatMessage[]
    config: ProviderRuntimeConfig
    signal: AbortSignal
  }): Promise<{ evaluated: boolean; candidates: number; reason?: string }> {
    const state = await this.store.getState(input.packageId)
    const gate = shouldEvaluate(state)
    if (!gate.ok) {
      return { evaluated: false, candidates: 0, reason: gate.reason }
    }
    // 无 persona 可演化：记录评估时间但不产出候选
    if (!input.persona.trim()) {
      await this.store.markEvaluated(input.packageId)
      return { evaluated: true, candidates: 0, reason: 'no_persona' }
    }

    const candidates = await this.proposeCandidates(input)
    // 评估过程被取消（如新评估取代/删除包）时，不落 lastEvaluatedAt 也不新增提案
    if (input.signal.aborted) {
      return { evaluated: false, candidates: 0, reason: 'aborted' }
    }
    await this.store.markEvaluated(input.packageId)
    for (const candidate of candidates) {
      await this.store.addProposal(input.packageId, candidate)
    }
    return { evaluated: true, candidates: candidates.length }
  }

  private async proposeCandidates(input: {
    packageId: string
    persona: string
    messages: ChatMessage[]
    config: ProviderRuntimeConfig
    signal: AbortSignal
  }): Promise<EvolutionCandidate[]> {
    const userPrompt = [
      `人设原文：\n${clip(input.persona, EVOLUTION_PERSONA_CHARS)}`,
      `近期对话证据：\n${clip(buildTranscript(input.messages), EVOLUTION_EVIDENCE_CHARS)}`,
    ].join('\n\n')
    try {
      const text = await this.complete(
        REFLECTION_SYSTEM_PROMPT,
        userPrompt,
        input.config,
        input.signal,
      )
      return parseCandidates(text)
    } catch {
      return []
    }
  }
}
