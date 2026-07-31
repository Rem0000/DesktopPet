import type {
  BookMeta,
  NovelManuscript,
  NovelManuscriptChapter,
} from '../../src/novel/contracts'
import type { NovelStoryStore } from './novelStoryStore'

function countChars(text: string): number {
  return text.replace(/\s+/g, '').length
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 极简 Markdown → HTML（标题/段落/换行），供预览与 PDF */
export function markdownToSimpleHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const parts: string[] = []
  let paragraph: string[] = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    parts.push(`<p>${paragraph.join('<br/>')}</p>`)
    paragraph = []
  }

  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading) {
      flushParagraph()
      const level = heading[1]!.length
      parts.push(`<h${level}>${escapeHtml(heading[2]!.trim())}</h${level}>`)
      continue
    }
    if (!line.trim()) {
      flushParagraph()
      continue
    }
    paragraph.push(escapeHtml(line))
  }
  flushParagraph()
  return parts.join('\n')
}

export function buildManuscriptMarkdown(
  meta: BookMeta,
  chapters: NovelManuscriptChapter[],
): string {
  const blocks: string[] = [`# ${meta.title}`, '']
  if (meta.premise) {
    blocks.push(`> ${meta.premise}`, '')
  }
  if (meta.themes.length) {
    blocks.push(`主题：${meta.themes.join('、')}`)
  }
  if (meta.era) {
    blocks.push(`时代：${meta.era}`)
  }
  if (meta.themes.length || meta.era) blocks.push('')
  blocks.push('---', '')

  for (const chapter of chapters) {
    blocks.push(`## 第 ${chapter.chapterNumber} 章 ${chapter.title}`.trim(), '')
    blocks.push(chapter.content.trim(), '', '---', '')
  }

  return `${blocks.join('\n').trim()}\n`
}

export function buildManuscriptHtmlDocument(manuscript: NovelManuscript): string {
  const body = markdownToSimpleHtml(manuscript.markdown)
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(manuscript.title)}</title>
  <style>
    @page { margin: 22mm 18mm; }
    body {
      font-family: "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;
      line-height: 1.85;
      color: #222;
      max-width: 720px;
      margin: 0 auto;
      padding: 24px 16px 48px;
      font-size: 15px;
    }
    h1 { font-size: 28px; margin: 0 0 12px; }
    h2 { font-size: 20px; margin: 36px 0 14px; page-break-before: always; }
    h2:first-of-type { page-break-before: avoid; }
    h3 { font-size: 17px; margin: 24px 0 10px; }
    p { margin: 0 0 12px; text-align: justify; }
    blockquote {
      margin: 0 0 16px;
      padding-left: 12px;
      border-left: 3px solid #c49a6c;
      color: #555;
    }
    .meta { color: #666; font-size: 13px; margin-bottom: 24px; }
  </style>
</head>
<body>
  <div class="meta">共 ${manuscript.chapterCount} 章 · 约 ${manuscript.wordCount} 字 · 生成于 ${escapeHtml(manuscript.generatedAt)}</div>
  ${body}
</body>
</html>`
}

export async function buildManuscriptFromStore(
  store: NovelStoryStore,
  bookId: string,
): Promise<NovelManuscript> {
  const meta = await store.getMeta(bookId)
  const accepted = await store.listAcceptedChapterSummaries(bookId)
  const chapters: NovelManuscriptChapter[] = []

  for (const item of accepted) {
    const chapter = await store.getAcceptedChapter(bookId, item.chapterNumber)
    if (!chapter) continue
    chapters.push({
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      content: chapter.content,
      acceptedAt: chapter.acceptedAt,
    })
  }

  const markdown = buildManuscriptMarkdown(meta, chapters)
  return {
    bookId,
    title: meta.title,
    premise: meta.premise,
    chapterCount: chapters.length,
    wordCount: countChars(chapters.map((item) => item.content).join('')),
    chapters,
    markdown,
    generatedAt: new Date().toISOString(),
  }
}
