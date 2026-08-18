/** 检索 IR 指标（P@k / R@k / MRR@k / NDCG@k），合成语料与真实知识库评测共用 */

/** 由分级相关性导出二值相关集（grade>0 视为相关） */
export function relevantSet(grade: Map<string, number>): Set<string> {
  return new Set([...grade.entries()].filter(([, rel]) => rel > 0).map(([id]) => id))
}

export function precisionAtK(retrieved: string[], relevant: Set<string>, k: number): number {
  const top = retrieved.slice(0, k)
  if (top.length === 0) return 0
  const hits = top.filter((id) => relevant.has(id)).length
  return hits / top.length
}

export function recallAtK(retrieved: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 0
  const top = retrieved.slice(0, k)
  const hits = top.filter((id) => relevant.has(id)).length
  return hits / relevant.size
}

export function mrrAtK(retrieved: string[], relevant: Set<string>, k: number): number {
  const top = retrieved.slice(0, k)
  for (let index = 0; index < top.length; index += 1) {
    const id = top[index]
    if (id && relevant.has(id)) return 1 / (index + 1)
  }
  return 0
}

/** DCG@k：分级增益 2^rel − 1（rel=0 无增益），位置折扣 1/log2(i+1)（i 从 1 起） */
function dcgAtK(retrieved: string[], grade: Map<string, number>, k: number): number {
  const top = retrieved.slice(0, k)
  let dcg = 0
  for (let index = 0; index < top.length; index += 1) {
    const rel = grade.get(top[index] ?? '') ?? 0
    if (rel <= 0) continue
    dcg += (2 ** rel - 1) / Math.log2(index + 2)
  }
  return dcg
}

/** IDCG@k：按相关性分级降序的理想排序（取前 k 位） */
function idcgAtK(grade: Map<string, number>, k: number): number {
  const gains = [...grade.values()]
    .filter((rel) => rel > 0)
    .sort((a, b) => b - a)
    .slice(0, k)
  let idcg = 0
  for (let index = 0; index < gains.length; index += 1) {
    idcg += (2 ** gains[index]! - 1) / Math.log2(index + 2)
  }
  return idcg
}

/** NDCG@k = DCG@k / IDCG@k（分级相关性，排序越接近理想顺序越接近 1） */
export function ndcgAtK(retrieved: string[], grade: Map<string, number>, k: number): number {
  const idcg = idcgAtK(grade, k)
  if (idcg === 0) return 0
  return dcgAtK(retrieved, grade, k) / idcg
}
