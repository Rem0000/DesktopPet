/**
 * LLM-as-judge 判据与解析（纯函数，无 vitest 依赖）。
 *
 * 与 `evals/faithfulness/prompts.ts` 同构：可复用的判据逻辑独立成模块，
 * runner（`evals/run.judge.eval.test.ts`）与单测（`evals/judgePrompt.test.ts`）共同 import。
 *
 * 为什么必须独立于 runner：vitest 在 import 一个 `*.test.ts` 时会连带注册该文件里的
 * `describe`/`it`。此前 judgePrompt.test.ts 直接从 run.judge.eval.test.ts import 这些函数，
 * 导致 runner 的用例在 judgePrompt.test.ts 里被重复注册并重复执行（同一用例两处失败）。
 * 纯函数放在非 test 模块即可消除重复注册。
 */

export type ToolResultLike = { tool?: string; ok?: boolean; [key: string]: unknown }

export type JudgeScenario = {
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
    toolNote ? `【工具结果】\n${toolNote}` : `【工具结果】（本轮无工具调用）`,
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
