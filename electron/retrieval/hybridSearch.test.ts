import { describe, expect, it } from 'vitest'
import { Bm25Index } from './bm25Index'
import { hybridSearch } from './hybridSearch'
import { installMockEmbeddingPipeline } from './testHelpers'

describe('hybridSearch', () => {
  it('融合稀疏与向量召回并返回来源标记', async () => {
    installMockEmbeddingPipeline()
    const corpus = [
      { id: 'a', text: '秋招智能体路线 本地知识库 RAG' },
      { id: 'b', text: 'Live2D 导入与动作播放' },
      { id: 'c', text: '番茄钟不在本期范围' },
    ]
    const vectors = new Map<string, number[]>([
      ['a', [0.9, 0.1, 0, 0, 0, 0, 0, 0]],
      ['b', [0.1, 0.9, 0, 0, 0, 0, 0, 0]],
      ['c', [0, 0, 0.9, 0.1, 0, 0, 0, 0]],
    ])

    const hits = await hybridSearch('秋招路线 RAG', corpus, {
      topK: 2,
      embedQuery: async () => [0.85, 0.15, 0, 0, 0, 0, 0, 0],
      getVector: (id) => vectors.get(id),
    })

    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]?.id).toBe('a')
    expect(['sparse', 'vector', 'both']).toContain(hits[0]?.recallSource)
  })
})

describe('Bm25Index', () => {
  it('中文 n-gram 增强可命中部分重合', () => {
    const index = new Bm25Index()
    index.build([
      { id: '1', text: '秋招智能体路线包含本地知识库 RAG' },
      { id: '2', text: '无关内容' },
    ])
    const hits = index.search('秋招路线', 2)
    expect(hits[0]?.id).toBe('1')
  })
})
