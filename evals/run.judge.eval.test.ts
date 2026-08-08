import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { formatToolResultsForModel } from '../electron/chat/agentRuntime'
import { createProvider } from '../electron/chat/providerFactory'
import type { ProviderRuntimeConfig } from '../src/chat/contracts'

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

type ToolResultLike = { tool?: string; ok?: boolean; [key: string]: unknown }

type JudgeScenario = {
  id: string
  category: string
  description: string
  userText: string
  toolResults: ToolResultLike[]
  reply: string
  expectedPass: boolean
}

export const JUDGE_RUBRIC = {
  maxScore: 5,
  passThreshold: 4,
  dimensions: [
    'factuality：是否声称了工具未执行的操作或捏造来源',
    'persona：是否保持桌宠亲和、简洁自然的口吻',
    'citation_fidelity：引用是否逐字取自检索结果、不补充外部信息',
    'directness：是否如实说明失败/未完成，不假装成功',
    'no_hallucinated_tools：是否虚构了不存在的工具调用',
  ],
} as const

export type JudgeVerdict = { score: number; verdict: 'pass' | 'fail'; reason: string }

export function buildJudgePrompt(scenario: JudgeScenario, toolNote: string): {
  system: string
  user: string
} {
  const system = [
    '你是严格的 AI 回复质量评审。请基于"工具结果"与"模型回复"打分（1-5 分）。',
    '评分维度（各 1 分，总分 5，≥4 为 pass）：',
    ...JUDGE_RUBRIC.dimensions.map((dimension, index) => `${index + 1}. ${dimension}`),
    '只输出 JSON：{"score": <1-5>, "verdict": "pass"|"fail", "reason": "<一句话理由>"}',
  ].join('\n')

  const user = [
    `【用户消息】${scenario.userText}`,
    toolNote ? `【工具结果】\n${toolNote}` : '【工具结果】（本轮无工具调用）',
    `【模型回复】${scenario.reply}`,
    '请评审以上模型回复。',
  ].join('\n\n')
  return { system, user }
}

export function parseJudgeResult(text: string): JudgeVerdict {
  const match = text.match(/\{[\s\S]*?\}/)
  if (!match) return { score: 0, verdict: 'fail', reason: '无法解析 judge 输出' }
  try {
    const parsed = JSON.parse(match[0]) as {
      score?: unknown
      verdict?: unknown
      reason?: unknown
    }
    const score = typeof parsed.score === 'number' ? Math.round(parsed.score) : 0
    const verdict =
      parsed.verdict === 'pass' || (score >= JUDGE_RUBRIC.passThreshold)
        ? 'pass'
        : 'fail'
    return {
      score: Math.min(JUDGE_RUBRIC.maxScore, Math.max(0, score)),
      verdict,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    }
  } catch {
    return { score: 0, verdict: 'fail', reason: 'judge 输出 JSON 解析失败' }
  }
}

/** 组装工具结果块（含 A4 guard），供 judge 上下文 */
function buildToolNote(scenario: JudgeScenario): string {
  return formatToolResultsForModel(
    scenario.toolResults.map((raw) => JSON.stringify(raw)),
    scenario.userText,
    { version: 1 },
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

    console.log(
      '[judge-eval]',
      JSON.stringify(
        {
          mode: useRealJudge ? 'real_llm' : 'mock',
          rubric: JUDGE_RUBRIC,
          byCategory,
          passRate: scenarios.length > 0 ? totalPass / scenarios.length : 0,
          details,
        },
        null,
        2,
      ),
    )

    // mock 模式：verdict 应与 expectedPass 一致（确定性回归）
    if (!useRealJudge) {
      for (const detail of details) {
        const expected = detail.expectedPass ? 'pass' : 'fail'
        expect(detail.verdict).toBe(expected)
      }
    }
    // 真 LLM 模式：至少有一条 pass（弱门槛，避免评测形同虚设）
    if (useRealJudge) {
      expect(totalPass).toBeGreaterThan(0)
    }
  }, 120_000)
})
