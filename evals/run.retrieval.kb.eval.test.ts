import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ensureEmbeddingModelLoaded } from '../electron/retrieval/embeddingService'
import {
  average,
  createBenchmarkCorpus,
  disposeBenchmarkCorpus,
  loadEvidenceDataset,
  mapEvidenceToChunks,
  scoreEvidenceQuery,
} from './retrieval/evidenceBenchmark'

/**
 * Source-evidence retrieval benchmark.
 *
 * Gold labels point to frozen source-text anchors, never a chunk ID. The current
 * chunker is intentionally exercised through KnowledgeStore.importText(), so the
 * same corpus and dataset can be run unchanged after a chunker replacement.
 */
const root = path.dirname(fileURLToPath(import.meta.url))
const datasetPath = path.join(root, 'retrieval', 'knowledge-evidence.v1.json')
const isBenchmarkRun = process.env.npm_lifecycle_event === 'eval:retrieval:kb'

const round = (value: number) => Number(value.toFixed(6))

describe('真实知识库 source-evidence 检索评测', () => {
  it('对冻结语料输出独立于切分方式的 Recall@10 与 MRR@10', async () => {
    if (!isBenchmarkRun) {
      console.log('[retrieval-evidence-eval] 未通过 npm run eval:retrieval:kb 运行，跳过')
      return
    }

    const dataset = await loadEvidenceDataset(datasetPath)
    await ensureEmbeddingModelLoaded()
    const corpus = await createBenchmarkCorpus(dataset, path.dirname(datasetPath))
    try {
      const chunks = corpus.store.listChunks()
      const mapping = mapEvidenceToChunks(dataset, chunks, corpus.documentIds)
      const scores = []
      for (const query of dataset.queries) {
        const hits = await corpus.store.search(query.query, dataset.topK)
        scores.push(scoreEvidenceQuery(query, hits, mapping, dataset.topK))
      }

      const evidence = dataset.queries.flatMap((query) => query.evidence)
      const unmappedEvidence = evidence
        .filter((item) => (mapping.get(item.evidenceId)?.size ?? 0) === 0)
        .map((item) => ({
          evidenceId: item.evidenceId,
          document: item.document,
          required: item.required,
          anchor: item.anchor,
        }))
      const report = {
        benchmark: 'knowledge-evidence.v1',
        mode: 'real_embedding',
        semantics: {
          evidenceRecallAt10: 'top-10 覆盖的全部 evidence / 全部 evidence（含未映射项）',
          requiredEvidenceRecallAt10: 'top-10 覆盖的 required evidence / 全部 required evidence（含未映射项）',
          requiredEvidenceMrrAt10: '首条覆盖任一已映射 required evidence 的结果排名倒数；无命中或无映射为 0',
          mapping: '单个当前 chunk 的规范化 content 必须完整包含 evidence anchor',
        },
        corpus: {
          documents: dataset.corpus.map(({ alias, file, sha256 }) => ({ alias, file, sha256 })),
          chunks: chunks.length,
        },
        queries: dataset.queries.length,
        evidence: {
          total: evidence.length,
          required: evidence.filter((item) => item.required).length,
          mapped: evidence.length - unmappedEvidence.length,
          mappingSuccessRate: round((evidence.length - unmappedEvidence.length) / evidence.length),
          unmapped: unmappedEvidence,
        },
        metrics: {
          evidenceRecallAt10: round(average(scores.map((score) => score.evidenceRecall))),
          requiredEvidenceRecallAt10: round(average(scores.map((score) => score.requiredEvidenceRecall))),
          requiredEvidenceMrrAt10: round(average(scores.map((score) => score.requiredEvidenceMrr))),
        },
        perQuery: scores.map(
          ({ evidenceRecall, requiredEvidenceRecall, requiredEvidenceMrr, ...score }) => ({
            ...score,
            evidenceRecallAt10: evidenceRecall,
            requiredEvidenceRecallAt10: requiredEvidenceRecall,
            requiredEvidenceMrrAt10: requiredEvidenceMrr,
          }),
        ),
      }
      console.log('[retrieval-evidence-eval]', JSON.stringify(report, null, 2))

      expect(dataset.queries).toHaveLength(64)
      expect(report.evidence.mappingSuccessRate).toBeGreaterThan(0.95)
      expect(report.metrics.requiredEvidenceRecallAt10).toBeGreaterThan(0)
      expect(report.metrics.requiredEvidenceMrrAt10).toBeGreaterThan(0)
    } finally {
      await disposeBenchmarkCorpus(corpus)
    }
  }, 600_000)
})
