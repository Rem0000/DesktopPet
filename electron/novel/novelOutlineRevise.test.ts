import { describe, expect, it } from 'vitest'
import { NovelService, NovelServiceError } from './novelService'
import { NovelStoryStore } from './novelStoryStore'
import type { BookOutline } from '../../src/novel/contracts'
import type { NovelLlm } from './novelRuntime'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach } from 'vitest'

describe('NovelService outline revise', () => {
  let tempRoot = ''
  let store: NovelStoryStore

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novel-revise-'))
    store = new NovelStoryStore(tempRoot)
    await store.initialize()
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('rejects revise without guidance or empty outline', async () => {
    const book = await store.createBook({ title: '书', premise: '前提' })
    const llm: NovelLlm = {
      streamText: async () => '',
      completeText: async () => '{"volumes":[]}',
    }
    const service = new NovelService(store, () => ({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKey: 'k',
    }), llm)

    await expect(service.reviseOutline(book.id, '  ')).rejects.toBeInstanceOf(
      NovelServiceError,
    )
    await expect(service.reviseOutline(book.id, '加强冲突')).rejects.toBeInstanceOf(
      NovelServiceError,
    )
  })

  it('revises full outline via llm and keeps structure usable', async () => {
    const book = await store.createBook({ title: '书', premise: '前提' })
    const current: BookOutline = {
      version: 1,
      locked: false,
      updatedAt: new Date().toISOString(),
      volumes: [
        {
          id: 'v1',
          title: '第一卷',
          order: 1,
          chapters: [
            {
              id: 'c1',
              chapterNumber: 1,
              title: '开端',
              beatSummary: '旧电话响起',
            },
          ],
        },
      ],
    }
    const llm: NovelLlm = {
      streamText: async () => '',
      completeText: async () =>
        JSON.stringify({
          volumes: [
            {
              id: 'v1',
              title: '第一卷',
              order: 1,
              chapters: [
                {
                  id: 'c1',
                  chapterNumber: 1,
                  title: '开端·改',
                  beatSummary: '电话未接，秘密加深',
                  conflict: '要不要回拨',
                },
              ],
            },
          ],
        }),
    }
    const service = new NovelService(store, () => ({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKey: 'k',
    }), llm)

    const result = await service.reviseOutline(book.id, '强化秘密感', current)
    expect(result.draft.volumes[0]?.chapters[0]?.title).toContain('开端')
    expect(result.draft.volumes[0]?.chapters[0]?.beatSummary).toContain('秘密')
  })
})
