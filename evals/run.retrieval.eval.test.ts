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

const useRealEmbedding =
  process.env.EVAL_REAL_EMBEDDING === '1' ||
  process.env.npm_lifecycle_event === 'eval:retrieval:real'

type KnowledgeCase = {
  id: string
  query: string
  relevantChunkSuffixes: string[]
  documentText: string
}

type MemoryCase = {
  id: string
  query: string
  relevantMemoryIds: string[]
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

function precisionAtK(retrieved: string[], relevant: Set<string>, k: number): number {
  const top = retrieved.slice(0, k)
  if (top.length === 0) return 0
  const hits = top.filter((id) => relevant.has(id)).length
  return hits / top.length
}

function recallAtK(retrieved: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 0
  const top = retrieved.slice(0, k)
  const hits = top.filter((id) => relevant.has(id)).length
  return hits / relevant.size
}

function mrrAtK(retrieved: string[], relevant: Set<string>, k: number): number {
  const top = retrieved.slice(0, k)
  for (let index = 0; index < top.length; index += 1) {
    const id = top[index]
    if (id && relevant.has(id)) return 1 / (index + 1)
  }
  return 0
}

beforeEach(() => {
  if (useRealEmbedding) {
    resetEmbeddingPipelineForTests()
  } else {
    installMockEmbeddingPipeline()
  }
})

describe('retrieval IR eval', () => {
  it(`输出 P@4、R@4、MRR@10 汇总（知识库 + 记忆）${useRealEmbedding ? ' [REAL_EMBEDDING]' : ' [MOCK_EMBEDDING]'}`, async () => {
    const raw = await readFile(datasetPath, 'utf8')
    const dataset = JSON.parse(raw) as RetrievalDataset
    expect(dataset.knowledge.length + dataset.memory.length).toBeGreaterThanOrEqual(15)

    const knowledgeScores = {
      p4: [] as number[],
      r4: [] as number[],
      mrr10: [] as number[],
    }
    const memoryScores = {
      p4: [] as number[],
      r4: [] as number[],
      mrr10: [] as number[],
    }

    for (const item of dataset.knowledge) {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'pet-ir-knowledge-'))
      try {
        const store = new KnowledgeStore(directory)
        await store.initialize()
        const doc = await store.importText(item.id, item.documentText, `${item.id}.md`)
        const relevant = new Set(
          item.relevantChunkSuffixes.map((suffix) => `${doc.id}${suffix}`),
        )
        const hits = await store.search(item.query, 10)
        const retrieved = hits.map((hit) => hit.chunkId)
        knowledgeScores.p4.push(precisionAtK(retrieved, relevant, 4))
        knowledgeScores.r4.push(recallAtK(retrieved, relevant, 4))
        knowledgeScores.mrr10.push(mrrAtK(retrieved, relevant, 10))
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
        const relevant = new Set(item.relevantMemoryIds)
        memoryScores.p4.push(precisionAtK(retrieved, relevant, 4))
        memoryScores.r4.push(recallAtK(retrieved, relevant, 4))
        memoryScores.mrr10.push(mrrAtK(retrieved, relevant, 10))

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
        MRR_at_10: avg(knowledgeScores.mrr10),
      },
      memory: {
        count: memoryScores.p4.length,
        P_at_4: avg(memoryScores.p4),
        R_at_4: avg(memoryScores.r4),
        MRR_at_10: avg(memoryScores.mrr10),
      },
    }

    console.log('[retrieval-eval]', JSON.stringify(summary, null, 2))
    expect(summary.mode).toBe(useRealEmbedding ? 'real_embedding' : 'mock_embedding')
    expect(summary.knowledge.P_at_4).toBeGreaterThan(0)
    expect(summary.memory.P_at_4).toBeGreaterThan(0)
  }, useRealEmbedding ? 120_000 : 30_000)
})
