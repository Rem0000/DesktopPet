import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { KnowledgeStore } from '../electron/chat/knowledgeStore'
import { createProvider } from '../electron/chat/providerFactory'
import type { ProviderRuntimeConfig } from '../src/chat/contracts'
import { installMockEmbeddingPipeline } from '../electron/retrieval/testHelpers'
import {
  aggregateFaithfulness,
  faithfulnessFromVerdicts,
  lexicalGroundingScore,
  parseFaithfulnessOutput,
  splitClaims,
  type FaithfulnessAggregate,
  type FaithfulnessScenarioResult,
} from './faithfulness/metrics'
import {
  buildContextFromExcerpts,
  buildGeneratePrompt,
  buildJudgePrompt,
} from './faithfulness/prompts'

/**
 * RAG faithfulness（忠实引用召回片段）评测：RAGAS 风格 claim 级接地。
 *
 * 度量：把答案拆解为原子 claim，逐条对照召回片段判定「是否完全被支持」，
 * faithfulness = supported_claims / total_claims，binary faithful = faithfulness >= 0.9。
 * context 取评测集显式给定的 retrievedExcerpts（模拟 search_knowledge 返回的 excerpt，
 * 逐字使用、截断到 280 字符，对齐 knowledgeService.ts 的 toCitationPayload）。
 *
 * 诚实边界：
 *  - faithfulness 度量 answer→召回片段 的接地（生成质量），不度量检索质量（那是 IR eval）。
 *  - mock 模式 = 度量数学 + harness/数据完整性 + lexical 基线（离线近似，非真值）；
 *  - real 模式 = 真 DeepSeek judge；generate 场景用真模型（带 grounding 约束的单轮补全，
 *    不含人设/记忆上下文）现场生成答案再打分——是近似，非完整 AgentRuntime（无 plan→tool→replan）。
 *  - mock 绿 ≠ real 达标：real 断言只在 real 模式跑。
 *
 * real 触发：EVAL_FAITHFULNESS_REAL=1 或 npm run eval:faithfulness:real（需 DEEPSEEK_API_KEY）。
 */

const useRealJudge =
  process.env.EVAL_FAITHFULNESS_REAL === '1' ||
  process.env.npm_lifecycle_event === 'eval:faithfulness:real'

/** binary 判定阈值：faithfulness >= 0.9 视为忠实（容忍少量连接性 claim） */
const FAITHFULNESS_THRESHOLD = 0.9
/** 离线 lexical 基线中 claim 判定 grounded 的词法重叠阈值 */
const LEXICAL_THRESHOLD = 0.5

type ScenarioDocument = { title: string; content: string }

type FaithfulnessScenario = {
  id: string
  category: string
  description: string
  query: string
  documents: ScenarioDocument[]
  retrievedExcerpts: string[]
  answer?: string
  generate?: boolean
  groundTruth: {
    faithful: boolean
    supportedClaims?: string[]
    unsupportedClaims?: string[]
  }
}

const root = path.dirname(fileURLToPath(import.meta.url))
const scenariosPath = path.join(root, 'faithfulness', 'scenarios.json')

beforeEach(() => {
  installMockEmbeddingPipeline()
})

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pet-faithfulness-'))
  try {
    return await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** context = 显式召回片段，逐字使用并截断到 EXCERPT_CHARS（见 prompts.ts） */

function summarize(results: FaithfulnessScenarioResult[], mode: string): FaithfulnessAggregate {
  const aggregate = aggregateFaithfulness(results)
  console.log(
    `[faithfulness-eval:${mode}]`,
    JSON.stringify(aggregate, null, 2),
  )
  for (const result of results) {
    const claimsNote = result.claims
      ? result.claims
          .map((claim) => `${claim.supported ? '+' : '-'} ${claim.claim}`)
          .join(' | ')
      : ''
    console.log(
      `[faithfulness-eval:${mode}] ${result.id} (${result.category}) faithful=${result.faithful} ` +
        `score=${result.faithfulness.toFixed(2)}${claimsNote ? ` :: ${claimsNote}` : ''}`,
    )
  }
  return aggregate
}

describe('RAG faithfulness 评测', () => {
  it('度量数学正确性（确定性）：faithfulnessFromVerdicts / splitClaims / parseFaithfulnessOutput / aggregate', () => {
    expect(faithfulnessFromVerdicts(2, 3)).toBeCloseTo(2 / 3)
    expect(faithfulnessFromVerdicts(3, 3)).toBe(1)
    expect(faithfulnessFromVerdicts(0, 3)).toBe(0)
    expect(faithfulnessFromVerdicts(1, 0)).toBe(0)
    expect(faithfulnessFromVerdicts(-1, 3)).toBe(0)
    expect(faithfulnessFromVerdicts(5, 3)).toBe(1)

    expect(splitClaims('甲。乙！丙？丁；戊')).toEqual(['甲', '乙', '丙', '丁', '戊'])
    expect(splitClaims('甲。\n乙。  \n丙。')).toEqual(['甲', '乙', '丙'])
    expect(splitClaims('')).toEqual([])

    const parsed = parseFaithfulnessOutput(
      JSON.stringify([
        { claim: '支持 .md', supported: true, reason: '片段原文' },
        { claim: '支持 .pdf', supported: false, reason: '片段没有' },
      ]),
    )
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({ claim: '支持 .md', supported: true })
    expect(parsed[1]).toMatchObject({ claim: '支持 .pdf', supported: false })
    expect(parseFaithfulnessOutput('不是 JSON')).toEqual([])
    expect(parseFaithfulnessOutput('[{"claim":"","supported":true}]')).toEqual([])

    const aggregate = aggregateFaithfulness([
      { id: 'a', category: 'grounded', query: 'q', answer: 'x', context: [], faithfulness: 1, faithful: true },
      { id: 'b', category: 'grounded', query: 'q', answer: 'x', context: [], faithfulness: 0.5, faithful: false },
      { id: 'c', category: 'hallucination', query: 'q', answer: 'x', context: [], faithfulness: 0, faithful: false },
    ])
    expect(aggregate.overall.count).toBe(3)
    expect(aggregate.overall.mean).toBeCloseTo(0.5)
    expect(aggregate.overall.passRate).toBeCloseTo(1 / 3)
    expect(aggregate.byCategory.grounded).toMatchObject({ count: 2, mean: 0.75, passRate: 0.5 })
    expect(aggregate.byCategory.hallucination).toMatchObject({ count: 1, mean: 0, passRate: 0 })
  })

  it(`离线 harness：数据完整性 + pipeline 冒烟 + lexical 基线 [MOCK]`, async () => {
    const scenarios = JSON.parse(await readFile(scenariosPath, 'utf8')) as FaithfulnessScenario[]
    expect(scenarios.length).toBeGreaterThanOrEqual(14)

    const offline: FaithfulnessScenarioResult[] = []
    let generateCount = 0
    for (const scenario of scenarios) {
      const context = buildContextFromExcerpts(scenario.retrievedExcerpts)

      // 数据完整性：每个召回片段都应是某个文档内容的子串（保证评测集自洽）
      for (const excerpt of context) {
        expect(
          scenario.documents.some((document) => document.content.includes(excerpt)),
          `场景 ${scenario.id} 的 excerpt 不是任何文档的子串：${excerpt}`,
        ).toBe(true)
      }

      // pipeline 冒烟：真实 KnowledgeStore 建库 + 检索（mock embedding）
      let hits: Array<{ content: string }> = []
      await withTempDir(async (dir) => {
        const store = new KnowledgeStore(dir)
        await store.initialize()
        for (const document of scenario.documents) {
          await store.importText(document.title, document.content)
        }
        hits = await store.search(scenario.query, 4)
      })
      const alignment = context.filter((excerpt) =>
        hits.some((hit) => hit.content.includes(excerpt)),
      ).length

      console.log(
        `[faithfulness-eval:mock] ${scenario.id} retrievalAlignment=${alignment}/${context.length} hits=${hits.length}`,
      )

      if (scenario.generate) {
        generateCount += 1
        continue // 无固定 answer，real 模式现场生成
      }
      const answer = scenario.answer ?? ''
      const claims = splitClaims(answer)
      const grounded = claims.filter(
        (claim) => lexicalGroundingScore(claim, context) >= LEXICAL_THRESHOLD,
      ).length
      const lexical = faithfulnessFromVerdicts(grounded, claims.length)
      offline.push({
        id: scenario.id,
        category: scenario.category,
        query: scenario.query,
        answer,
        context,
        faithfulness: lexical,
        faithful: lexical >= FAITHFULNESS_THRESHOLD,
      })
    }

    expect(offline.length).toBe(scenarios.length - generateCount)
    for (const result of offline) {
      expect(Number.isFinite(result.faithfulness)).toBe(true)
      expect(result.faithfulness).toBeGreaterThanOrEqual(0)
      expect(result.faithfulness).toBeLessThanOrEqual(1)
    }
    // lexical 是离线近似，不 assert 与金标一致，仅输出供对照
    summarize(offline, 'mock')
  }, 30_000)

  it(`real：LLM judge 拆解+判定 + generate 场景端到端生成 ${useRealJudge ? '[REAL_JUDGE]' : '[MOCK_SKIP]'}`, async () => {
    if (!useRealJudge) {
      console.log(
        '[faithfulness-eval] 未通过 npm run eval:faithfulness:real 运行，跳过 real 打分',
      )
      return
    }
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      console.warn(
        '[faithfulness-eval] 缺少 DEEPSEEK_API_KEY，跳过 real 打分（可先 export DEEPSEEK_API_KEY）。',
      )
      return
    }
    const providerConfig: ProviderRuntimeConfig = {
      baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
      model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
      apiKey,
      providerKind: 'deepseek',
    }
    const provider = createProvider('deepseek')

    const scenarios = JSON.parse(await readFile(scenariosPath, 'utf8')) as FaithfulnessScenario[]
    const results: FaithfulnessScenarioResult[] = []
    const failures: Array<{ id: string; error: string }> = []

    for (const scenario of scenarios) {
      const context = buildContextFromExcerpts(scenario.retrievedExcerpts)
      try {
        let answer = scenario.answer ?? ''
        if (scenario.generate) {
          const { system, user } = buildGeneratePrompt({
            query: scenario.query,
            context,
          })
          answer = await provider.completeText(system, user, providerConfig, new AbortController().signal)
        }

        const { system, user } = buildJudgePrompt({
          query: scenario.query,
          context,
          answer,
        })
        const raw = await provider.completeText(system, user, providerConfig, new AbortController().signal)
        const verdicts = parseFaithfulnessOutput(raw)
        if (verdicts.length === 0 && !raw.includes('[')) {
          // judge 未输出 JSON 数组 → 该场景打分失败（如实记录，不默认放行）
          throw new Error(`judge 输出无法解析：${raw.slice(0, 200)}`)
        }

        const supported = verdicts.filter((verdict) => verdict.supported).length
        const faithfulness = faithfulnessFromVerdicts(supported, verdicts.length)
        results.push({
          id: scenario.id,
          category: scenario.category,
          query: scenario.query,
          answer,
          context,
          faithfulness,
          faithful: faithfulness >= FAITHFULNESS_THRESHOLD,
          claims: verdicts,
        })
      } catch (error) {
        failures.push({ id: scenario.id, error: (error as Error).message })
        console.warn(`[faithfulness-eval] 场景 ${scenario.id} 打分失败：`, error)
      }
    }

    const aggregate = summarize(results, 'real')
    console.log(
      '[faithfulness-eval:real] generate 场景：',
      scenarios.filter((scenario) => scenario.generate).map((scenario) => scenario.id),
    )
    if (failures.length > 0) {
      console.warn('[faithfulness-eval:real] 打分失败场景：', failures)
    }

    // 与金标一致率（含 generate 场景）
    const byId = new Map(results.map((result) => [result.id, result]))
    const agreement =
      results.length === 0
        ? 0
        : results.filter((result) => {
            const gold = scenarios.find((scenario) => scenario.id === result.id)?.groundTruth.faithful
            return result.faithful === gold
          }).length / results.length
    console.log(
      `[faithfulness-eval:real] agreement=${agreement.toFixed(3)} (${results.length}/${scenarios.length} 场景成功打分)`,
    )

    expect(aggregate.overall.count).toBeGreaterThan(0)
    expect(agreement).toBeGreaterThanOrEqual(0.8)
    // 锁定场景：逐字接地 MUST pass、编造数字 MUST fail（对齐 judge eval 的 citation 2/2 必过模式）
    expect(byId.get('grounded-verbatim')?.faithful).toBe(true)
    expect(byId.get('hallucinated-number')?.faithful).toBe(false)
  }, 300_000)
})
