import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { KnowledgeStore } from '../electron/chat/knowledgeStore'
import { retrieveMemories } from '../electron/chat/memoryService'
import type { MemoryItem } from '../src/chat/contracts'
import { hybridSearch } from '../electron/retrieval/hybridSearch'
import {
  installMockEmbeddingPipeline,
  resetEmbeddingPipelineForTests,
} from '../electron/retrieval/testHelpers'
import { VectorStore } from '../electron/retrieval/vectorStore'
import {
  mrrAtK,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  relevantSet,
} from './retrieval/metrics'

const useRealEmbedding =
  process.env.EVAL_REAL_EMBEDDING === '1' ||
  process.env.npm_lifecycle_event === 'eval:retrieval:real'

type KnowledgeCase = {
  id: string
  query: string
  /** 分级相关性：chunkId 后缀（如 ":1"）→ 相关等级 1–3，缺省为 0（不相关） */
  relevantChunkGraded?: Record<string, number>
  /** 二值兜底（旧数据集）：相关 chunk 后缀列表，等价于 grade=1 */
  relevantChunkSuffixes?: string[]
  documentText: string
}

type MemoryCase = {
  id: string
  query: string
  /** 分级相关性：记忆 id → 相关等级 1–3 */
  relevantMemoryGraded?: Record<string, number>
  /** 二值兜底（旧数据集）：相关记忆 id 列表 */
  relevantMemoryIds?: string[]
  memories: Array<{
    id: string
    content: string
    key?: string
    importance?: number
    type?: MemoryItem['type']
    pinned?: boolean
  }>
}

type RetrievalDataset = {
  version: number
  knowledge: KnowledgeCase[]
  memory: MemoryCase[]
}

const root = path.dirname(fileURLToPath(import.meta.url))
const datasetPath = path.join(root, 'retrieval', 'queries.json')

/** 优先用分级相关性；缺失时退化为二值（grade=1）。prefix 拼接用于知识库 chunkId。 */
function gradedFromSuffixes(
  graded: Record<string, number> | undefined,
  binary: string[] | undefined,
  prefix: string,
): Map<string, number> {
  const map = new Map<string, number>()
  if (graded) {
    for (const [suffix, rel] of Object.entries(graded)) map.set(`${prefix}${suffix}`, rel)
  } else {
    for (const suffix of binary ?? []) map.set(`${prefix}${suffix}`, 1)
  }
  return map
}

beforeEach(() => {
  if (useRealEmbedding) {
    resetEmbeddingPipelineForTests()
  } else {
    installMockEmbeddingPipeline()
  }
})

describe('retrieval IR eval', () => {
  it(`输出 P@4、R@4、R@10、MRR@10、NDCG@10 汇总（知识库 + 记忆）${useRealEmbedding ? ' [REAL_EMBEDDING]' : ' [MOCK_EMBEDDING]'}`, async () => {
    const raw = await readFile(datasetPath, 'utf8')
    const dataset = JSON.parse(raw) as RetrievalDataset
    expect(dataset.knowledge.length + dataset.memory.length).toBeGreaterThanOrEqual(15)

    const knowledgeScores = {
      p4: [] as number[],
      r4: [] as number[],
      r10: [] as number[],
      mrr10: [] as number[],
      ndcg10: [] as number[],
    }
    const memoryScores = {
      p4: [] as number[],
      r4: [] as number[],
      r10: [] as number[],
      mrr10: [] as number[],
      ndcg10: [] as number[],
    }

    for (const item of dataset.knowledge) {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'pet-ir-knowledge-'))
      try {
        const store = new KnowledgeStore(directory)
        await store.initialize()
        const doc = await store.importText(item.id, item.documentText, `${item.id}.md`)
        const grade = gradedFromSuffixes(
          item.relevantChunkGraded,
          item.relevantChunkSuffixes,
          `${doc.id}`,
        )
        const relevant = relevantSet(grade)
        const hits = await store.search(item.query, 10)
        const retrieved = hits.map((hit) => hit.chunkId)
        knowledgeScores.p4.push(precisionAtK(retrieved, relevant, 4))
        knowledgeScores.r4.push(recallAtK(retrieved, relevant, 4))
        knowledgeScores.r10.push(recallAtK(retrieved, relevant, 10))
        knowledgeScores.mrr10.push(mrrAtK(retrieved, relevant, 10))
        knowledgeScores.ndcg10.push(ndcgAtK(retrieved, grade, 10))
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }

    for (const item of dataset.memory) {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'pet-ir-memory-'))
      try {
        const vectorStore = new VectorStore(path.join(directory, 'vectors.json'))
        await vectorStore.initialize()
        const now = new Date('2026-07-27T00:00:00.000Z')
        const memories: MemoryItem[] = item.memories.map((memory) => ({
          id: memory.id,
          type: memory.type ?? 'fact',
          content: memory.content,
          key: memory.key,
          importance: (memory.importance ?? 2) as MemoryItem['importance'],
          pinned: memory.pinned,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        }))
        const corpus = memories.map((memory) => ({
          id: memory.id,
          text: `${memory.key ?? ''} ${memory.content}`,
        }))
        const { embedQuery, embedTexts } = await import('../electron/retrieval/embeddingService')
        const vectors = await embedTexts(corpus.map((entry) => entry.text))
        for (let index = 0; index < corpus.length; index += 1) {
          const entry = corpus[index]
          const vector = vectors[index]
          if (entry && vector) await vectorStore.upsert(entry.id, vector)
        }
        const hits = await hybridSearch(item.query, corpus, {
          topK: 10,
          embedQuery,
          getVector: (id) => vectorStore.get(id),
        })
        const retrieved = hits.map((hit) => hit.id)
        const grade = new Map<string, number>(
          Object.entries(item.relevantMemoryGraded ?? {}).map(([id, rel]) => [id, rel]),
        )
        if (grade.size === 0) {
          for (const id of item.relevantMemoryIds ?? []) grade.set(id, 1)
        }
        const relevant = relevantSet(grade)
        memoryScores.p4.push(precisionAtK(retrieved, relevant, 4))
        memoryScores.r4.push(recallAtK(retrieved, relevant, 4))
        memoryScores.r10.push(recallAtK(retrieved, relevant, 10))
        memoryScores.mrr10.push(mrrAtK(retrieved, relevant, 10))
        memoryScores.ndcg10.push(ndcgAtK(retrieved, grade, 10))

        const viaService = await retrieveMemories(
          memories,
          item.query,
          10,
          now,
          (id) => vectorStore.get(id),
        )
        expect(viaService.length).toBeGreaterThan(0)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }

    const avg = (values: number[]) =>
      values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length

    const summary = {
      mode: useRealEmbedding ? 'real_embedding' : 'mock_embedding',
      knowledge: {
        count: knowledgeScores.p4.length,
        P_at_4: avg(knowledgeScores.p4),
        R_at_4: avg(knowledgeScores.r4),
        R_at_10: avg(knowledgeScores.r10),
        MRR_at_10: avg(knowledgeScores.mrr10),
        NDCG_at_10: avg(knowledgeScores.ndcg10),
      },
      memory: {
        count: memoryScores.p4.length,
        P_at_4: avg(memoryScores.p4),
        R_at_4: avg(memoryScores.r4),
        R_at_10: avg(memoryScores.r10),
        MRR_at_10: avg(memoryScores.mrr10),
        NDCG_at_10: avg(memoryScores.ndcg10),
      },
    }

    console.log('[retrieval-eval]', JSON.stringify(summary, null, 2))
    expect(summary.mode).toBe(useRealEmbedding ? 'real_embedding' : 'mock_embedding')
    expect(summary.knowledge.P_at_4).toBeGreaterThan(0)
    expect(summary.memory.P_at_4).toBeGreaterThan(0)
    expect(summary.knowledge.NDCG_at_10).toBeGreaterThan(0)
    expect(summary.memory.NDCG_at_10).toBeGreaterThan(0)
  }, useRealEmbedding ? 120_000 : 30_000)
})
