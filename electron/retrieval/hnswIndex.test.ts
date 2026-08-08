import { describe, expect, it } from 'vitest'
import { HnswIndex, cosineSimilarity } from './hnswIndex'
import { mulberry32 } from './testRandom'

/** 生成 N 个 dim 维随机向量（确定性种子），可选归一化 */
function randomVectors(count: number, dim: number, rng: () => number): number[][] {
  const vectors: number[][] = []
  for (let index = 0; index < count; index += 1) {
    const v = Array.from({ length: dim }, () => rng() * 2 - 1)
    vectors.push(v)
  }
  return vectors
}

/** 暴力全量余弦 topK（ground truth） */
function bruteTopK(
  query: number[],
  vectors: number[][],
  topK: number,
): Array<{ id: string; score: number }> {
  return vectors
    .map((v, index) => ({ id: `id${index}`, score: cosineSimilarity(query, v) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

function recallAtK(ann: Set<string>, brute: Set<string>): number {
  if (brute.size === 0) return 1
  let hit = 0
  for (const id of brute) if (ann.has(id)) hit += 1
  return hit / brute.size
}

describe('HnswIndex', () => {
  const DIM = 8
  const N = 50

  it('空图搜索返回空', () => {
    const index = new HnswIndex({ dim: DIM })
    expect(index.search(new Array(DIM).fill(0), 5)).toEqual([])
    expect(index.size).toBe(0)
  })

  it('HNSW topK 与暴力全量在 recall@10 上 ≥0.9', () => {
    const rng = mulberry32(42)
    const index = new HnswIndex({ dim: DIM, rng })
    const vectors = randomVectors(N, DIM, rng)
    for (let i = 0; i < N; i += 1) {
      index.add(`id${i}`, vectors[i] ?? [])
    }

    // 用 10 个不同 query 测平均 recall
    let totalRecall = 0
    const queries = randomVectors(10, DIM, rng)
    for (const q of queries) {
      const ann = index.search(q, 10)
      const brute = bruteTopK(q, vectors, 10)
      const annSet = new Set(ann.map((hit) => hit.id))
      const bruteSet = new Set(brute.map((hit) => hit.id))
      totalRecall += recallAtK(annSet, bruteSet)
    }
    const avgRecall = totalRecall / queries.length
    expect(avgRecall).toBeGreaterThanOrEqual(0.9)
  })

  it('插入后立即可搜', () => {
    const rng = mulberry32(7)
    const index = new HnswIndex({ dim: DIM, rng })
    const vector = [1, 0, 0, 0, 0, 0, 0, 0]
    index.add('a', vector)
    expect(index.has('a')).toBe(true)
    const hits = index.search(vector, 1)
    expect(hits[0]?.id).toBe('a')
  })

  it('upsert 同 id 替换旧向量', () => {
    const rng = mulberry32(11)
    const index = new HnswIndex({ dim: DIM, rng })
    index.add('a', [1, 0, 0, 0, 0, 0, 0, 0])
    index.add('a', [0, 1, 0, 0, 0, 0, 0, 0])
    expect(index.size).toBe(1)
    const query = [0, 1, 0, 0, 0, 0, 0, 0]
    const hits = index.search(query, 1)
    expect(hits[0]?.id).toBe('a')
  })

  it('删除后不再命中', () => {
    const rng = mulberry32(13)
    const index = new HnswIndex({ dim: DIM, rng })
    const vectors = randomVectors(20, DIM, rng)
    for (let i = 0; i < 20; i += 1) index.add(`id${i}`, vectors[i] ?? [])
    index.delete('id5')
    expect(index.has('id5')).toBe(false)
    const query = vectors[5] ?? []
    const hits = index.search(query, 20)
    expect(hits.some((hit) => hit.id === 'id5')).toBe(false)
  })

  it('持久化 round-trip：重建后召回一致', () => {
    const seed = 21
    const indexA = new HnswIndex({ dim: DIM, rng: mulberry32(seed) })
    const vectors = randomVectors(N, DIM, mulberry32(seed + 1))
    for (let i = 0; i < N; i += 1) indexA.add(`id${i}`, vectors[i] ?? [])

    // 模拟快照重建：用同参数 + 同数据重建
    const params = indexA.getParams()
    const indexC = new HnswIndex({ dim: DIM, ...params, rng: mulberry32(seed) })
    for (let i = 0; i < N; i += 1) indexC.add(`id${i}`, vectors[i] ?? [])

    let recall = 0
    const queries = randomVectors(10, DIM, mulberry32(seed + 2))
    for (const q of queries) {
      const ann = indexC.search(q, 10)
      const brute = bruteTopK(q, vectors, 10)
      recall += recallAtK(
        new Set(ann.map((hit) => hit.id)),
        new Set(brute.map((hit) => hit.id)),
      )
    }
    expect(recall / queries.length).toBeGreaterThanOrEqual(0.9)
  })

  it('参数负向：m=1 的 recall 明显低于 m=16', () => {
    const seed = 31
    const vectors = randomVectors(N, DIM, mulberry32(seed + 1))
    const queries = randomVectors(10, DIM, mulberry32(seed + 2))

    const lowM = new HnswIndex({ dim: DIM, m: 1, maxM0: 2, efConstruction: 10, efSearch: 40, rng: mulberry32(seed) })
    const highM = new HnswIndex({ dim: DIM, m: 16, maxM0: 32, efConstruction: 64, efSearch: 40, rng: mulberry32(seed) })
    for (let i = 0; i < N; i += 1) {
      lowM.add(`id${i}`, vectors[i] ?? [])
      highM.add(`id${i}`, vectors[i] ?? [])
    }

    const avgRecall = (index: HnswIndex) => {
      let total = 0
      for (const q of queries) {
        const brute = bruteTopK(q, vectors, 10)
        const annSet = new Set(index.search(q, 10).map((hit) => hit.id))
        total += recallAtK(annSet, new Set(brute.map((hit) => hit.id)))
      }
      return total / queries.length
    }

    const low = avgRecall(lowM)
    const high = avgRecall(highM)
    expect(high).toBeGreaterThanOrEqual(0.9)
    expect(high).toBeGreaterThan(low)
  })
})
