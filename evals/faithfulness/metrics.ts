/** RAG faithfulness 度量（答案→召回片段 的接地）：拆解 claim → 逐条判定支持 → 支持率即 faithfulness */

export type FaithfulnessClaimVerdict = {
  claim: string
  supported: boolean
  reason?: string
}

/** 中文句级拆分：按 。！？；\n 切分，去空白与空串。用于离线 lexical 基线，以及 real 模式 LLM 拆分失败时的兜底 */
export function splitClaims(text: string): string[] {
  const claims: string[] = []
  for (const part of text.split(/[。！？；\n]+/)) {
    const trimmed = part.trim().replace(/\s+/g, '')
    if (trimmed.length > 0) claims.push(trimmed)
  }
  return claims
}

function ngrams(text: string, n: number): Set<string> {
  const set = new Set<string>()
  for (let index = 0; index + n <= text.length; index += 1) {
    set.add(text.slice(index, index + n))
  }
  return set
}

/** claim 对任一 excerpt 的最大字符 n-gram（2/3-gram 取高者）重叠率。离线近似，非真值 */
export function lexicalGroundingScore(claim: string, context: string[]): number {
  const claimCompact = claim.replace(/\s+/g, '')
  if (claimCompact.length < 2) return 0
  let best = 0
  for (const excerpt of context) {
    const excerptCompact = excerpt.replace(/\s+/g, '')
    if (excerptCompact.length < 2) continue
    for (const n of [2, 3]) {
      const claimNgrams = ngrams(claimCompact, n)
      if (claimNgrams.size === 0) continue
      const excerptNgrams = ngrams(excerptCompact, n)
      let matched = 0
      for (const gram of claimNgrams) {
        if (excerptNgrams.has(gram)) matched += 1
      }
      const ratio = matched / claimNgrams.size
      if (ratio > best) best = ratio
    }
  }
  return best
}

/** supported/total；total<=0 返回 0（无法拆解视为不忠实，保守） */
export function faithfulnessFromVerdicts(supported: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(1, Math.max(0, supported / total))
}

/** 解析 judge 输出的 JSON 数组 [{claim, supported, reason}]；解析失败返回 [] */
export function parseFaithfulnessOutput(text: string): FaithfulnessClaimVerdict[] {
  const match = text.match(/\[[\s\S]*?\]/)
  if (!match) return []
  try {
    const parsed = JSON.parse(match[0]) as Array<Record<string, unknown>>
    if (!Array.isArray(parsed)) return []
    const verdicts: FaithfulnessClaimVerdict[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const claim = typeof item.claim === 'string' ? item.claim.trim() : ''
      if (!claim) continue
      const supported = item.supported === true || item.supported === 'true'
      const reason = typeof item.reason === 'string' ? item.reason : ''
      verdicts.push({ claim, supported, reason })
    }
    return verdicts
  } catch {
    return []
  }
}

export type FaithfulnessScenarioResult = {
  id: string
  category: string
  query: string
  answer: string
  context: string[]
  faithfulness: number
  faithful: boolean
  claims?: FaithfulnessClaimVerdict[]
}

export type FaithfulnessAggregate = {
  overall: { count: number; mean: number; passRate: number }
  byCategory: Record<string, { count: number; mean: number; passRate: number }>
}

const avg = (values: number[]) =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length

export function aggregateFaithfulness(results: FaithfulnessScenarioResult[]): FaithfulnessAggregate {
  const byCategory: FaithfulnessAggregate['byCategory'] = {}
  for (const result of results) {
    byCategory[result.category] ??= { count: 0, mean: 0, passRate: 0 }
    byCategory[result.category]!.count += 1
  }
  for (const category of Object.keys(byCategory)) {
    const group = results.filter((result) => result.category === category)
    const scores = group.map((result) => result.faithfulness)
    byCategory[category]!.mean = avg(scores)
    byCategory[category]!.passRate =
      group.length === 0 ? 0 : group.filter((result) => result.faithful).length / group.length
  }
  const scores = results.map((result) => result.faithfulness)
  return {
    overall: {
      count: results.length,
      mean: avg(scores),
      passRate:
        results.length === 0 ? 0 : results.filter((result) => result.faithful).length / results.length,
    },
    byCategory,
  }
}
