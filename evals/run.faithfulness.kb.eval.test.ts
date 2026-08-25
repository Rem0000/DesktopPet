import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { KnowledgeStore } from '../electron/chat/knowledgeStore'
import { createProvider } from '../electron/chat/providerFactory'
import { ensureEmbeddingModelLoaded } from '../electron/retrieval/embeddingService'
import type { ProviderRuntimeConfig } from '../src/chat/contracts'
import { mrrAtK, precisionAtK, relevantSet } from './retrieval/metrics'
import {
  aggregateFaithfulness,
  faithfulnessFromVerdicts,
  parseFaithfulnessOutput,
  type FaithfulnessAggregate,
  type FaithfulnessScenarioResult,
} from './faithfulness/metrics'
import {
  buildContextFromExcerpts,
  buildGeneratePrompt,
  buildJudgePrompt,
} from './faithfulness/prompts'

/**
 * 真实知识库 faithfulness 评测（端到端）：与 run.retrieval.kb.eval 同一语料与查询集，
 * 但这一条测的不是「检索质量」，而是「真实检索出来的片段，模型回答是否忠实」。
 *
 * 流程（每 query）：
 *   1. 真实 RAG 检索：data/knowledge 全库 + 真实 BGE（查询向量与库内向量同源）
 *      → store.search(query, TOP_K) 的实际 hits 即为打分 context（逐字、截断 280）；
 *   2. 生成：真模型以 grounding 约束（引用 MUST 逐字取自 excerpt）基于实际 hits 作答；
 *   3. 判定：LLM judge 拆解 answer 为 claim，逐条对照实际 hits 判 supported → faithfulness。
 *
 * 诚实边界：
 *  - 生成是「单轮 grounding 补全」，非完整 AgentRuntime（无 plan→tool→replan）；如实标注。
 *  - context 是真实检索输出（不再用手写 excerpt），因此 grounded/未召回 由检索表现决定——
 *    检索诊断（P@4/MRR/空召回）与 faithfulness 一起输出，可对照「检索差时回答是否如实 abstain」。
 *  - 仅通过 `npm run eval:faithfulness:kb` 真正执行；普通 `npm test` 命中即跳过。
 *  - 断言的是 passRate（忠实回答占比）≥ 0.8：模型不得编造出召回片段之外的内容；
 *    片段无关/空召回时如实「未找到」也算忠实（judge 豁免规则）。
 */

const root = path.dirname(fileURLToPath(import.meta.url))
const kbDir = path.resolve(process.cwd(), 'data/knowledge')
const corePath = path.join(root, 'retrieval', 'queries.real.json')
const llmPath = path.join(root, 'retrieval', 'queries.llm.json')

const isKbFaithfulnessRun =
  process.env.EVAL_FAITHFULNESS_KB === '1' ||
  process.env.npm_lifecycle_event === 'eval:faithfulness:kb'

/** binary 判定阈值：faithfulness >= 0.9 视为忠实 */
const FAITHFULNESS_THRESHOLD = 0.9
/** 每 query 检索 topK（也是打分的召回片段数） */
const TOP_K = 4

type KbQuery = {
  id: string
  query: string
  relevantChunkGraded: Record<string, number>
}
type KbDataset = {
  documents: Record<string, string>
  knowledge: KbQuery[]
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

/** query 的文档归类：取最高分 gold chunk 所属文档的 short 名（mysql/rabbitmq/scene/interview） */
function dominantDoc(graded: Record<string, number>): string {
  let best: string | null = null
  let bestGrade = -1
  for (const [key, rel] of Object.entries(graded)) {
    if (rel > bestGrade) {
      bestGrade = rel
      best = key
    }
  }
  return best?.split(':')[0] ?? 'unknown'
}

const avg = (values: number[]) =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length

describe('真实知识库 faithfulness 评测（真检索 + LLM 生成 + judge）', () => {
  it('24+ 条 query 端到端：真实检索结果作 context，判生成回答是否忠实', async () => {
    if (!isKbFaithfulnessRun) {
      console.log('[faithfulness-kb-eval] 未通过 npm run eval:faithfulness:kb 运行，跳过')
      return
    }
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      console.warn('[faithfulness-kb-eval] 缺少 DEEPSEEK_API_KEY，跳过 real 打分')
      return
    }

    const core = JSON.parse(await readFile(corePath, 'utf8')) as KbDataset
    const documents: Record<string, string> = { ...core.documents }
    const queries: KbQuery[] = [...core.knowledge]
    if (process.env.FAITHFULNESS_KB_INCLUDE_LLM === '1') {
      try {
        const llm = JSON.parse(await readFile(llmPath, 'utf8')) as KbDataset
        Object.assign(documents, llm.documents)
        queries.push(...(llm.knowledge ?? []))
      } catch {
        console.log('[faithfulness-kb-eval] queries.llm.json 未生成，仅跑人工核心集')
      }
    }

    // 查询向量必须与库内向量同源（真实 BGE）
    await ensureEmbeddingModelLoaded()
    const store = new KnowledgeStore(kbDir)
    await store.initialize()

    const providerConfig: ProviderRuntimeConfig = {
      baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
      model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
      apiKey,
      providerKind: 'deepseek',
    }
    const provider = createProvider('deepseek')

    const results: FaithfulnessScenarioResult[] = []
    const diagnostics: Array<{ id: string; hits: number; p4: number; mrr: number }> = []
    const failures: Array<{ id: string; error: string }> = []

    for (const q of queries) {
      const grade = new Map<string, number>()
      for (const [key, rel] of Object.entries(q.relevantChunkGraded)) {
        grade.set(resolveKey(key, documents), rel)
      }
      const relevant = relevantSet(grade)
      const hits = await store.search(q.query, TOP_K)
      const context = buildContextFromExcerpts(hits.map((hit) => hit.content))
      const retrieved = hits.map((hit) => hit.chunkId)
      const p4 = precisionAtK(retrieved, relevant, TOP_K)
      const mrr = mrrAtK(retrieved, relevant, TOP_K)

      try {
        const gen = buildGeneratePrompt({ query: q.query, context })
        const answer = await provider.completeText(
          gen.system,
          gen.user,
          providerConfig,
          new AbortController().signal,
        )
        const judge = buildJudgePrompt({ query: q.query, context, answer })
        const raw = await provider.completeText(
          judge.system,
          judge.user,
          providerConfig,
          new AbortController().signal,
        )
        const verdicts = parseFaithfulnessOutput(raw)
        if (verdicts.length === 0 && !raw.includes('[')) {
          throw new Error(`judge 输出无法解析：${raw.slice(0, 200)}`)
        }
        const supported = verdicts.filter((verdict) => verdict.supported).length
        const faithfulness = faithfulnessFromVerdicts(supported, verdicts.length)
        results.push({
          id: q.id,
          category: dominantDoc(q.relevantChunkGraded),
          query: q.query,
          answer,
          context,
          faithfulness,
          faithful: faithfulness >= FAITHFULNESS_THRESHOLD,
          claims: verdicts,
        })
        diagnostics.push({ id: q.id, hits: hits.length, p4, mrr })
        console.log(
          `[faithfulness-kb-eval] ${q.id} (${dominantDoc(q.relevantChunkGraded)}) ` +
            `hits=${hits.length} p@4=${p4.toFixed(2)} mrr=${mrr.toFixed(2)} ` +
            `faithful=${faithfulness >= FAITHFULNESS_THRESHOLD} score=${faithfulness.toFixed(2)}`,
        )
      } catch (error) {
        failures.push({ id: q.id, error: (error as Error).message })
        console.warn(`[faithfulness-kb-eval] ${q.id} 打分失败：`, error)
      }
    }

    const aggregate = aggregateFaithfulness(results)
    console.log(
      '[faithfulness-kb-eval] 总览',
      JSON.stringify(
        {
          mode: 'real_embedding + real_retrieval + LLM_generate + LLM_judge',
          corpus: kbDir,
          queries: { total: queries.length, scored: results.length, failed: failures.length },
          retrieval: {
            pAt4: avg(diagnostics.map((d) => d.p4)),
            mrrAt4: avg(diagnostics.map((d) => d.mrr)),
            emptyRetrieval: diagnostics.filter((d) => d.hits === 0).length,
            avgHits: avg(diagnostics.map((d) => d.hits)),
          },
          faithfulness: aggregate,
        },
        null,
        2,
      ),
    )
    if (failures.length > 0) {
      console.warn('[faithfulness-kb-eval] 打分失败场景：', failures)
    }

    // 诚实断言：真实检索结果下，生成回答必须绝大多数忠实（不编造片段外内容）；
    // 片段无关/空召回时如实「未找到」计入忠实（judge 豁免）。
    expect(aggregate.overall.count).toBeGreaterThan(0)
    expect(aggregate.overall.passRate).toBeGreaterThanOrEqual(0.8)
    expect(aggregate.overall.mean).toBeGreaterThanOrEqual(0.8)
  }, 600_000)
})
