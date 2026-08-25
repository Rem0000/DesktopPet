import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createProvider } from '../electron/chat/providerFactory'
import { ensureEmbeddingModelLoaded } from '../electron/retrieval/embeddingService'
import type { ProviderRuntimeConfig } from '../src/chat/contracts'
import {
  average,
  createBenchmarkCorpus,
  disposeBenchmarkCorpus,
  loadEvidenceDataset,
  mapEvidenceToChunks,
  scoreEvidenceQuery,
} from './retrieval/evidenceBenchmark'
import {
  aggregateFaithfulness,
  faithfulnessFromVerdicts,
  parseFaithfulnessOutput,
  type FaithfulnessScenarioResult,
} from './faithfulness/metrics'
import {
  buildContextFromExcerpts,
  buildGeneratePrompt,
  buildJudgePrompt,
} from './faithfulness/prompts'

/**
 * 真实知识库 faithfulness 评测：固定 source-evidence 语料 + 真实检索 + LLM 生成与判定。
 * 检索标签来自冻结原文锚点，因此不会随着 chunker 替换而改写数据集。
 */
const root = path.dirname(fileURLToPath(import.meta.url))
const datasetPath = path.join(root, 'retrieval', 'knowledge-evidence.v1.json')
const isKbFaithfulnessRun =
  process.env.EVAL_FAITHFULNESS_KB === '1' ||
  process.env.npm_lifecycle_event === 'eval:faithfulness:kb'
const FAITHFULNESS_THRESHOLD = 0.9
const TOP_K = 4

const avg = (values: number[]) => average(values)

describe('真实知识库 faithfulness 评测（真检索 + LLM 生成 + judge）', () => {
  it('64 条 query 端到端：真实检索结果作 context，判生成回答是否忠实', async () => {
    if (!isKbFaithfulnessRun) {
      console.log('[faithfulness-kb-eval] 未通过 npm run eval:faithfulness:kb 运行，跳过')
      return
    }
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      console.warn('[faithfulness-kb-eval] 缺少 DEEPSEEK_API_KEY，跳过 real 打分')
      return
    }

    const dataset = await loadEvidenceDataset(datasetPath)
    await ensureEmbeddingModelLoaded()
    const corpus = await createBenchmarkCorpus(dataset, path.dirname(datasetPath))
    try {
      const mapping = mapEvidenceToChunks(dataset, corpus.store.listChunks(), corpus.documentIds)
      const providerConfig: ProviderRuntimeConfig = {
        baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
        model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
        apiKey,
        providerKind: 'deepseek',
      }
      const provider = createProvider('deepseek')
      const results: FaithfulnessScenarioResult[] = []
      const diagnostics: Array<{ id: string; hits: number; evidenceRecall: number; requiredRecall: number; mrr: number }> = []
      const failures: Array<{ id: string; error: string }> = []

      for (const query of dataset.queries) {
        const hits = await corpus.store.search(query.query, TOP_K)
        const score = scoreEvidenceQuery(query, hits, mapping, TOP_K)
        const context = buildContextFromExcerpts(hits.map((hit) => hit.content))
        try {
          const gen = buildGeneratePrompt({ query: query.query, context })
          const answer = await provider.completeText(gen.system, gen.user, providerConfig, new AbortController().signal)
          const judge = buildJudgePrompt({ query: query.query, context, answer })
          const raw = await provider.completeText(judge.system, judge.user, providerConfig, new AbortController().signal)
          const verdicts = parseFaithfulnessOutput(raw)
          if (verdicts.length === 0 && !raw.includes('[')) throw new Error(`judge 输出无法解析：${raw.slice(0, 200)}`)
          const supported = verdicts.filter((verdict) => verdict.supported).length
          const faithfulness = faithfulnessFromVerdicts(supported, verdicts.length)
          results.push({
            id: query.id,
            category: query.category,
            query: query.query,
            answer,
            context,
            faithfulness,
            faithful: faithfulness >= FAITHFULNESS_THRESHOLD,
            claims: verdicts,
          })
          diagnostics.push({
            id: query.id,
            hits: hits.length,
            evidenceRecall: score.evidenceRecall,
            requiredRecall: score.requiredEvidenceRecall,
            mrr: score.requiredEvidenceMrr,
          })
          console.log(
            `[faithfulness-kb-eval] ${query.id} (${query.category}) hits=${hits.length} ` +
              `evidenceRecall=${score.evidenceRecall.toFixed(2)} ` +
              `requiredRecall=${score.requiredEvidenceRecall.toFixed(2)} ` +
              `mrr=${score.requiredEvidenceMrr.toFixed(2)} ` +
              `faithful=${faithfulness >= FAITHFULNESS_THRESHOLD} score=${faithfulness.toFixed(2)}`,
          )
        } catch (error) {
          failures.push({ id: query.id, error: (error as Error).message })
          console.warn(`[faithfulness-kb-eval] ${query.id} 打分失败：`, error)
        }
      }

      const aggregate = aggregateFaithfulness(results)
      console.log('[faithfulness-kb-eval] 总览', JSON.stringify({
        mode: 'real_embedding + frozen_source_evidence + LLM_generate + LLM_judge',
        corpus: dataset.corpus,
        queries: { total: dataset.queries.length, scored: results.length, failed: failures.length },
        retrieval: {
          evidenceRecallAt4: avg(diagnostics.map((item) => item.evidenceRecall)),
          requiredEvidenceRecallAt4: avg(diagnostics.map((item) => item.requiredRecall)),
          requiredEvidenceMrrAt4: avg(diagnostics.map((item) => item.mrr)),
          emptyRetrieval: diagnostics.filter((item) => item.hits === 0).length,
          avgHits: avg(diagnostics.map((item) => item.hits)),
        },
        faithfulness: aggregate,
      }, null, 2))
      if (failures.length > 0) console.warn('[faithfulness-kb-eval] 打分失败场景：', failures)

      expect(aggregate.overall.count).toBeGreaterThan(0)
      expect(aggregate.overall.passRate).toBeGreaterThanOrEqual(0.8)
      expect(aggregate.overall.mean).toBeGreaterThanOrEqual(0.8)
    } finally {
      await disposeBenchmarkCorpus(corpus)
    }
  }, 600_000)
})
