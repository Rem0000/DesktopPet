import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VectorStore } from './vectorStore'

describe('VectorStore batch persist', () => {
  let directory = ''

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true })
    directory = ''
  })

  it('upsertMany 批量写入仅落盘一次', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'vector-store-'))
    const filePath = path.join(directory, 'vectors.json')
    const store = new VectorStore(filePath)
    await store.initialize()

    const persistSpy = vi.spyOn(
      store as unknown as { persist: () => Promise<void> },
      'persist',
    )

    await store.upsertMany([
      { id: 'a', vector: [1, 0, 0] },
      { id: 'b', vector: [0, 1, 0] },
      { id: 'c', vector: [0, 0, 1] },
    ])

    expect(persistSpy).toHaveBeenCalledTimes(1)
    expect(store.listIds()).toHaveLength(3)

    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as { records: unknown[] }
    expect(parsed.records).toHaveLength(3)
  })

  it('deleteMany 批量删除仅落盘一次', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'vector-store-del-'))
    const filePath = path.join(directory, 'vectors.json')
    const store = new VectorStore(filePath)
    await store.initialize()
    await store.upsertMany([
      { id: 'a', vector: [1, 0] },
      { id: 'b', vector: [0, 1] },
    ])

    const persistSpy = vi.spyOn(
      store as unknown as { persist: () => Promise<void> },
      'persist',
    )
    await store.deleteMany(['a', 'b'])
    expect(persistSpy).toHaveBeenCalledTimes(1)
    expect(store.listIds()).toHaveLength(0)
  })
})
