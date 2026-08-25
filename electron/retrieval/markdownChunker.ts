export type MarkdownChunk = {
  chunkId: string
  content: string
  headingPath: string[]
  startOffset: number
  endOffset: number
}

export type MarkdownParentChunk = MarkdownChunk & {
  parentChunkId: string
}

export type MarkdownChildChunk = MarkdownChunk & {
  childChunkId: string
  parentChunkId: string
  parentStartOffset: number
  parentEndOffset: number
}

export type MarkdownParentChildChunks = {
  parents: MarkdownParentChunk[]
  children: MarkdownChildChunk[]
}

export const PARENT_MAX_CHARS = 1_200
export const PARENT_OVERLAP_CHARS = 120
export const CHILD_MAX_CHARS = 420
export const CHILD_OVERLAP_CHARS = 60

type Section = {
  headingPath: string[]
  body: string
  startOffset: number
}

type TextPart = {
  content: string
  startOffset: number
  endOffset: number
}

function trimPart(text: string, baseOffset: number): TextPart | null {
  const leading = text.search(/\S/)
  if (leading < 0) return null
  const trailing = text.length - text.trimEnd().length
  const content = text.slice(leading, text.length - trailing)
  return {
    content,
    startOffset: baseOffset + leading,
    endOffset: baseOffset + text.length - trailing,
  }
}

function splitAtParagraphs(text: string, baseOffset: number, maxChars: number, overlap: number): TextPart[] {
  const paragraphs: Array<{ text: string; start: number }> = []
  const paragraphPattern = /[^\n](?:.*?)(?=\n{2,}|$)/gs
  for (const match of text.matchAll(paragraphPattern)) {
    if (match.index === undefined) continue
    const part = trimPart(match[0], baseOffset + match.index)
    if (part) paragraphs.push({ text: part.content, start: part.startOffset })
  }
  if (paragraphs.length === 0) {
    const single = trimPart(text, baseOffset)
    return single ? [single] : []
  }

  const parts: TextPart[] = []
  let buffer = ''
  let bufferStart = 0
  const flush = () => {
    const part = trimPart(buffer, bufferStart)
    if (part) parts.push(part)
    buffer = ''
  }

  for (const paragraph of paragraphs) {
    const next = buffer ? `${buffer}\n\n${paragraph.text}` : paragraph.text
    if (next.length <= maxChars) {
      if (!buffer) bufferStart = paragraph.start
      buffer = next
      continue
    }
    flush()
    if (paragraph.text.length <= maxChars) {
      buffer = paragraph.text
      bufferStart = paragraph.start
      continue
    }

    let localStart = 0
    while (localStart < paragraph.text.length) {
      const localEnd = Math.min(paragraph.text.length, localStart + maxChars)
      const part = trimPart(paragraph.text.slice(localStart, localEnd), paragraph.start + localStart)
      if (part) parts.push(part)
      if (localEnd === paragraph.text.length) break
      localStart = Math.max(localEnd - overlap, localStart + 1)
    }
  }
  flush()
  return parts
}

function parseMarkdownSections(text: string): Section[] {
  const normalized = text.replace(/\r\n?/g, '\n')
  const sections: Section[] = []
  const lines = normalized.split('\n')
  const headings: string[] = []
  let bodyStart = 0
  let cursor = 0
  let bodyLines: string[] = []

  const flush = () => {
    const body = bodyLines.join('\n')
    const trimmed = trimPart(body, bodyStart)
    if (trimmed) {
      sections.push({
        headingPath: headings.filter((heading): heading is string => Boolean(heading)),
        body: trimmed.content,
        startOffset: trimmed.startOffset,
      })
    }
    bodyLines = []
  }

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (heading) {
      flush()
      const level = heading[1]!.length
      headings.length = level - 1
      headings[level - 1] = heading[2]!.trim()
      bodyStart = cursor + line.length + 1
    } else {
      bodyLines.push(line)
    }
    cursor += line.length + 1
  }
  flush()
  return sections
}

export function chunkMarkdownParentChild(documentId: string, text: string): MarkdownParentChildChunks {
  const parents: MarkdownParentChunk[] = []
  const children: MarkdownChildChunk[] = []
  let parentIndex = 0
  let childIndex = 0

  for (const section of parseMarkdownSections(text)) {
    const parentParts = splitAtParagraphs(
      section.body,
      section.startOffset,
      PARENT_MAX_CHARS,
      PARENT_OVERLAP_CHARS,
    )
    for (const parentPart of parentParts) {
      const parentChunkId = `${documentId}:p:${parentIndex}`
      const parent: MarkdownParentChunk = {
        chunkId: parentChunkId,
        parentChunkId,
        content: parentPart.content,
        headingPath: [...section.headingPath],
        startOffset: parentPart.startOffset,
        endOffset: parentPart.endOffset,
      }
      parents.push(parent)
      parentIndex += 1

      const childParts = splitAtParagraphs(
        parent.content,
        parent.startOffset,
        CHILD_MAX_CHARS,
        CHILD_OVERLAP_CHARS,
      )
      for (const childPart of childParts) {
        const childChunkId = `${documentId}:c:${childIndex}`
        children.push({
          chunkId: childChunkId,
          childChunkId,
          parentChunkId,
          content: childPart.content,
          headingPath: [...parent.headingPath],
          startOffset: childPart.startOffset,
          endOffset: childPart.endOffset,
          parentStartOffset: childPart.startOffset - parent.startOffset,
          parentEndOffset: childPart.endOffset - parent.startOffset,
        })
        childIndex += 1
      }
    }
  }
  return { parents, children }
}

/** 兼容小说索引等单层调用方；知识库应使用 chunkMarkdownParentChild。 */
export function chunkMarkdown(documentId: string, text: string): MarkdownChunk[] {
  return chunkMarkdownParentChild(documentId, text).parents
}
