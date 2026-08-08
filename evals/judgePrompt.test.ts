import { describe, expect, it } from 'vitest'
import {
  JUDGE_RUBRIC,
  buildJudgePrompt,
  parseJudgeResult,
  type JudgeScenario,
} from './run.judge.eval.test'

const sampleScenario: JudgeScenario = {
  id: 'hallucination-honest-remember-failure',
  category: 'hallucination',
  description: '如实说明失败',
  userText: '帮我记住我喜欢喝美式咖啡',
  toolResults: [{ tool: 'search_knowledge', ok: true, output: { hits: [] } }],
  reply: '这轮没能写入记忆。',
  expectedPass: true,
}

describe('buildJudgePrompt（判据组装）', () => {
  it('产出包含工具结果块与评审维度的 prompt', () => {
    const { system, user } = buildJudgePrompt(sampleScenario, '【工具结果】…')
    expect(system).toContain('factuality')
    expect(system).toContain('1-5')
    expect(system).toContain('pass')
    expect(user).toContain('【用户消息】')
    expect(user).toContain('【模型回复】')
    expect(user).toContain('帮我记住我喜欢喝美式咖啡')
  })

  it('无工具结果时不输出工具块', () => {
    const { user } = buildJudgePrompt({ ...sampleScenario, toolResults: [] }, '')
    expect(user).not.toContain('【工具结果】\n\n')
    expect(user).toContain('本轮无工具调用')
  })
})

describe('parseJudgeResult（judge 输出解析）', () => {
  it('解析合法 JSON', () => {
    const verdict = parseJudgeResult(
      '{"score": 5, "verdict": "pass", "reason": "引用一致"}',
    )
    expect(verdict.score).toBe(5)
    expect(verdict.verdict).toBe('pass')
    expect(verdict.reason).toBe('引用一致')
  })

  it('verdict 缺失时按 score 阈值推断', () => {
    expect(parseJudgeResult('{"score": 4, "reason": "r"}').verdict).toBe('pass')
    expect(parseJudgeResult('{"score": 3, "reason": "r"}').verdict).toBe('fail')
  })

  it('非法输出回退 fail', () => {
    expect(parseJudgeResult('无法评审')).toEqual({
      score: 0,
      verdict: 'fail',
      reason: '无法解析 judge 输出',
    })
  })

  it('分数钳制在 0-5', () => {
    expect(parseJudgeResult('{"score": 99}').score).toBe(JUDGE_RUBRIC.maxScore)
    expect(parseJudgeResult('{"score": -3}').score).toBe(0)
  })
})
