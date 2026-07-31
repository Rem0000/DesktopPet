import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asArray, normalizeStateDiff } from './novelRuntime'
import { NovelStoryStore } from './novelStoryStore'

describe('normalizeStateDiff / accept malformed llm diff', () => {
  let tempRoot = ''
  let store: NovelStoryStore

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-diff-'))
    store = new NovelStoryStore(tempRoot)
    await store.initialize()
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('coerces object-shaped collections into arrays', () => {
    expect(asArray({ a: 1, b: 2 })).toEqual([1, 2])
    const diff = normalizeStateDiff({
      characters: {
        '0': { name: '林晚', patch: { motivation: '寻亲' } },
      },
      promises: {
        '0': { description: '未回的电话', action: 'plant' },
      },
      canonCandidates: { x: '事实A' },
      chapterSummary: { summary: '开篇' },
    })
    expect(diff.characters).toHaveLength(1)
    expect(diff.promises?.[0]?.description).toBe('未回的电话')
    expect(diff.canonCandidates).toEqual(['事实A'])
    expect(diff.chapterSummary).toBe('开篇')
  })

  it('acceptChapter survives object-shaped diff fields', async () => {
    const book = await store.createBook({
      title: '书',
      premise: '前提',
      seedCharacters: [{ name: '林晚' }],
    })
    const rawDiff = normalizeStateDiff({
      characters: {
        '0': { name: '林晚', patch: { secret: '旧电话来自母亲' } },
      },
      promises: { '0': { description: '未回的电话', action: 'plant' } },
      canonCandidates: { a: '林晚住在旧公寓' },
      chapterSummary: '摘要',
      endingHook: '钩子',
    })

    await expect(
      store.acceptChapter({
        bookId: book.id,
        chapterNumber: 1,
        title: '一',
        content: '正文内容',
        diff: rawDiff,
      }),
    ).resolves.toBeTruthy()

    expect(await store.listOpenPromises(book.id)).toHaveLength(1)
    expect(await store.listCanon(book.id)).toHaveLength(1)
  })
})
