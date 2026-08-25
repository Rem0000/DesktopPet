/**
 * faithfulness 评测共享 prompt：judge（拆解+判定）与 generate（grounding 约束生成）。
 *
 * judge 的拆解规则（verbatim claims + 如实「未找到」豁免）是 real 跑调出来的：
 *  - claim 必须直接改写自回答原文子句，禁止自行补充/推理；
 *  - 模型如实表示知识库未找到相关内容时视为忠实（supported=true），不得因片段未提及而判不支持。
 * generate 复用生产约束句式（knowledgeService.ts「引用 MUST 逐字取自 excerpt」）。
 */

/** 对齐 search_knowledge 的 excerpt 截断长度（toCitationPayload） */
export const EXCERPT_CHARS = 280

/** context = 召回片段逐字使用并截断到 EXCERPT_CHARS */
export function buildContextFromExcerpts(excerpts: string[]): string[] {
  return excerpts.map((excerpt) => excerpt.slice(0, EXCERPT_CHARS))
}

export function buildJudgePrompt(opts: {
  query: string
  context: string[]
  answer: string
}): { system: string; user: string } {
  const { query, context, answer } = opts
  const system = [
    '你是 RAG 忠实度（faithfulness）评审。你会看到【召回片段】（检索自本地知识库）与一句【模型回答】。',
    '任务分两步：',
    '1. 把模型回答拆解为原子主张（claim）——每个 claim 必须直接改写自回答原文中的子句，',
    '   可以拆分句子、去掉连接词，但不得自行补充、推理或改写出回答里没有的内容；',
    '2. 逐条判定 claim 是否被召回片段支持：只要 claim 包含片段之外的任何信息',
    '   （编造数字/细节/来源、过度推断、与片段矛盾），即视为不支持（supported=false）；',
    '   例外：若模型如实表示知识库中未找到相关内容、未对问题作任何事实断言，',
    '   这类「未找到」表述应视为忠实（supported=true），不得因片段未提及而判不支持。',
    '只输出 JSON 数组，不要输出任何其它文字，格式：',
    '[{"claim": "...", "supported": true|false, "reason": "一句话理由"}]',
  ].join('\n')

  const user = [
    `【召回片段】\n${context.map((item, index) => `${index + 1}. ${item}`).join('\n')}`,
    `【模型回答】${answer}`,
    `【用户查询】${query}`,
    '请拆解并逐条判定。',
  ].join('\n\n')
  return { system, user }
}

export function buildGeneratePrompt(opts: {
  query: string
  context: string[]
}): { system: string; user: string } {
  const { query, context } = opts
  const system =
    '你是桌面智能体的知识库问答。请根据【召回片段】回答用户问题。' +
    '引用 MUST 逐字取自以下 excerpt，不得补充结果外内容；片段中没有的信息禁止编造；' +
    '若未检索到相关内容或片段与问题无关，如实说明知识库中未找到相关内容。只输出回答正文，不要解释。'
  const user = [
    `【召回片段】\n${context.map((item, index) => `${index + 1}. ${item}`).join('\n')}`,
    `【用户问题】${query}`,
    '请回答。',
  ].join('\n\n')
  return { system, user }
}
