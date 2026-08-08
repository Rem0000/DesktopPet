import { mkdtempSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AnnVectorStore } from '../electron/retrieval/annVectorStore'
import { cosineSimilarity } from '../electron/retrieval/hnswIndex'
import { mulberry32 } from '../electron/retrieval/testRandom'

/**
 * ANN 评测：HNSW 召回率 vs 暴力全量检索（面试可复现的"参数调优"锚点）。
 * 固定种子生成 COUNT 条 DIM 维向量，遍历 {m, efSearch} 组合输出 recall@10 矩阵，
 * 并断言默认参数下 recall@10 ≥ 0.9。
 *
 * 运行：npm run eval:ann
 */

const DIM = 8
const COUNT = 200
const QUERIES = 30
const SEED = 20240808

type Params = { m?: number; maxM0?: number; efConstruction?: number; efSearch: number }
type MeasureResult = { recall: number; latencyPerQueryMs: number }

async function measureRecall(params: Params): Promise<MeasureResult> {
  const rng = mulberry32(SEED)
  const vectors = Array.from({ length: COUNT }, () =>
    Array.from({ length: DIM }, () => rng() * 2 - 1),
  )
  const queries = Array.from({ length: QUERIES }, () =>
    Array.from({ length: DIM }, () => rng() * 2 - 1),
  )

  const dir = mkdtempSync(path.join(os.tmpdir(), 'ann-eval-'))
  const store = new AnnVectorStore(path.join(dir, 'v.json'), {
    m: params.m,
    maxM0: params.maxM0,
    efConstruction: params.efConstruction,
    efSearch: params.efSearch,
    rng: mulberry32(SEED),
  })
  await store.initialize()
  for (let i = 0; i < COUNT; i += 1) {
    await store.upsert(`id${i}`, vectors[i] ?? [])
  }

  let totalRecall = 0
  const start = Date.now()
  for (const query of queries) {
    const brute = vectors
      .map((v, i) => ({ id: `id${i}`, score: cosineSimilarity(query, v) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((hit) => hit.id)
    const ann = new Set(store.searchVector(query, 10).map((hit) => hit.id))
    totalRecall += brute.filter((id) => ann.has(id)).length / brute.length
  }
  const elapsed = Date.now() - start
  await rm(dir, { recursive: true, force: true })
  return { recall: totalRecall / QUERIES, latencyPerQueryMs: elapsed / QUERIES }
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'ann-eval-before-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('eval:ann — HNSW 参数对召回的影响', () => {
  it('输出 recall@10 参数矩阵并断言默认参数达标', async () => {
    const combos: Array<{ label: string; params: Params }> = [
      { label: 'm16/efSearch40（默认）', params: { efSearch: 40 } },
      { label: 'm16/efSearch10', params: { efSearch: 10 } },
      { label: 'm4/efSearch40', params: { m: 4, maxM0: 8, efSearch: 40 } },
      { label: 'm16/efSearch100', params: { efSearch: 100 } },
    ]

    const results: MeasureResult & { label: string }[] = []
    for (const combo of combos) {
      const { recall, latencyPerQueryMs } = await measureRecall(combo.params)
      results.push({ label: combo.label, recall, latencyPerQueryMs })
    }

    // 输出汇总表（对齐 run.retrieval.eval.test.ts 的 console.log 风格）
    console.log(
      '[ann-eval]',
      JSON.stringify({ dim: DIM, count: COUNT, queries: QUERIES, results }, null, 2),
    )

    const defaultValue = results.find((item) => item.label.includes('默认'))
    expect(defaultValue?.recall).toBeGreaterThanOrEqual(0.9)
  })
})
