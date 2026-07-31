import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NovelStoryStore } from './novelStoryStore'

describe('NovelStoryStore', () => {
  let tempRoot = ''
  let store: NovelStoryStore

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-store-'))
    store = new NovelStoryStore(tempRoot)
    await store.initialize()
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('creates and lists books in isolation', async () => {
    const a = await store.createBook({
      title: '书A',
      premise: '现实向前提A',
      seedCharacters: [{ name: '林晚' }],
    })
    const b = await store.createBook({
      title: '书B',
      premise: '现实向前提B',
    })
    const list = await store.listBooks()
    expect(list.map((item) => item.id).sort()).toEqual([a.id, b.id].sort())

    await store.upsertCharacter(a.id, {
      id: 'char-a',
      name: '只在A',
      status: 'alive',
      updatedAt: new Date().toISOString(),
    })
    expect(await store.listCharacters(b.id)).toHaveLength(0)
    expect((await store.listCharacters(a.id)).some((c) => c.name === '只在A')).toBe(true)
  })

  it('keeps canon unchanged until accept', async () => {
    const book = await store.createBook({ title: '草稿书', premise: '前提' })
    await store.saveDraft(book.id, {
      chapterNumber: 1,
      revision: 1,
      title: '第一章',
      content: '草稿正文',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    expect(await store.listCanon(book.id)).toHaveLength(0)
    expect(await store.getAcceptedChapter(book.id, 1)).toBeNull()

    const { chapter } = await store.acceptChapter({
      bookId: book.id,
      chapterNumber: 1,
      title: '第一章',
      content: '正式正文，种下伏笔。',
      diff: {
        canonCandidates: ['林晚住在旧公寓'],
        promises: [{ description: '未回的电话', action: 'plant' }],
        chapterSummary: '开篇介绍日常',
        endingHook: '电话又响了',
      },
    })

    expect(chapter.content).toContain('正式正文')
    expect(await store.listCanon(book.id)).toHaveLength(1)
    expect(await store.listOpenPromises(book.id)).toHaveLength(1)
    const meta = await store.getMeta(book.id)
    expect(meta.acceptedChapterCount).toBe(1)
    expect(meta.lastAcceptedChapter).toBe(1)
  })

  it('lists dormant promises and deletes book data', async () => {
    const book = await store.createBook({ title: '伏笔书', premise: '前提' })
    await store.acceptChapter({
      bookId: book.id,
      chapterNumber: 1,
      title: '一',
      content: '正文',
      diff: {
        promises: [{ description: '旧照片', action: 'plant' }],
        chapterSummary: '摘要',
      },
    })
    const dormant = await store.listDormantPromises(book.id, 5, 3)
    expect(dormant).toHaveLength(1)

    await expect(store.deleteBook(book.id)).resolves.toBe(true)
    expect(await store.listBooks()).toHaveLength(0)
  })
})
