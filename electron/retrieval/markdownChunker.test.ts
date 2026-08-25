import { describe, expect, it } from 'vitest'
import {
  CHILD_MAX_CHARS,
  chunkMarkdownParentChild,
  PARENT_MAX_CHARS,
} from './markdownChunker'

describe('chunkMarkdownParentChild', () => {
  it('按标题生成父块和子块，并保持一对多关联', () => {
    const result = chunkMarkdownParentChild(
      'doc',
      '# 项目\n\n引言。\n\n## 检索\n\n子块负责精确命中。\n\n## 记忆\n\n记忆与知识库隔离。',
    )
    expect(result.parents.map((chunk) => chunk.headingPath)).toEqual([
      ['项目'],
      ['项目', '检索'],
      ['项目', '记忆'],
    ])
    expect(result.children.length).toBe(result.parents.length)
    for (const child of result.children) {
      const parent = result.parents.find((item) => item.parentChunkId === child.parentChunkId)
      expect(parent).toBeTruthy()
      expect(child.childChunkId).toBe(child.chunkId)
      expect(child.startOffset).toBeGreaterThanOrEqual(parent!.startOffset)
      expect(child.endOffset).toBeLessThanOrEqual(parent!.endOffset)
    }
  })

  it('超长段落按限制和 overlap 切分，且 ID 稳定', () => {
    const text = `# 长文\n\n${'甲'.repeat(PARENT_MAX_CHARS + 200)}`
    const first = chunkMarkdownParentChild('doc', text)
    const second = chunkMarkdownParentChild('doc', text)
    expect(first).toEqual(second)
    expect(first.parents.length).toBeGreaterThan(1)
    expect(first.children.length).toBeGreaterThan(first.parents.length)
    expect(first.parents.every((chunk) => chunk.content.length <= PARENT_MAX_CHARS)).toBe(true)
    expect(first.children.every((chunk) => chunk.content.length <= CHILD_MAX_CHARS)).toBe(true)
    expect(first.children.every((chunk) => chunk.parentChunkId.startsWith('doc:p:'))).toBe(true)
  })

  it('不会生成孤儿子块或重复 ID', () => {
    const result = chunkMarkdownParentChild('stable', '普通段落\n\n第二段落')
    const parentIds = new Set(result.parents.map((chunk) => chunk.parentChunkId))
    expect(new Set(result.parents.map((chunk) => chunk.chunkId)).size).toBe(result.parents.length)
    expect(new Set(result.children.map((chunk) => chunk.childChunkId)).size).toBe(result.children.length)
    expect(result.children.every((chunk) => parentIds.has(chunk.parentChunkId))).toBe(true)
  })
})
