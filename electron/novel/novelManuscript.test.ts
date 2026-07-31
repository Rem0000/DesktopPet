import { describe, expect, it } from 'vitest'
import {
  buildManuscriptMarkdown,
  markdownToSimpleHtml,
} from './novelManuscript'
import type { BookMeta, NovelManuscriptChapter } from '../../src/novel/contracts'

describe('novelManuscript', () => {
  const meta: BookMeta = {
    id: 'b1',
    title: '旧电话',
    genre: 'realistic',
    premise: '一通未接来电改变夏天',
    themes: ['家庭', '秘密'],
    era: '当代',
    createdAt: '',
    updatedAt: '',
    acceptedChapterCount: 2,
  }

  const chapters: NovelManuscriptChapter[] = [
    {
      chapterNumber: 1,
      title: '开端',
      content: '林晚站在门口。\n电话响了。',
      acceptedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      chapterNumber: 2,
      title: '回拨',
      content: '她按下了绿色按钮。',
      acceptedAt: '2026-01-02T00:00:00.000Z',
    },
  ]

  it('builds continuous markdown from accepted chapters', () => {
    const md = buildManuscriptMarkdown(meta, chapters)
    expect(md).toContain('# 旧电话')
    expect(md).toContain('## 第 1 章 开端')
    expect(md).toContain('## 第 2 章 回拨')
    expect(md).toContain('林晚站在门口。')
  })

  it('converts markdown headings for html/pdf', () => {
    const html = markdownToSimpleHtml('# 标题\n\n段落一行')
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<p>段落一行</p>')
  })
})
