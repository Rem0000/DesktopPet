import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { formatToolResultsForModel } from '../electron/chat/agentRuntime'
import { createProvider } from '../electron/chat/providerFactory'
import { ToolRegistry } from '../electron/chat/toolRegistry'
import { KnowledgeService } from '../electron/chat/knowledgeService'
import type { KnowledgeStore } from '../electron/chat/knowledgeStore'
import type { ProviderRuntimeConfig } from '../src/chat/contracts'
import {
  JUDGE_RUBRIC,
  buildJudgePrompt,
  parseJudgeResult,
  type JudgeScenario,
  type JudgeVerdict,
} from './judge/prompts'

/**
 * LLM-as-judge 评测：用真实 DeepSeek 对"开放性"回复质量打分（1-5）。
 * 与 run.eval.test.ts 的规则断言互补——断言锁确定性回归，judge 测开放性质量。
 *
 * 双模式：
 *  - 默认注入 mock judge（固定分数），npm test 不触发网络；
 *  - EVAL_JUDGE_REAL=1 或 npm run eval:judge:real 时走真 LLM（需 DEEPSEEK_API_KEY）。
 */

const useRealJudge =
  process.env.EVAL_JUDGE_REAL === '1' ||
  process.env.npm_lifecycle_event === 'eval:judge:real'

/** 组装工具结果块（含 A4 guard），供 judge 上下文 */
function buildToolNote(scenario: JudgeScenario): string {
  // registry 提供 search_knowledge 的 renderForModel：检索 excerpt 必须进入 judge 上下文，
  // 否则 citation-faithful / citation-fabricated 场景看不到原文，judge 无从判断引用忠实度。
  const registry = new ToolRegistry()
  const store = { search: async () => [] } as unknown as KnowledgeStore
  new KnowledgeService(store, registry).registerDefaultTools()
  return formatToolResultsForModel(
    scenario.toolResults.map((raw) => JSON.stringify(raw)),
    scenario.userText,
    { version: 1 },
    registry,
  )
}

const root = path.dirname(fileURLToPath(import.meta.url))
const scenariosPath = path.join(root, 'judge', 'scenarios.json')

describe('LLM-as-judge eval', () => {
  it(`开放性回复质量打分（mock 固定分数 / 真 LLM 打分）${useRealJudge ? ' [REAL_JUDGE]' : ' [MOCK_JUDGE]'}`, async () => {
    const scenarios = JSON.parse(
      await readFile(scenariosPath, 'utf8'),
    ) as JudgeScenario[]
    expect(scenarios.length).toBeGreaterThanOrEqual(6)

    // 真实模式：从环境读取 provider 配置；缺失则跳过（不失败）
    let providerConfig: ProviderRuntimeConfig | null = null
    let provider: ReturnType<typeof createProvider> | null = null
    if (useRealJudge) {
      const apiKey = process.env.DEEPSEEK_API_KEY
      if (!apiKey) {
        console.warn(
          '[judge-eval] EVAL_JUDGE_REAL=1 但缺少 DEEPSEEK_API_KEY，跳过真实打分（可先 export DEEPSEEK_API_KEY）。',
        )
        return
      }
      providerConfig = {
        baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
        model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
        apiKey,
        providerKind: 'deepseek',
      }
      provider = createProvider('deepseek')
    }

    const byCategory: Record<string, { pass: number; total: number }> = {}
    let totalPass = 0
    const details: Array<JudgeVerdict & { id: string; category: string; expectedPass: boolean }> = []

    for (const scenario of scenarios) {
      const toolNote = buildToolNote(scenario)
      const { system, user } = buildJudgePrompt(scenario, toolNote)

      let verdict: JudgeVerdict
      if (useRealJudge && provider && providerConfig) {
        const raw = await provider.completeText(
          system,
          user,
          providerConfig,
          new AbortController().signal,
        )
        verdict = parseJudgeResult(raw)
      } else {
        // mock judge：按 expectedPass 返回固定分数（验证流程，不触网）
        verdict = scenario.expectedPass
          ? { score: 5, verdict: 'pass', reason: 'mock: expected pass' }
          : { score: 1, verdict: 'fail', reason: 'mock: expected fail' }
      }

      byCategory[scenario.category] ??= { pass: 0, total: 0 }
      byCategory[scenario.category]!.total += 1
      const isPass = verdict.verdict === 'pass'
      if (isPass) {
        byCategory[scenario.category]!.pass += 1
        totalPass += 1
      }
      details.push({ ...verdict, id: scenario.id, category: scenario.category, expectedPass: scenario.expectedPass })
    }

    const agreement =
      details.length > 0
        ? details.filter((detail) => (detail.verdict === 'pass') === detail.expectedPass).length /
          details.length
        : 0

    console.log(
      '[judge-eval]',
      JSON.stringify(
        {
          mode: useRealJudge ? 'real_llm' : 'mock',
          rubric: JUDGE_RUBRIC,
          byCategory,
          passRate: scenarios.length > 0 ? totalPass / scenarios.length : 0,
          agreement,
          details,
        },
        null,
        2,
      ),
    )

    // mock 模式：verdict 应与 expectedPass 完全一致（确定性回归）
    if (!useRealJudge) {
      for (const detail of details) {
        const expected = detail.expectedPass ? 'pass' : 'fail'
        expect(detail.verdict).toBe(expected)
      }
    }
    // 真 LLM 模式：D5 断言加严——与 expectedPass 的符合率 ≥ 0.8（留噪声余量），
    // 并锁定 citation 分类 2/2 必过：citation-faithful MUST pass、citation-fabricated MUST fail。
    if (useRealJudge) {
      expect(agreement).toBeGreaterThanOrEqual(0.8)
      const citation = details.filter((detail) => detail.category === 'citation')
      expect(citation).toHaveLength(2)
      expect(citation.find((detail) => detail.id === 'citation-faithful')?.verdict).toBe('pass')
      expect(citation.find((detail) => detail.id === 'citation-fabricated')?.verdict).toBe('fail')
    }
  }, 120_000)
})
