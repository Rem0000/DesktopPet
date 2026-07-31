import { describe, expect, it } from 'vitest'
import { defaultToolRegistry } from '../chat/toolRegistry'
import { assembleChapterContext, runContinuityGuard } from './novelRuntime'

describe('novel isolation and continuity helpers', () => {
  it('chat tool registry has no novel writing tools', () => {
    const names = defaultToolRegistry.listMeta().map((item) => item.name)
    expect(names.some((name) => name.startsWith('novel_'))).toBe(false)
    expect(names).not.toContain('write_chapter')
    expect(names).not.toContain('accept_chapter')
    expect(names).not.toContain('generate_outline')
  })

  it('assemble prefers fixed open promises', () => {
    const assembled = assembleChapterContext({
      meta: {
        id: 'b1',
        title: '测试',
        genre: 'realistic',
        premise: '都市家庭',
        themes: ['秘密'],
        createdAt: '',
        updatedAt: '',
        acceptedChapterCount: 1,
      },
      chapterNumber: 2,
      characters: [
        {
          id: 'c1',
          name: '林晚',
          status: 'alive',
          voiceSamples: ['你又熬夜了。'],
          updatedAt: '',
        },
      ],
      openPromises: [
        {
          id: 'p1',
          description: '未回的电话',
          status: 'planted',
          plantedChapter: 1,
          lastTouchedChapter: 1,
          updatedAt: '',
        },
      ],
      endingHook: '电话又响了',
      canonTexts: ['林晚住在旧公寓'],
      retrievalHits: [],
    })
    expect(assembled.fixedBlock).toContain('未回的电话')
    expect(assembled.fixedBlock).toContain('你又熬夜了。')
  })

  it('guard flags dead character appearance', () => {
    const warnings = runContinuityGuard({
      draft: '林晚走进了客厅。',
      characters: [
        {
          id: 'c1',
          name: '林晚',
          status: 'dead',
          updatedAt: '',
        },
      ],
      knowledge: [],
      openPromises: [],
    })
    expect(warnings.some((item) => item.code === 'dead_character')).toBe(true)
  })
})
