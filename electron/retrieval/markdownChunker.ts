export type MarkdownChunk = {
  chunkId: string
  content: string
  headingPath: string[]
  startOffset: number
  endOffset: number
}

const MAX_SECTION_CHARS = 800
const OVERLAP_CHARS = 80

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function splitLongText(text: string): string[] {
  if (text.length <= MAX_SECTION_CHARS) return [text]
  const parts: string[] = []
  const paragraphs = splitParagraphs(text)
  let buffer = ''
  for (const paragraph of paragraphs) {
    if (`${buffer}\n\n${paragraph}`.trim().length <= MAX_SECTION_CHARS) {
      buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph
      continue
    }
    if (buffer) {
      parts.push(buffer)
      buffer = ''
    }
    if (paragraph.length <= MAX_SECTION_CHARS) {
      buffer = paragraph
      continue
    }
    let start = 0
    while (start < paragraph.length) {
      const end = Math.min(paragraph.length, start + MAX_SECTION_CHARS)
      parts.push(paragraph.slice(start, end).trim())
      if (end >= paragraph.length) break
      start = Math.max(end - OVERLAP_CHARS, start + 1)
    }
  }
  if (buffer) parts.push(buffer)
  return parts
}

type Section = {
  headingPath: string[]
  body: string
  startOffset: number
}

function parseMarkdownSections(text: string): Section[] {
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const sections: Section[] = []
  let headingPath: string[] = []
  let bodyLines: string[] = []
  let sectionStart = 0
  let cursor = 0

  const flush = () => {
    const body = bodyLines.join('\n').trim()
    if (body) {
      sections.push({
        headingPath: [...headingPath],
        body,
        startOffset: sectionStart,
      })
    }
    bodyLines = []
  }

  for (const line of lines) {
    const headingMatch = /^(#{1,3})\s+(.+?)\s*$/.exec(line)
    if (headingMatch) {
      flush()
      const level = headingMatch[1]?.length ?? 1
      const title = headingMatch[2]?.trim() ?? ''
      headingPath = headingPath.slice(0, level - 1)
      headingPath[level - 1] = title
      sectionStart = cursor
      cursor += line.length + 1
      continue
    }
    bodyLines.push(line)
    cursor += line.length + 1
  }
  flush()

  if (sections.length === 0 && normalized.trim()) {
    sections.push({ headingPath: [], body: normalized.trim(), startOffset: 0 })
  }
  return sections
}

export function chunkMarkdown(documentId: string, text: string): MarkdownChunk[] {
  const sections = parseMarkdownSections(text)
  const chunks: MarkdownChunk[] = []
  let index = 0

  for (const section of sections) {
    const parts = splitLongText(section.body)
    let localOffset = section.startOffset
    for (const part of parts) {
      chunks.push({
        chunkId: `${documentId}:${index}`,
        content: part,
        headingPath: section.headingPath,
        startOffset: localOffset,
        endOffset: localOffset + part.length,
      })
      index += 1
      localOffset += Math.max(part.length - OVERLAP_CHARS, 1)
    }
  }
  return chunks
}
