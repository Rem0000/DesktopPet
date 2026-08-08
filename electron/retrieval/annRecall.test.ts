import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AnnVectorStore } from './annVectorStore'
import { hybridSearch } from './hybridSearch'
import { cosineSimilarity } from './hnswIndex'
import { installMockEmbeddingPipeline } from './testHelpers'
import { mulberry32 } from './testRandom'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'ann-recall-'))
  installMockEmbeddingPipeline()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('annRecall（HNSW 召回正确性 + hybridSearch 接入）', () => {
  it('HNSW 在 50 条 8 维数据上 recall@10 ≥ 0.9（固定种子可复现）', async () => {
    const rng = mulberry32(2024)
    const store = new AnnVectorStore(path.join(dir, 'v.json'), { rng })
    await store.initialize()
    const vectors = Array.from({ length: 50 }, () =>
      Array.from({ length: 8 }, () => rng() * 2 - 1),
    )
    for (let i = 0; i < 50; i += 1) await store.upsert(`id${i}`, vectors[i] ?? [])

    let totalRecall = 0
    const queries = Array.from({ length: 10 }, () =>
      Array.from({ length: 8 }, () => rng() * 2 - 1),
    )
    for (const query of queries) {
      const brute = vectors
        .map((v, i) => ({ id: `id${i}`, score: cosineSimilarity(query, v) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map((hit) => hit.id)
      const ann = new Set(store.searchVector(query, 10).map((hit) => hit.id))
      totalRecall += brute.filter((id) => ann.has(id)).length / brute.length
    }
    expect(totalRecall / queries.length).toBeGreaterThanOrEqual(0.9)
  })

  it('hybridSearch 走 searchVector（ANN）与全量扫描的 top-K 集合一致或更好', async () => {
    const rng = mulberry32(7)
    const store = new AnnVectorStore(path.join(dir, 'v2.json'), { rng })
    await store.initialize()
    const vectors = Array.from({ length: 40 }, () =>
      Array.from({ length: 8 }, () => rng() * 2 - 1),
    )
    const corpus = vectors.map((_, i) => ({ id: `id${i}`, text: `文档内容 ${i}` }))
    for (let i = 0; i < 40; i += 1) await store.upsert(`id${i}`, vectors[i] ?? [])

    const queryVector = Array.from({ length: 8 }, () => rng() * 2 - 1)

    const viaAnn = await hybridSearch('查询', corpus, {
      topK: 8,
      embedQuery: async () => queryVector,
      getVector: (id) => store.get(id),
      searchVector: (q, k) => store.searchVector(q, k),
    })

    const viaBrute = await hybridSearch('查询', corpus, {
      topK: 8,
      embedQuery: async () => queryVector,
      getVector: (id) => store.get(id),
    })

    // ANN 版向量召回覆盖全集（有 searchVector 时向量 topK 来自 ANN），
    // 融合后结果应保持与暴力版同量级——用重叠率断言"不劣于全量扫描"
    const annIds = new Set(viaAnn.map((hit) => hit.id))
    const bruteIds = new Set(viaBrute.map((hit) => hit.id))
    const overlap = viaBrute.filter((hit) => annIds.has(hit.id)).length / bruteIds.size
    expect(overlap).toBeGreaterThanOrEqual(0.8)
  })
})
