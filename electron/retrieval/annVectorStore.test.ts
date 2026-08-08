import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnnVectorStore } from './annVectorStore'
import { cosineSimilarity } from './hnswIndex'
import { mulberry32 } from './testRandom'

let dir: string
let filePath: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'ann-store-'))
  filePath = path.join(dir, 'vectors.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function makeStore() {
  return new AnnVectorStore(filePath, { rng: mulberry32(1) })
}

const V_A = [1, 0, 0, 0, 0, 0, 0, 0]
const V_B = [0, 1, 0, 0, 0, 0, 0, 0]
const V_C = [0, 0, 1, 0, 0, 0, 0, 0]

describe('AnnVectorStore 接口', () => {
  it('upsert 后 get/has/listIds 一致', async () => {
    const store = makeStore()
    await store.initialize()
    await store.upsert('a', V_A)
    await store.upsert('b', V_B)
    expect(store.get('a')).toEqual(V_A)
    expect(store.has('b')).toBe(true)
    expect(store.listIds().sort()).toEqual(['a', 'b'])
  })

  it('批量写入单次落盘', async () => {
    const store = makeStore()
    await store.initialize()
    const persistSpy = vi.spyOn(store as unknown as { persist: () => Promise<void> }, 'persist')
    await store.upsertMany([
      { id: 'a', vector: V_A },
      { id: 'b', vector: V_B },
      { id: 'c', vector: V_C },
    ])
    expect(persistSpy).toHaveBeenCalledTimes(1)

    // 磁盘上 records 数与内存一致
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as { version: number; records: Array<{ id: string }> }
    expect(parsed.version).toBe(2)
    expect(parsed.records).toHaveLength(3)
  })

  it('维度校验：空向量与维度不匹配抛错', async () => {
    const store = makeStore()
    await store.initialize()
    await expect(store.upsert('a', [])).rejects.toThrow('向量不能为空')
    await store.upsert('a', V_A)
    await expect(store.upsert('b', [1, 1])).rejects.toThrow('向量维度不匹配')
  })

  it('deleteMany 单次落盘且删除后不再命中', async () => {
    const store = makeStore()
    await store.initialize()
    await store.upsertMany([
      { id: 'a', vector: V_A },
      { id: 'b', vector: V_B },
      { id: 'c', vector: V_C },
    ])
    const persistSpy = vi.spyOn(store as unknown as { persist: () => Promise<void> }, 'persist')
    await store.deleteMany(['a', 'c'])
    expect(persistSpy).toHaveBeenCalledTimes(1)
    expect(store.has('a')).toBe(false)
    expect(store.has('c')).toBe(false)
    expect(store.has('b')).toBe(true)
  })

  it('clear 清空并落盘', async () => {
    const store = makeStore()
    await store.initialize()
    await store.upsert('a', V_A)
    await store.clear()
    expect(store.listIds()).toEqual([])
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as { version: number; records: unknown[] }
    expect(parsed.records).toEqual([])
  })
})

describe('AnnVectorStore 持久化 round-trip', () => {
  it('initialize 重新加载后数据一致且 ANN 搜索保持高召回', async () => {
    const store = makeStore()
    await store.initialize()
    const rng = mulberry32(99)
    const vectors = Array.from({ length: 30 }, () =>
      Array.from({ length: 8 }, () => rng() * 2 - 1),
    )
    for (let i = 0; i < 30; i += 1) await store.upsert(`id${i}`, vectors[i] ?? [])

    const reloaded = makeStore()
    await reloaded.initialize()
    expect(reloaded.listIds()).toHaveLength(30)
    expect(reloaded.get('id5')).toEqual(vectors[5])

    // ANN 搜索与暴力结果在 reload 后保持高召回（确定性重建）
    let totalRecall = 0
    const queryCount = 8
    for (let q = 0; q < queryCount; q += 1) {
      const query = Array.from({ length: 8 }, () => rng() * 2 - 1)
      const ann = new Set(reloaded.search(query, 5).map((hit) => hit.id))
      const brute = vectors
        .map((v, i) => ({ id: `id${i}`, score: cosineSimilarity(query, v) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((hit) => hit.id)
      totalRecall += brute.filter((id) => ann.has(id)).length / brute.length
    }
    expect(totalRecall / queryCount).toBeGreaterThanOrEqual(0.9)
  })

  it('v1 旧文件自动迁移到 v2', async () => {
    // 先写一个 v1 快照
    const { atomicWriteTextFile } = await import('../fsAtomic')
    await atomicWriteTextFile(
      filePath,
      JSON.stringify({
        version: 1,
        dim: 8,
        records: [
          { id: 'a', vector: V_A },
          { id: 'b', vector: V_B },
        ],
      }),
    )
    const store = makeStore()
    await store.initialize()
    expect(store.listIds().sort()).toEqual(['a', 'b'])
    expect(store.get('a')).toEqual(V_A)

    // 迁移后落盘为 v2
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as { version: number }
    expect(parsed.version).toBe(2)
  })
})
