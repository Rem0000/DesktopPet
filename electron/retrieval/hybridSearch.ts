import { Bm25Index } from './bm25Index'
import { cosineSimilarity } from './vectorStore'
import {
  HYBRID_DEFAULTS,
  type HybridSearchOptions,
  type HybridSearchResult,
  type RecallSource,
  type RetrievalCorpusItem,
} from './types'

function normalizeScores(scores: Map<string, number>): Map<string, number> {
  if (scores.size === 0) return scores
  const values = [...scores.values()]
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (max === 0) {
    return new Map([...scores.entries()].map(([id]) => [id, 0]))
  }
  if (max === min) {
    return new Map([...scores.entries()])
  }
  const normalized = new Map<string, number>()
  for (const [id, score] of scores) {
    normalized.set(id, (score - min) / (max - min))
  }
  return normalized
}

function reciprocalRankFusion(
  rankings: Array<Array<{ id: string }>>,
  k: number,
): Map<string, number> {
  const fused = new Map<string, number>()
  for (const ranking of rankings) {
    ranking.forEach((entry, index) => {
      fused.set(entry.id, (fused.get(entry.id) ?? 0) + 1 / (k + index + 1))
    })
  }
  return fused
}

export async function hybridSearch(
  query: string,
  corpus: RetrievalCorpusItem[],
  options: HybridSearchOptions,
): Promise<HybridSearchResult[]> {
  if (!query.trim() || corpus.length === 0) return []

  const sparseTopK = options.sparseTopK ?? HYBRID_DEFAULTS.sparseTopK
  const vectorTopK = options.vectorTopK ?? HYBRID_DEFAULTS.vectorTopK
  const rerankTopK = options.rerankTopK ?? HYBRID_DEFAULTS.rerankTopK
  const rrfK = options.rrfK ?? HYBRID_DEFAULTS.rrfK
  const alpha = options.alpha ?? HYBRID_DEFAULTS.alpha
  const beta = options.beta ?? HYBRID_DEFAULTS.beta
  const gamma = options.gamma ?? HYBRID_DEFAULTS.gamma
  const minScore = options.minScore ?? HYBRID_DEFAULTS.minScore

  const byId = new Map(corpus.map((item) => [item.id, item]))

  const bm25 = new Bm25Index()
  bm25.build(corpus.map((item) => ({ id: item.id, text: item.text })))
  const sparseHits = bm25.search(query, sparseTopK)
  const sparseScores = normalizeScores(new Map(sparseHits.map((hit) => [hit.id, hit.score])))

  const queryVector = await options.embedQuery(query)
  // 向量召回：有 searchVector（ANN 索引）走近似查询，否则回退全量余弦扫描
  let vectorHits: Array<{ id: string; score: number }>
  if (options.searchVector) {
    vectorHits = options.searchVector(queryVector, vectorTopK)
  } else {
    vectorHits = corpus
      .map((item) => {
        const vector = options.getVector(item.id)
        if (!vector) return null
        return { id: item.id, score: cosineSimilarity(queryVector, vector) }
      })
      .filter((hit): hit is { id: string; score: number } => hit !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, vectorTopK)
  }
  const vectorScores = normalizeScores(new Map(vectorHits.map((hit) => [hit.id, hit.score])))

  const sparseSet = new Set(sparseHits.map((hit) => hit.id))
  const vectorSet = new Set(vectorHits.map((hit) => hit.id))
  const fused = reciprocalRankFusion(
    [sparseHits, vectorHits],
    rrfK,
  )

  const candidateIds = [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, rerankTopK)
    .map(([id]) => id)

  const results: HybridSearchResult[] = []
  for (const id of candidateIds) {
    const item = byId.get(id)
    if (!item) continue
    const sparseScore = sparseScores.get(id) ?? 0
    const vectorScore = vectorScores.get(id) ?? 0
    const metadataBoost = options.metadataBoost?.(item) ?? 0
    const score = alpha * sparseScore + beta * vectorScore + gamma * metadataBoost
    let recallSource: RecallSource = 'sparse'
    if (sparseSet.has(id) && vectorSet.has(id)) recallSource = 'both'
    else if (vectorSet.has(id)) recallSource = 'vector'

    results.push({
      id,
      text: item.text,
      score,
      sparseScore,
      vectorScore,
      recallSource,
      metadata: item.metadata,
    })
  }

  // 可选 cross-encoder 重排：对候选集打分写回 rerankScore；打分抛错时回退线性路径
  let rerankScores: Map<string, number> | null = null
  if (options.reranker) {
    try {
      const reranked = await options.reranker(
        query,
        results.map((hit) => ({ id: hit.id, text: hit.text })),
      )
      rerankScores = new Map(reranked.map((entry) => [entry.id, entry.score]))
    } catch (error) {
      console.warn('[retrieval] reranker 打分失败，回退线性 Rerank：', error)
      rerankScores = null
    }
  }

  if (rerankScores) {
    return results
      .map((hit) => ({ ...hit, rerankScore: rerankScores.get(hit.id) ?? -Infinity }))
      .filter((hit) => hit.rerankScore > 0)
      .sort((a, b) => b.rerankScore - a.rerankScore)
      .slice(0, options.topK)
  }

  return results
    .filter((hit) => hit.score >= minScore && (hit.sparseScore > 0 || hit.vectorScore >= 0.2))
    .sort((a, b) => b.score - a.score)
    .slice(0, options.topK)
}
