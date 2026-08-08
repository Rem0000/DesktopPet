/**
 * HNSW（Hierarchical Navigable Small World）近似最近邻索引，纯 TypeScript 实现，无外部依赖。
 *
 * 距离使用余弦距离（1 - cosineSimilarity）；search 返回的 score 是余弦相似度原值，
 * 与 hybridSearch / knowledgeStore 的 vectorScore 阈值（>=0.2 / >=0.55）语义一致。
 *
 * 参考：Malkov & Yashunin, "Efficient and robust approximate nearest neighbor search
 * using Hierarchical Navigable Small World graphs"（2018）。
 */

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let index = 0; index < a.length; index += 1) {
    const av = a[index] ?? 0
    const bv = b[index] ?? 0
    dot += av * bv
    normA += av * av
    normB += bv * bv
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

function cosineDistance(a: number[], b: number[]): number {
  return 1 - cosineSimilarity(a, b)
}

export { cosineSimilarity }

export const HNSW_DEFAULTS = {
  /** 每层最大连接数（非底层） */
  m: 16,
  /** 底层最大连接数 */
  maxM0: 32,
  /** 插入期候选池大小 */
  efConstruction: 64,
  /** 查询期候选池大小 */
  efSearch: 40,
} as const

export type HnswOptions = {
  dim: number
  m?: number
  maxM0?: number
  efConstruction?: number
  efSearch?: number
  /** 层级采样系数；默认 1/ln(m)，保证约 1/m 的节点升到更高层 */
  levelMult?: number
  /** 可注入的均匀随机源（用于确定性重建 / 测试） */
  rng?: () => number
}

/** 解析后的生效参数（不含 dim），用于持久化还原图结构 */
export type HnswParams = {
  m: number
  maxM0: number
  efConstruction: number
  efSearch: number
  levelMult: number
}

export type HnswSearchHit = {
  id: string
  score: number
}

type HnswNode = {
  id: string
  vector: number[]
  level: number
  /** 层级 → 邻居 id 列表 */
  neighbors: Map<number, string[]>
}

/** 通用二叉堆：comparator 返回负值表示 a 优先出队（min-heap） */
class BinaryHeap<T> {
  private items: T[] = []

  constructor(private readonly compare: (a: T, b: T) => number) {}

  get size(): number {
    return this.items.length
  }

  peek(): T | undefined {
    return this.items[0]
  }

  push(item: T): void {
    const items = this.items
    items.push(item)
    let index = items.length - 1
    while (index > 0) {
      const parent = (index - 1) >> 1
      const p = items[parent]
      const c = items[index]
      if (p === undefined || c === undefined || this.compare(p, c) <= 0) break
      items[parent] = c
      items[index] = p
      index = parent
    }
  }

  pop(): T | undefined {
    const items = this.items
    if (items.length === 0) return undefined
    const top = items[0]
    const last = items.pop()
    if (items.length > 0 && last !== undefined) {
      items[0] = last
      let index = 0
      for (;;) {
        const left = index * 2 + 1
        const right = left + 1
        let smallest = index
        const a = items[smallest]
        if (left < items.length) {
          const l = items[left]
          if (l !== undefined && a !== undefined && this.compare(l, a) < 0) smallest = left
        }
        if (right < items.length) {
          const r = items[right]
          const s = items[smallest]
          if (r !== undefined && s !== undefined && this.compare(r, s) < 0) smallest = right
        }
        if (smallest === index) break
        const tmp = items[index]
        items[index] = items[smallest]
        items[smallest] = tmp
        index = smallest
      }
    }
    return top
  }
}

type DistanceEntry = { id: string; dist: number }

const byDistAsc = (a: DistanceEntry, b: DistanceEntry) => a.dist - b.dist
const byDistDesc = (a: DistanceEntry, b: DistanceEntry) => b.dist - a.dist

export class HnswIndex {
  readonly dim: number
  private readonly m: number
  private readonly maxM0: number
  private readonly efConstruction: number
  private efSearch: number
  private readonly levelMult: number
  private readonly rng: () => number
  private readonly nodes = new Map<string, HnswNode>()
  private entryPoint: HnswNode | null = null
  private maxLevel = 0

  constructor(options: HnswOptions) {
    this.dim = options.dim
    this.m = options.m ?? HNSW_DEFAULTS.m
    this.maxM0 = options.maxM0 ?? HNSW_DEFAULTS.maxM0
    this.efConstruction = options.efConstruction ?? HNSW_DEFAULTS.efConstruction
    this.efSearch = options.efSearch ?? HNSW_DEFAULTS.efSearch
    this.levelMult = options.levelMult ?? (this.m > 1 ? 1 / Math.log(this.m) : 1)
    this.rng = options.rng ?? Math.random
  }

  get size(): number {
    return this.nodes.size
  }

  /** 当前生效的构建参数：供持久化还原图结构 */
  getParams(): HnswParams {
    return {
      m: this.m,
      maxM0: this.maxM0,
      efConstruction: this.efConstruction,
      efSearch: this.efSearch,
      levelMult: this.levelMult,
    }
  }

  get(id: string): number[] | undefined {
    return this.nodes.get(id)?.vector
  }

  has(id: string): boolean {
    return this.nodes.has(id)
  }

  listIds(): string[] {
    return [...this.nodes.keys()]
  }

  /** upsert 语义：同 id 先删旧节点再插入 */
  add(id: string, vector: number[]): void {
    if (vector.length !== this.dim) {
      throw new Error(`向量维度不匹配：期望 ${this.dim}，实际 ${vector.length}`)
    }
    if (this.nodes.has(id)) this.delete(id)

    const level = this.sampleLevel()
    const node: HnswNode = { id, vector, level, neighbors: new Map() }
    for (let l = 0; l <= level; l += 1) node.neighbors.set(l, [])

    if (this.nodes.size === 0) {
      this.entryPoint = node
      this.maxLevel = level
      this.nodes.set(id, node)
      return
    }

    let ep = this.entryPoint as HnswNode
    const oldMaxLevel = this.maxLevel

    // 从当前最高层贪心下探到目标层+1（ef=1，只沿最优点走）
    for (let layer = oldMaxLevel; layer > Math.min(level, oldMaxLevel); layer -= 1) {
      const hits = this.searchLayer(vector, ep, 1, layer)
      const closest = hits[0]
      if (closest) ep = this.nodes.get(closest.id) as HnswNode
    }

    // 在 min(level, oldMaxLevel)..0 各层建边
    for (let layer = Math.min(level, oldMaxLevel); layer >= 0; layer -= 1) {
      const candidates = this.searchLayer(vector, ep, this.efConstruction, layer)
      const topM = layer === 0 ? this.maxM0 : this.m
      const selected = this.selectNeighbors(candidates, topM)
      node.neighbors.set(layer, selected.map((hit) => hit.id))

      // 双向建边；邻居溢出时对邻居重选
      for (const selectedHit of selected) {
        const neighbor = this.nodes.get(selectedHit.id)
        if (!neighbor) continue
        const list = neighbor.neighbors.get(layer) ?? []
        list.push(id)
        neighbor.neighbors.set(layer, list)
        const limit = layer === 0 ? this.maxM0 : this.m
        if (list.length > limit) {
          const reSelected = this.selectNeighbors(
            list.map((neighborId) => {
              const n = this.nodes.get(neighborId)
              return n ? { id: neighborId, score: cosineSimilarity(neighbor.vector, n.vector) } : null
            }).filter((entry): entry is { id: string; score: number } => entry !== null),
            limit,
          )
          neighbor.neighbors.set(layer, reSelected.map((hit) => hit.id))
        }
      }

      const closest = candidates[0]
      if (closest) ep = this.nodes.get(closest.id) as HnswNode
    }

    if (level > oldMaxLevel) {
      this.maxLevel = level
      this.entryPoint = node
    }
    this.nodes.set(id, node)
  }

  delete(id: string): boolean {
    const node = this.nodes.get(id)
    if (!node) return false
    for (const [layer, neighborIds] of node.neighbors) {
      for (const neighborId of neighborIds) {
        const neighbor = this.nodes.get(neighborId)
        if (!neighbor) continue
        const list = (neighbor.neighbors.get(layer) ?? []).filter((n) => n !== id)
        neighbor.neighbors.set(layer, list)
      }
    }
    this.nodes.delete(id)
    if (this.entryPoint?.id === id) this.recomputeEntryPoint()
    return true
  }

  clear(): void {
    this.nodes.clear()
    this.entryPoint = null
    this.maxLevel = 0
  }

  search(query: number[], topK: number, efSearch = this.efSearch): HnswSearchHit[] {
    if (query.length !== this.dim || this.nodes.size === 0 || !this.entryPoint) return []
    let ep = this.entryPoint
    for (let layer = this.maxLevel; layer >= 1; layer -= 1) {
      const hits = this.searchLayer(query, ep, 1, layer)
      const closest = hits[0]
      if (closest) ep = this.nodes.get(closest.id) as HnswNode
    }
    return this.searchLayer(query, ep, Math.max(efSearch, topK), 0).slice(0, topK)
  }

  /** 单层候选搜索：双堆（候选最小堆 + 结果最大堆）直到收敛 */
  private searchLayer(
    query: number[],
    entry: HnswNode,
    ef: number,
    layer: number,
  ): HnswSearchHit[] {
    const visited = new Set<string>([entry.id])
    const candidates = new BinaryHeap<DistanceEntry>(byDistAsc)
    const results = new BinaryHeap<DistanceEntry>(byDistDesc)
    const entryDist = cosineDistance(query, entry.vector)
    candidates.push({ id: entry.id, dist: entryDist })
    results.push({ id: entry.id, dist: entryDist })

    while (candidates.size > 0) {
      const c = candidates.pop()
      if (!c) break
      const furthest = results.peek()
      if (furthest && c.dist > furthest.dist) break
      const node = this.nodes.get(c.id)
      if (!node) continue
      for (const neighborId of node.neighbors.get(layer) ?? []) {
        if (visited.has(neighborId)) continue
        visited.add(neighborId)
        const neighbor = this.nodes.get(neighborId)
        if (!neighbor) continue
        const dist = cosineDistance(query, neighbor.vector)
        const currentFurthest = results.peek()
        if (results.size < ef || (currentFurthest && dist < currentFurthest.dist)) {
          candidates.push({ id: neighborId, dist })
          results.push({ id: neighborId, dist })
          if (results.size > ef) results.pop()
        }
      }
    }

    const all: DistanceEntry[] = []
    while (results.size > 0) {
      const entryItem = results.pop()
      if (entryItem) all.push(entryItem)
    }
    all.sort(byDistAsc)
    return all.map((item) => ({ id: item.id, score: 1 - item.dist }))
  }

  /**
   * 启发式邻居选择：按与查询点距离升序，逐个纳入"比已选集合都更接近查询点"的候选，
   * 维持连接在向量空间上的多样性，避免所有邻居挤在同一方向。
   */
  private selectNeighbors(
    candidates: Array<{ id: string; score: number }>,
    topM: number,
  ): Array<{ id: string; score: number }> {
    const sorted = [...candidates].sort((a, b) => b.score - a.score)
    const result: Array<{ id: string; score: number }> = []
    for (const cand of sorted) {
      if (result.length >= topM) break
      const candVector = this.nodes.get(cand.id)?.vector
      if (!candVector) continue
      let closerToPicked = false
      for (const picked of result) {
        const pickedVector = this.nodes.get(picked.id)?.vector
        if (!pickedVector) continue
        if (cosineSimilarity(candVector, pickedVector) > cand.score) {
          closerToPicked = true
          break
        }
      }
      if (!closerToPicked) result.push(cand)
    }
    return result
  }

  /** 层级采样：P(level=k) 按 levelMult 指数衰减 */
  private sampleLevel(): number {
    // 避免 rng 返回 0/1 边界导致 -ln 异常
    const u = Math.min(0.999999, Math.max(0.000001, this.rng()))
    return Math.floor(-Math.log(u) * this.levelMult)
  }

  private recomputeEntryPoint(): void {
    let best: HnswNode | null = null
    let bestLevel = -1
    for (const node of this.nodes.values()) {
      if (node.level > bestLevel) {
        bestLevel = node.level
        best = node
      }
    }
    this.entryPoint = best
    this.maxLevel = bestLevel
  }
}
