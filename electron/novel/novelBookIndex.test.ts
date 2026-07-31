import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearNovelIndexCache,
  getNovelBookIndex,
} from './novelBookIndex'
import { NovelStoryStore } from './novelStoryStore'

describe('NovelBookIndex', () => {
  let tempRoot = ''
  let store: NovelStoryStore

  beforeEach(async () => {
    clearNovelIndexCache()
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-index-'))
    store = new NovelStoryStore(tempRoot)
    await store.initialize()
  })

  afterEach(async () => {
    clearNovelIndexCache()
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('indexes accepted chapter under novels book dir only', async () => {
    const book = await store.createBook({ title: '索引书', premise: '前提' })
    await store.acceptChapter({
      bookId: book.id,
      chapterNumber: 1,
      title: '开端',
      content: '林晚站在旧公寓门口，电话再次响起。',
      diff: { chapterSummary: '开端，电话响起', endingHook: '她按下接听' },
    })
    const summary = await store.getChapterSummary(book.id, 1)
    const index = await getNovelBookIndex(book.id, store.bookDir(book.id))
    const result = await index.indexAcceptedChapter({
      chapterNumber: 1,
      title: '开端',
      content: '林晚站在旧公寓门口，电话再次响起。',
      summary: summary ?? undefined,
    })
    expect(result.chunkCount).toBeGreaterThan(0)
    expect(index.getIndexDir().includes(path.join('novels', book.id)) || index.getIndexDir().includes(book.id)).toBe(
      true,
    )
    expect(index.getIndexDir().includes(`${path.sep}knowledge${path.sep}`)).toBe(false)
    expect(index.getIndexDir().includes(`${path.sep}memory${path.sep}`)).toBe(false)

    const search = await index.search('电话', { allowSparseDegrade: true })
    expect(search.hits.length).toBeGreaterThan(0)
  })

  it('rebuild and delete book clears index files with story store', async () => {
    const book = await store.createBook({ title: '重建书', premise: '前提' })
    await store.acceptChapter({
      bookId: book.id,
      chapterNumber: 1,
      title: '一',
      content: '正文内容足够用于切块测试。',
      diff: { chapterSummary: '摘要一' },
    })
    const index = await getNovelBookIndex(book.id, store.bookDir(book.id))
    const rebuilt = await index.rebuildFromStore(store)
    expect(rebuilt.chapters).toBe(1)

    clearNovelIndexCache()
    await store.deleteBook(book.id)
    expect(await store.listBooks()).toHaveLength(0)
  })
})
