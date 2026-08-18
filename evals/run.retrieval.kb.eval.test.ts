import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { KnowledgeStore } from '../electron/chat/knowledgeStore'
import { ensureEmbeddingModelLoaded } from '../electron/retrieval/embeddingService'
import {
  mrrAtK,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  relevantSet,
} from './retrieval/metrics'

/**
 * 真实知识库检索 IR 评测：以 data/knowledge 全库（4 文档 / 292 chunk）为统一语料，
 * 跑 evals/retrieval/queries.real.json（人工核心）+ queries.llm.json（LLM 补量，如有）。
 *
 * 语料向量是真实 BGE 生成的，查询向量也必须是真实 BGE，因此本评测固定 real embedding。
 * 仅通过 `npm run eval:retrieval:kb` 真正执行；普通 `npm test` 会命中但跳过，避免拖慢默认套件。
 */
const root = path.dirname(fileURLToPath(import.meta.url))
const kbDir = path.resolve(process.cwd(), 'data/knowledge')
const corePath = path.join(root, 'retrieval', 'queries.real.json')
const llmPath = path.join(root, 'retrieval', 'queries.llm.json')

const isKbRun = process.env.npm_lifecycle_event === 'eval:retrieval:kb'

type RealQuery = {
  id: string
  query: string
  relevantChunkGraded: Record<string, number>
}
type RealDataset = {
  documents: Record<string, string>
  knowledge: RealQuery[]
}

/** 把 "mysql:1" 解析成真实 chunkId "uuid:1" */
function resolveKey(key: string, documents: Record<string, string>): string {
  const sep = key.lastIndexOf(':')
  if (sep < 0) throw new Error(`chunk key 非法：${key}`)
  const short = key.slice(0, sep)
  const index = key.slice(sep + 1)
  const uuid = documents[short]
  if (!uuid) throw new Error(`未知文档别名：${short}`)
  return `${uuid}:${index}`
}

const avg = (values: number[]) =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length

describe('真实知识库检索 IR 评测（全库语料）', () => {
  it('加载 data/knowledge，输出 P@4/R@4/R@10/MRR@10/NDCG@10', async () => {
    if (!isKbRun) {
      console.log('[retrieval-kb-eval] 未通过 npm run eval:retrieval:kb 运行，跳过')
      return
    }

    const core = JSON.parse(await readFile(corePath, 'utf8')) as RealDataset
    let llmQueries: RealQuery[] = []
    try {
      const llm = JSON.parse(await readFile(llmPath, 'utf8')) as RealDataset
      llmQueries = llm.knowledge ?? []
    } catch {
      // queries.llm.json 未生成则只跑人工核心
    }
    const queries = [...core.knowledge, ...llmQueries]

    const store = new KnowledgeStore(kbDir)
    await store.initialize()
    const docs = store.listDocuments()
    const docIds = new Set(docs.map((d) => d.id))
    for (const [short, uuid] of Object.entries(core.documents)) {
      expect(
        docIds.has(uuid),
        `知识库缺少文档 ${short}(${uuid})：请保持 data/knowledge 为构建评测集时的快照`,
      ).toBe(true)
    }
    const idx = JSON.parse(
      await readFile(path.join(kbDir, 'index.json'), 'utf8'),
    ) as { chunks: Array<{ chunkId: string }> }

    // 库内向量是真实 embedding，查询向量必须同源
    await ensureEmbeddingModelLoaded()

    const scores = {
      p4: [] as number[],
      r4: [] as number[],
      r10: [] as number[],
      mrr10: [] as number[],
      ndcg10: [] as number[],
    }
    for (const q of queries) {
      const grade = new Map<string, number>()
      for (const [key, rel] of Object.entries(q.relevantChunkGraded)) {
        grade.set(resolveKey(key, core.documents), rel)
      }
      const relevant = relevantSet(grade)
      const hits = await store.search(q.query, 10)
      const retrieved = hits.map((hit) => hit.chunkId)
      scores.p4.push(precisionAtK(retrieved, relevant, 4))
      scores.r4.push(recallAtK(retrieved, relevant, 4))
      scores.r10.push(recallAtK(retrieved, relevant, 10))
      scores.mrr10.push(mrrAtK(retrieved, relevant, 10))
      scores.ndcg10.push(ndcgAtK(retrieved, grade, 10))
    }

    const summary = {
      mode: 'real_embedding',
      corpus: { documents: docs.length, chunks: idx.chunks.length },
      queries: { core: core.knowledge.length, llm: llmQueries.length, total: queries.length },
      P_at_4: avg(scores.p4),
      R_at_4: avg(scores.r4),
      R_at_10: avg(scores.r10),
      MRR_at_10: avg(scores.mrr10),
      NDCG_at_10: avg(scores.ndcg10),
    }
    console.log('[retrieval-kb-eval]', JSON.stringify(summary, null, 2))

    expect(summary.P_at_4).toBeGreaterThan(0)
    expect(summary.R_at_10).toBeGreaterThan(0)
    expect(summary.NDCG_at_10).toBeGreaterThan(0)
  }, 180_000)
})
