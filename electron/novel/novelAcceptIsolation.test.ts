import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NovelStoryStore } from './novelStoryStore'

/**
 * Accept 只写 novels 树；本测试用并列的假 memory 目录证明不会被触碰。
 */
describe('novel accept does not touch chat memory files', () => {
  let tempRoot = ''
  let novelsDir = ''
  let memoryFile = ''

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-iso-'))
    novelsDir = path.join(tempRoot, 'novels')
    memoryFile = path.join(tempRoot, 'memory', 'memory-data.json')
    await import('node:fs/promises').then(({ mkdir, writeFile }) =>
      Promise.all([
        mkdir(path.dirname(memoryFile), { recursive: true }),
        mkdir(novelsDir, { recursive: true }),
        writeFile(memoryFile, '{"version":1,"items":[],"summaries":[]}\n', 'utf8'),
      ]),
    )
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('accept chapter leaves sibling memory-data.json unchanged', async () => {
    const before = await readFile(memoryFile, 'utf8')
    const store = new NovelStoryStore(novelsDir)
    await store.initialize()
    const book = await store.createBook({ title: '隔离书', premise: '前提' })
    await store.acceptChapter({
      bookId: book.id,
      chapterNumber: 1,
      title: '一',
      content: '正文',
      diff: {
        canonCandidates: ['事实A'],
        chapterSummary: '摘要',
      },
    })
    const after = await readFile(memoryFile, 'utf8')
    expect(after).toBe(before)
    const canon = await store.listCanon(book.id)
    expect(canon).toHaveLength(1)
  })
})
