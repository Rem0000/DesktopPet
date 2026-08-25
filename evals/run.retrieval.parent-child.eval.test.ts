import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ensureEmbeddingModelLoaded } from '../electron/retrieval/embeddingService'
import {
  average,
  buildRetrievalEvaluationReport,
  createBenchmarkCorpus,
  disposeBenchmarkCorpus,
  loadEvidenceDataset,
  mapEvidenceToChunks,
  scoreEvidenceQuery,
  writeRetrievalEvaluationReport,
} from './retrieval/evidenceBenchmark'

const root = path.dirname(fileURLToPath(import.meta.url))
const datasetPath = path.join(root, 'retrieval', 'independent', 'parent-child-rag.v1.json')
const reportPath = path.join(root, 'retrieval', 'independent', 'reports', 'parent-child-rag.v1.report.json')
const isBenchmarkRun = process.env.npm_lifecycle_event === 'eval:retrieval:parent-child'

const round = (value: number) => Number(value.toFixed(6))

describe('独立父子 RAG 真实 BGE 检索评测', () => {
  it('使用本地真实 BGE 输出 Recall@K 与 MRR@K 报告', async () => {
    if (!isBenchmarkRun) {
      console.log('[retrieval-parent-child-eval] 未通过 npm run eval:retrieval:parent-child 运行，跳过')
      return
    }

    const dataset = await loadEvidenceDataset(datasetPath)
    await ensureEmbeddingModelLoaded({ localOnly: true })
    const corpus = await createBenchmarkCorpus(dataset, path.dirname(datasetPath))
    try {
      const parents = corpus.store.listParentChunks()
      const children = corpus.store.listChildChunks()
      const mapping = mapEvidenceToChunks(dataset, parents, corpus.documentIds)
      const scores = []
      for (const query of dataset.queries) {
        const hits = await corpus.store.search(query.query, dataset.topK)
        scores.push(scoreEvidenceQuery(query, hits, mapping, dataset.topK))
      }
      const report = buildRetrievalEvaluationReport({
        benchmark: 'parent-child-rag.v1',
        dataset,
        scores,
        mapping,
        parentChunks: parents.length,
        childChunks: children.length,
        generatedAt: new Date().toISOString(),
      })
      await writeRetrievalEvaluationReport(reportPath, report)
      console.log('[retrieval-parent-child-eval]', JSON.stringify(report, null, 2))

      expect(report.evidence.mappingSuccessRate).toBe(1)
      expect(report.metrics.evidenceRecallAtK).toBeGreaterThan(0)
      expect(report.metrics.requiredEvidenceRecallAtK).toBeGreaterThan(0)
      expect(report.metrics.requiredEvidenceMrrAtK).toBeGreaterThan(0)
      expect(average(scores.map((score) => score.requiredEvidenceMrr))).toBe(report.metrics.requiredEvidenceMrrAtK)
      expect(round(report.metrics.requiredEvidenceMrrAtK)).toBe(report.metrics.requiredEvidenceMrrAtK)
    } finally {
      await disposeBenchmarkCorpus(corpus)
    }
  }, 600_000)
})
