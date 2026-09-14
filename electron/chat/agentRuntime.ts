import { randomUUID } from 'node:crypto'
import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import type {
  AgentTool,
  ChatMessage,
  ProviderRuntimeConfig,
  ToolRiskLevel,
} from '../../src/chat/contracts'
import {
  ContextUsageTracker,
  emptyContextSectionBreakdown,
  type ContextObservation,
} from './contextUsage'
import { DEFAULT_SYSTEM_PROMPT } from './deepSeekProvider'
import { isContextDebugEnabled, logContext } from './contextDebug'
import { trimContextWeighted } from './messageImportance'
import type { MemoryService } from './memoryService'
import { classifyToolError, summarizeToolInput } from './redact'
import type { ToolRegistry } from './toolRegistry'
import type { SkillRouter } from './skills/types'
import type { ChatProvider, GuardConfig } from '../../src/chat/contracts'
import type {
  TraceDroppedReason,
  TraceRetrievalHit,
  TraceRetrievalSource,
  TraceStepNode,
} from '../../src/trace/contracts'
import type { TraceRecorder } from '../trace/traceRecorder'

/**
 * AgentRuntime 消费的最小 Provider 接口：从 ChatProvider 泛化而来，
 * 保留别名保证既有测试（agentRuntime.test.ts 只传 stream 的 mock）零改动。
 */
export type AgentProvider = Pick<ChatProvider, 'stream' | 'planToolCalls'>

export type PendingToolCall = {
  name: string
  input: unknown
}

export type ToolBoundaryEvent =
  | {
      phase: 'start'
      toolName: string
      /** 本轮内唯一调用标识（运行时生成，供链路追踪关联 call/result） */
      callId?: string
      riskLevel?: ToolRiskLevel
      inputSummary: string
      /** 脱敏前的原始入参（链路追踪据此记录真实参数） */
      input?: unknown
    }
  | {
      phase: 'end'
      toolName: string
      callId?: string
      ok: boolean
      errorCode?: string
      errorMessage?: string
      latencyMs: number
      inputSummary: string
      input?: unknown
      /** 工具真实输出（链路追踪据此记录真实结果） */
      output?: unknown
    }

/** 单次用户请求内最大工具规划轮数（含首轮） */
export const MAX_TOOL_ROUNDS = 2
/** 单次用户请求内最大工具执行次数 */
export const MAX_TOOL_CALLS = 6

const AgentState = Annotation.Root({
  sessionId: Annotation<string>(),
  messages: Annotation<ChatMessage[]>(),
  /** normalize 前的完整历史：会话摘要 MUST 基于它计算，而非已裁剪窗口 */
  allMessages: Annotation<ChatMessage[]>(),
  systemPrompt: Annotation<string>(),
  pendingToolCalls: Annotation<PendingToolCall[]>(),
  toolResults: Annotation<string[]>(),
  toolRound: Annotation<number>(),
  totalToolCalls: Annotation<number>(),
  lastRoundHadTools: Annotation<boolean>(),
  /** 仅当上轮含检索类工具时才二次规划，避免 remember_fact 双写 */
  lastRoundShouldReplan: Annotation<boolean>(),
  reply: Annotation<string>(),
})

const REPLAN_TRIGGER_TOOLS = new Set(['search_knowledge'])
const MEMORY_WRITE_TOOLS = new Set(['remember_fact', 'update_profile'])
const RELATIONSHIP_WRITE_TOOLS = new Set(['update_relationship'])

/** 用户消息是否涉及与桌宠的好感/关系变化（路由到 update_relationship） */
export function hasRelationshipIntent(text: string): boolean {
  return /好感|亲密度|更喜欢|更喜欢你|讨厌你|讨厌我|和你的关系|我们的关系|关系变|你对我.{0,6}态度|感情变/.test(
    text,
  )
}

export function hasSuccessfulRelationshipWrite(toolResults: string[]): boolean {
  for (const raw of toolResults) {
    try {
      const parsed = JSON.parse(raw) as { tool?: string; ok?: boolean }
      if (parsed.ok && typeof parsed.tool === 'string' && RELATIONSHIP_WRITE_TOOLS.has(parsed.tool)) {
        return true
      }
    } catch {
      // ignore
    }
  }
  return false
}

/** 取最近一条完整用户消息正文 */
export function latestUserText(messages: ChatMessage[]): string {
  return (
    [...messages].reverse().find((message) => message.role === 'user')?.content ?? ''
  )
}

/** 用户是否明确要求写入长期记忆 */
export function hasRememberIntent(text: string): boolean {
  return /记住|记一下|记下来|帮我记|请记|记着|记得住|记牢/.test(text)
}

/**
 * 记住请求是否其实是口吻/输出规范（应改人设，不应 remember_fact）。
 * 仅在 hasRememberIntent 为真时有意义。
 */
export function isPersonaStyleRememberRequest(text: string): boolean {
  if (!hasRememberIntent(text)) return false
  return /简洁|口吻|加喵|称呼|输出规范|说话方式|回复风格|回答风格|语气|人设/.test(text)
}

export function hasSuccessfulMemoryWrite(toolResults: string[]): boolean {
  for (const raw of toolResults) {
    try {
      const parsed = JSON.parse(raw) as { tool?: string; ok?: boolean }
      if (parsed.ok && typeof parsed.tool === 'string' && MEMORY_WRITE_TOOLS.has(parsed.tool)) {
        return true
      }
    } catch {
      // ignore
    }
  }
  return false
}

function buildReplanToolNote(toolResults: string[], userText: string): string {
  const header = `【已有工具结果】\n${toolResults.join('\n')}\n`
  let memoryHint =
    '若仍需继续调用工具（例如先检索后再写记忆），请规划下一步；'
  if (hasRememberIntent(userText) && !hasSuccessfulMemoryWrite(toolResults)) {
    memoryHint = isPersonaStyleRememberRequest(userText)
      ? '用户要求的是口吻/输出规范类偏好，不要调用记忆工具；最终回复应提示改人设，禁止口头声称已记住。'
      : '用户本轮明确要求记住事实/约定，且上方尚无成功的 remember_fact/update_profile，MUST 规划对应记忆工具（可写入检索结论或用户所述事实）；禁止只用口头声称已记住。'
  }
  return `\n\n${header}${memoryHint}已成功写入的同一事实不要再次 remember_fact；若无需其他工具则不要调用工具。`
}

export function dedupePendingToolCalls(calls: PendingToolCall[]): PendingToolCall[] {
  const seen = new Set<string>()
  const result: PendingToolCall[] = []
  for (const call of calls) {
    const key = `${call.name}:${stableToolInputKey(call.input)}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(call)
  }
  return result
}

function stableToolInputKey(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return JSON.stringify(input ?? null)
  }
  const record = input as Record<string, unknown>
  const omit = new Set(['sourceSessionId'])
  const normalized: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort()) {
    if (omit.has(key)) continue
    normalized[key] = record[key]
  }
  return JSON.stringify(normalized)
}

function filterAlreadySucceededCalls(
  calls: PendingToolCall[],
  toolResults: string[],
): PendingToolCall[] {
  const succeeded = new Set<string>()
  for (const raw of toolResults) {
    try {
      const parsed = JSON.parse(raw) as { tool?: string; ok?: boolean; output?: unknown }
      if (!parsed.ok || typeof parsed.tool !== 'string') continue
      const content =
        parsed.output &&
        typeof parsed.output === 'object' &&
        parsed.output !== null &&
        'item' in (parsed.output as object)
          ? (parsed.output as { item?: { content?: string } }).item?.content
          : undefined
      const fromInput =
        parsed.output &&
        typeof parsed.output === 'object' &&
        parsed.output !== null &&
        'content' in (parsed.output as object)
          ? String((parsed.output as { content?: unknown }).content ?? '')
          : ''
      succeeded.add(`${parsed.tool}:${content ?? fromInput}`)
    } catch {
      // ignore
    }
  }
  return calls.filter((call) => {
    if (call.name !== 'remember_fact' && call.name !== 'update_profile') return true
    const content =
      call.input && typeof call.input === 'object' && call.input !== null
        ? String((call.input as { content?: unknown }).content ?? '')
        : ''
    return !succeeded.has(`${call.name}:${content}`)
  })
}

export function trimContext(
  messages: ChatMessage[],
  maxCharacters = 24_000,
  options?: { importanceTrim: boolean; recentWindowChars: number },
): ChatMessage[] {
  return trimContextWeighted(messages, maxCharacters, options)
}

function withSourceSession(input: unknown, sessionId: string): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { sourceSessionId: sessionId }
  }
  const record = input as Record<string, unknown>
  if (typeof record.sourceSessionId === 'string' && record.sourceSessionId.trim()) {
    return input
  }
  return { ...record, sourceSessionId: sessionId }
}

/** 检索类工具 → 链路追踪的检索来源标记 */
const RETRIEVAL_TOOL_SOURCES: Record<string, TraceRetrievalSource> = {
  search_knowledge: 'knowledge',
  search_history: 'history',
}

/**
 * 从检索工具的返回值中提取命中条目，供链路追踪记录「模型看到了哪些片段」。
 * 只读取已经算出的分数（稀疏/向量/融合/重排），不做任何额外计算。
 */
export function retrievalHitsFromOutput(
  output: unknown,
  source: TraceRetrievalSource,
): TraceRetrievalHit[] {
  if (!output || typeof output !== 'object') return []
  const hits = (output as { hits?: unknown }).hits
  if (!Array.isArray(hits)) return []
  const mapped: TraceRetrievalHit[] = []
  hits.forEach((hit, index) => {
    if (!hit || typeof hit !== 'object') return
    const value = hit as Record<string, unknown>
    const identifier = [
      value.documentId,
      value.chunkId,
      value.sessionId,
      value.messageId,
      value.id,
    ].find((candidate): candidate is string => typeof candidate === 'string')
    const recallSource =
      value.recallSource === 'sparse' ||
      value.recallSource === 'vector' ||
      value.recallSource === 'both'
        ? value.recallSource
        : undefined
    mapped.push({
      id: identifier ?? `${source}-${index}`,
      score: typeof value.score === 'number' ? value.score : undefined,
      sparseScore: typeof value.sparseScore === 'number' ? value.sparseScore : undefined,
      vectorScore: typeof value.vectorScore === 'number' ? value.vectorScore : undefined,
      rerankScore: typeof value.rerankScore === 'number' ? value.rerankScore : undefined,
      recallSource,
      title:
        typeof value.title === 'string'
          ? value.title
          : typeof value.content === 'string'
            ? value.content.slice(0, 80)
            : undefined,
    })
  })
  return mapped
}

function emitPlanFailure(
  onToolEvent: ((event: ToolBoundaryEvent) => void) | undefined,
  message: string,
): void {
  const inputSummary = '规划工具调用'
  onToolEvent?.({
    phase: 'start',
    toolName: 'plan_tools',
    inputSummary,
  })
  onToolEvent?.({
    phase: 'end',
    toolName: 'plan_tools',
    ok: false,
    errorCode: 'plan_failed',
    errorMessage: message,
    latencyMs: 0,
    inputSummary,
  })
}

/**
 * 将工具成败转为模型必须遵守的中文约束。
 * 成功结果的渲染全部委托给工具自身的 renderForModel（内容型工具 MUST 透传真实输出，
 * 见 contract `AgentTool.renderForModel`）；本函数只保留跨工具回复策略：
 * 失败/取消硬约束、记住意图/关系意图约束、空成功提示与不可信区隔离标记。
 * guardConfig 提供时，工具渲染器据此用不可信区隔离外部原文（Prompt 注入防护，
 * 见 untrustedContent.ts）；缺省时行为不变。
 */
export function formatToolResultsForModel(
  toolResults: string[],
  userText = '',
  guardConfig?: GuardConfig,
  registry?: ToolRegistry,
): string {
  const lines: string[] = []
  let hasFailure = false
  let hasSuccess = false
  if (toolResults.length > 0) {
    lines.push('【工具结果 — 回复时必须严格遵守】')
    for (const raw of toolResults) {
      try {
        const parsed = JSON.parse(raw) as {
          tool?: string
          ok?: boolean
          error?: string
          errorCode?: string
          output?: unknown
        }
        const tool = parsed.tool ?? 'unknown'
        if (parsed.ok) {
          hasSuccess = true
          const renderer = registry?.get(tool)?.renderForModel
          lines.push(
            renderer ? renderer(parsed.output, guardConfig) : `- ${tool}：成功`,
          )
          continue
        }
        hasFailure = true
        const cancelled = parsed.errorCode === 'cancelled'
        if (tool === 'forget_memory' && cancelled) {
          lines.push(
            '- forget_memory：用户在确认框中选择了「拒绝/取消」。记忆仍保留在系统中，未被删除。回复 MUST 明确说明：因为用户取消确认，所以没有忘记/删除该记忆；禁止声称已经忘记或已删除。',
          )
        } else if (cancelled) {
          lines.push(
            `- ${tool}：用户取消确认，操作未执行。回复 MUST 说明操作已取消、未生效；禁止假装已完成。`,
          )
        } else {
          lines.push(
            `- ${tool}：失败（${parsed.errorCode ?? 'error'}：${parsed.error ?? '未知错误'}）。回复 MUST 说明未能完成，禁止假装成功。`,
          )
        }
      } catch {
        lines.push(`- 原始结果：${raw}`)
      }
    }
    if (hasFailure && !hasSuccess) {
      lines.push('注意：本轮没有任何工具成功执行。请据实回复，不要用角色扮演掩盖失败。')
    }
  }

  if (userText && hasRememberIntent(userText) && !hasSuccessfulMemoryWrite(toolResults)) {
    if (lines.length === 0) {
      lines.push('【工具结果 — 回复时必须严格遵守】')
    }
    if (isPersonaStyleRememberRequest(userText)) {
      lines.push(
        '注意：用户要求的是口吻/输出规范类偏好，本轮未写入记忆。回复 MUST 提示在「管理已导入模型」中编辑人设；禁止声称已经记住。',
      )
    } else {
      lines.push(
        '注意：用户要求记住某事实/约定，但本轮没有成功的 remember_fact/update_profile。回复 MUST 据实说明未能写入记忆；禁止声称已经记住。',
      )
    }
  }

  if (userText && hasRelationshipIntent(userText) && !hasSuccessfulRelationshipWrite(toolResults)) {
    if (lines.length === 0) {
      lines.push('【工具结果 — 回复时必须严格遵守】')
    }
    lines.push(
      '注意：用户的话语涉及你们的好感/关系变化，但本轮没有成功的 update_relationship。回复 MUST 据实说明，禁止声称已改变好感或关系状态。',
    )
  }

  if (lines.length === 0) return ''
  return `\n\n${lines.join('\n')}`
}

export class AgentRuntime {
  constructor(
    private readonly provider: AgentProvider,
    private readonly tools: ToolRegistry,
    private readonly memory?: MemoryService,
    private readonly contextBudget = 24_000,
    /** 规划期工具过滤：返回 false 的工具不进入模型可选集合（如人设优先时屏蔽 update_relationship） */
    private readonly planToolFilter?: (
      tool: AgentTool,
      packageId: string,
    ) => boolean | Promise<boolean>,
    private readonly trimOptions?: { importanceTrim: boolean; recentWindowChars: number },
    /** Prompt 注入防护配置：提供时外部工具原文以不可信区隔离 */
    private readonly guardConfig?: GuardConfig,
    /** 技能路由钩子：recall 阶段命中技能时注入其规则文本 */
    private readonly skillRouter?: SkillRouter,
    /** 会话级上下文占用观测表（缺省时新建，供 chat:context:usage IPC 查询） */
    private readonly contextUsageTracker = new ContextUsageTracker(),
  ) {}

  /** 读取某会话最近一次上下文组装观测（供测试与 IPC 查询） */
  getContextUsage(sessionId: string, packageId?: string): ContextObservation | undefined {
    return this.contextUsageTracker.get(sessionId, packageId)
  }

  async run(input: {
    sessionId: string
    packageId: string
    messages: ChatMessage[]
    config: ProviderRuntimeConfig
    signal: AbortSignal
    onToken: (token: string) => void
    pendingToolCalls?: PendingToolCall[]
    onToolEvent?: (event: ToolBoundaryEvent) => void
    /** riskLevel=confirm 时调用；未提供或返回 false 则不执行 */
    confirmTool?: (toolName: string, rawInput: unknown) => Promise<boolean>
    /** 链路追踪记录器；缺省时不产生任何观测事件 */
    trace?: TraceRecorder | null
  }): Promise<string> {
    const memory = this.memory
    const tools = this.tools
    const budget = this.contextBudget
    const provider = this.provider
    const onToolEvent = input.onToolEvent
    const trace = input.trace ?? null
    /** 本轮组装观测（recall/model/plan 各节点累加后统一写入 tracker） */
    const usage = emptyContextSectionBreakdown()
    let finalSystemPrompt = ''

    /** 把图节点包成链路追踪 span（未开启追踪时零开销） */
    const wrap = <R>(
      node: TraceStepNode,
      fn: (state: typeof AgentState.State) => Promise<R>,
    ) =>
      async (state: typeof AgentState.State): Promise<R> =>
        trace ? trace.span(node, () => fn(state)) : fn(state)

    const planPending = async (
      state: typeof AgentState.State,
      options: { includeToolResults: boolean; round: number },
    ): Promise<PendingToolCall[]> => {
      let registered = tools.listForPlanning()
      if (this.planToolFilter) {
        const filtered: AgentTool[] = []
        for (const tool of registered) {
          if (await this.planToolFilter(tool, input.packageId)) filtered.push(tool)
        }
        registered = filtered
      }
      if (!provider.planToolCalls || registered.length === 0) return []
      const remaining = MAX_TOOL_CALLS - (state.totalToolCalls ?? 0)
      if (remaining <= 0) return []
      const toolNote =
        options.includeToolResults && (state.toolResults?.length ?? 0) > 0
          ? buildReplanToolNote(state.toolResults ?? [], latestUserText(state.messages))
          : ''
      const catalog = memory?.listForPlanning(24) ?? []
      const memoryNote =
        catalog.length > 0
          ? `\n\n【可遗忘记忆列表】（forget_memory 只能使用下列 id）\n${catalog
              .map((item) => `- id=${item.id} | ${item.type} | ${item.content}`)
              .join('\n')}`
          : '\n\n【可遗忘记忆列表】当前为空；用户要求忘记时不要调用 forget_memory。'
      // 工具目录占用（供上下文占用拆分）：规划提示里工具定义 + 遗忘列表
      usage.systemToolsCharacters = JSON.stringify(registered.map((tool) => tool.parameters)).length
      const plannerPrompt = `${state.systemPrompt || DEFAULT_SYSTEM_PROMPT}${toolNote}${memoryNote}`
      trace?.requestHeader({
        kind: 'plan',
        providerKind: input.config.providerKind ?? 'deepseek',
        model: input.config.plannerModel || input.config.model,
        systemPrompt: plannerPrompt,
        messageCount: state.messages.length,
        messageCharacters: state.messages.reduce(
          (sum, message) => sum + message.content.length,
          0,
        ),
        tools: registered.map((tool) => tool.name),
      })
      trace?.modelCall({
        kind: 'plan',
        providerKind: input.config.providerKind ?? 'deepseek',
        model: input.config.plannerModel || input.config.model,
        streaming: false,
      })
      const planStarted = Date.now()
      try {
        const planned = await provider.planToolCalls(
          state.messages,
          input.config,
          input.signal,
          plannerPrompt,
          [...registered],
        )
        trace?.modelResult({
          kind: 'plan',
          model: input.config.plannerModel || input.config.model,
          ok: true,
          latencyMs: Date.now() - planStarted,
          finishReason: planned.finishReason,
          usage: planned.usage,
        })
        const allowed = new Set(registered.map((tool) => tool.name))
        /** 被丢弃的调用及原因，供链路追踪解释「为什么没调这个工具」 */
        const dropped: Array<{ name: string; reason: TraceDroppedReason }> = []
        const accepted: PendingToolCall[] = []
        for (const call of planned.toolCalls) {
          if (!allowed.has(call.name)) {
            dropped.push({ name: call.name, reason: 'not_allowed' })
            continue
          }
          accepted.push({
            name: call.name,
            input: withSourceSession(call.input, state.sessionId),
          })
        }
        let pendingToolCalls = dedupePendingToolCalls(accepted)
        for (const call of accepted) {
          if (!pendingToolCalls.includes(call)) {
            dropped.push({ name: call.name, reason: 'duplicate' })
          }
        }
        if (options.includeToolResults) {
          const filtered = filterAlreadySucceededCalls(
            pendingToolCalls,
            state.toolResults ?? [],
          )
          for (const call of pendingToolCalls) {
            if (!filtered.includes(call)) {
              dropped.push({ name: call.name, reason: 'already_succeeded' })
            }
          }
          pendingToolCalls = filtered
        }
        const limited = pendingToolCalls.slice(0, Math.min(3, remaining))
        for (const call of pendingToolCalls.slice(limited.length)) {
          dropped.push({ name: call.name, reason: 'over_budget' })
        }
        trace?.planResult({
          round: options.round,
          candidates: registered.length,
          planned: limited,
          dropped,
        })
        return limited
      } catch (error) {
        const message = error instanceof Error ? error.message : '工具规划失败'
        trace?.modelResult({
          kind: 'plan',
          model: input.config.plannerModel || input.config.model,
          ok: false,
          latencyMs: Date.now() - planStarted,
          errorCode: input.signal.aborted ? 'cancelled' : 'plan_failed',
          message,
        })
        trace?.planResult({
          round: options.round,
          candidates: registered.length,
          planned: [],
          dropped: [],
          failed: message,
        })
        emitPlanFailure(onToolEvent, message)
        return []
      }
    }

    const graph = new StateGraph(AgentState)
      .addNode('normalize', wrap('normalize', async (state) => ({
        allMessages: state.messages,
        messages: trimContext(state.messages, budget, this.trimOptions),
      })))
      .addNode('recall', wrap('recall', async (state) => {
        const query =
          [...state.messages].reverse().find((message) => message.role === 'user')
            ?.content ?? ''
        let systemPrompt: string
        let recentMessages: ChatMessage[] | undefined
        if (!memory) {
          systemPrompt = DEFAULT_SYSTEM_PROMPT
        } else {
          // 会话摘要基于裁剪前完整历史（allMessages），可见窗口由 assemble 内部按预算裁剪
          const recallStarted = Date.now()
          const assembled = await memory.assemble({
            sessionId: state.sessionId,
            packageId: input.packageId,
            messages: state.allMessages ?? state.messages,
            query,
            config: input.config,
            signal: input.signal,
            budget,
          })
          systemPrompt = assembled.systemPrompt
          recentMessages = assembled.recentMessages
          usage.memoryCharacters = assembled.memoryCharacters ?? 0
          trace?.retrievalHits({
            source: 'memory',
            query,
            latencyMs: Date.now() - recallStarted,
            hits: assembled.recalledItems.map((item) => ({
              id: item.id,
              score: (item as { score?: number }).score,
              title: item.content.slice(0, 80),
            })),
          })
        }
        if (this.skillRouter) {
          const hit = await this.skillRouter.route(query, input.signal)
          trace?.skillRoute({
            hit: hit !== null,
            skillId: hit?.skill.id,
            rulesCharacters: hit?.rulesText.length,
          })
          if (hit) {
            usage.skillsCharacters = hit.rulesText.length
            systemPrompt = `${systemPrompt}\n\n${hit.rulesText}`
          }
        }
        // systemPrompt 内嵌了记忆块与技能文本：剔除这两部分避免重复计入，
        // 使 systemPrompt 一项代表 人设/关系/每日状态/会话摘要 的固定部分。
        usage.systemPromptCharacters = Math.max(
          0,
          systemPrompt.length - usage.memoryCharacters - usage.skillsCharacters,
        )
        finalSystemPrompt = systemPrompt
        return recentMessages
          ? { messages: recentMessages, systemPrompt }
          : { systemPrompt }
      }))
      .addNode('plan', wrap('plan', async (state) => {
        if ((state.pendingToolCalls?.length ?? 0) > 0) {
          return { pendingToolCalls: state.pendingToolCalls }
        }
        const pendingToolCalls = await planPending(state, {
          includeToolResults: false,
          round: 1,
        })
        return { pendingToolCalls }
      }))
      .addNode('toolBoundary', wrap('toolBoundary', async (state) => {
        const pending = state.pendingToolCalls ?? []
        if (pending.length === 0) {
          return {
            lastRoundHadTools: false,
            lastRoundShouldReplan: false,
            pendingToolCalls: [] as PendingToolCall[],
          }
        }

        const results: string[] = [...(state.toolResults ?? [])]
        let executed = 0
        const executedNames: string[] = []
        for (const call of pending) {
          if ((state.totalToolCalls ?? 0) + executed >= MAX_TOOL_CALLS) break
          executed += 1
          executedNames.push(call.name)
          const inputSummary = summarizeToolInput(call.input)
          const callId = `call_${randomUUID()}`
          const riskLevel = tools.getRiskLevel(call.name) ?? 'safe'
          const tool = tools.get(call.name)
          if (!tool) {
            const errorCode = 'not_found'
            const errorMessage = `工具不存在：${call.name}`
            onToolEvent?.({
              phase: 'start',
              toolName: call.name,
              callId,
              riskLevel,
              inputSummary,
              input: call.input,
            })
            onToolEvent?.({
              phase: 'end',
              toolName: call.name,
              callId,
              ok: false,
              errorCode,
              errorMessage,
              latencyMs: 0,
              inputSummary,
              input: call.input,
            })
            trace?.toolResult({
              callId,
              name: call.name,
              ok: false,
              latencyMs: 0,
              errorCode,
              message: errorMessage,
            })
            results.push(JSON.stringify({ tool: call.name, ok: false, error: errorMessage }))
            continue
          }
          if (!tools.isEnabled(call.name)) {
            const errorCode = 'disabled'
            const errorMessage = `工具未启用：${call.name}`
            onToolEvent?.({
              phase: 'start',
              toolName: call.name,
              callId,
              riskLevel,
              inputSummary,
              input: call.input,
            })
            onToolEvent?.({
              phase: 'end',
              toolName: call.name,
              callId,
              ok: false,
              errorCode,
              errorMessage,
              latencyMs: 0,
              inputSummary,
              input: call.input,
            })
            trace?.toolResult({
              callId,
              name: call.name,
              ok: false,
              latencyMs: 0,
              errorCode,
              message: errorMessage,
            })
            results.push(JSON.stringify({ tool: call.name, ok: false, error: errorMessage }))
            continue
          }

          trace?.toolCall({ callId, name: call.name, riskLevel, args: call.input })

          if (tools.getRiskLevel(call.name) === 'confirm') {
            const confirmStarted = Date.now()
            const confirmed = input.confirmTool
              ? await input.confirmTool(call.name, call.input)
              : false
            trace?.toolConfirm({
              callId,
              name: call.name,
              decision: confirmed ? 'approved' : 'denied',
              waitedMs: Date.now() - confirmStarted,
            })
            if (!confirmed) {
              const errorCode = 'cancelled'
              const errorMessage =
                call.name === 'forget_memory'
                  ? '用户取消确认：记忆未被删除'
                  : `用户取消工具：${call.name}`
              onToolEvent?.({
                phase: 'start',
                toolName: call.name,
                callId,
                riskLevel,
                inputSummary,
                input: call.input,
              })
              onToolEvent?.({
                phase: 'end',
                toolName: call.name,
                callId,
                ok: false,
                errorCode,
                errorMessage,
                latencyMs: 0,
                inputSummary,
                input: call.input,
              })
              trace?.toolResult({
                callId,
                name: call.name,
                ok: false,
                latencyMs: 0,
                errorCode,
                message: errorMessage,
              })
              results.push(
                JSON.stringify({
                  tool: call.name,
                  ok: false,
                  error: errorMessage,
                  errorCode,
                  deleted: false,
                }),
              )
              continue
            }
          }

          onToolEvent?.({
            phase: 'start',
            toolName: call.name,
            callId,
            riskLevel,
            inputSummary,
            input: call.input,
          })
          const started = Date.now()
          try {
            const validated = tool.validate(call.input)
            const output = await tool.execute(validated, input.signal, {
              packageId: input.packageId,
            })
            const latencyMs = Date.now() - started
            onToolEvent?.({
              phase: 'end',
              toolName: call.name,
              callId,
              ok: true,
              latencyMs,
              inputSummary,
              input: call.input,
              output,
            })
            trace?.toolResult({
              callId,
              name: call.name,
              ok: true,
              latencyMs,
              output,
            })
            const retrievalSource = RETRIEVAL_TOOL_SOURCES[call.name]
            if (retrievalSource) {
              const hits = retrievalHitsFromOutput(output, retrievalSource)
              trace?.retrievalHits({
                source: retrievalSource,
                query: String((call.input as { query?: unknown })?.query ?? ''),
                topK: (call.input as { topK?: number })?.topK,
                latencyMs,
                hits,
              })
            }
            results.push(JSON.stringify({ tool: call.name, ok: true, output }))
          } catch (error) {
            const latencyMs = Date.now() - started
            const classified = classifyToolError(error)
            onToolEvent?.({
              phase: 'end',
              toolName: call.name,
              callId,
              ok: false,
              errorCode: classified.errorCode,
              errorMessage: classified.message,
              latencyMs,
              inputSummary,
              input: call.input,
            })
            trace?.toolResult({
              callId,
              name: call.name,
              ok: false,
              latencyMs,
              errorCode: classified.errorCode,
              message: classified.message,
            })
            results.push(
              JSON.stringify({
                tool: call.name,
                ok: false,
                error: classified.message,
                errorCode: classified.errorCode,
              }),
            )
          }
        }
        return {
          toolResults: results,
          pendingToolCalls: [] as PendingToolCall[],
          toolRound: (state.toolRound ?? 0) + 1,
          totalToolCalls: (state.totalToolCalls ?? 0) + executed,
          lastRoundHadTools: true,
          lastRoundShouldReplan: executedNames.some((name) => REPLAN_TRIGGER_TOOLS.has(name)),
        }
      }))
      .addNode('maybeReplan', wrap('maybeReplan', async (state) => {
        if (!state.lastRoundHadTools || !state.lastRoundShouldReplan) {
          return { pendingToolCalls: [] as PendingToolCall[], lastRoundShouldReplan: false }
        }
        if ((state.toolRound ?? 0) >= MAX_TOOL_ROUNDS) {
          return { pendingToolCalls: [] as PendingToolCall[], lastRoundShouldReplan: false }
        }
        if ((state.totalToolCalls ?? 0) >= MAX_TOOL_CALLS) {
          return { pendingToolCalls: [] as PendingToolCall[], lastRoundShouldReplan: false }
        }
        const pendingToolCalls = await planPending(state, {
          includeToolResults: true,
          round: 2,
        })
        return {
          pendingToolCalls,
          lastRoundHadTools: false,
          lastRoundShouldReplan: false,
        }
      }))
      .addNode('model', wrap('model', async (state) => {
        const systemPrompt = state.systemPrompt || DEFAULT_SYSTEM_PROMPT
        const toolNote = formatToolResultsForModel(
          state.toolResults ?? [],
          latestUserText(state.messages),
          this.guardConfig,
          tools,
        )
        const finalPrompt = `${systemPrompt}${toolNote}`
        usage.messagesCharacters = state.messages.reduce(
          (sum, message) => sum + message.content.length,
          0,
        )
        const observation: ContextObservation = {
          sessionId: state.sessionId,
          packageId: input.packageId,
          ...usage,
        }
        this.contextUsageTracker.record(observation)
        // [TEMP-DEBUG] 观察上下文管理策略是否生效（写 UTF-8 文件避免 cmd 乱码），验证后删除
        if (isContextDebugEnabled()) {
          const usedCharacters =
            observation.systemPromptCharacters +
            observation.systemToolsCharacters +
            observation.skillsCharacters +
            observation.memoryCharacters +
            observation.messagesCharacters
          void logContext([
            {
              label: '预算/占用',
              content: `预算=${budget} 已用=${usedCharacters} (${Math.round((usedCharacters / budget) * 100)}%)`,
            },
            {
              label: '窗口概况',
              content: `近期窗口消息数=${state.messages.length} 完整历史消息数=${state.allMessages?.length ?? '?'}`,
            },
            { label: '系统提示词', content: finalSystemPrompt || finalPrompt },
            {
              label: '近期消息序列（角色[字符数]）',
              content: state.messages
                .map((m) => `${m.role === 'user' ? '用户' : '桌宠'}[${m.content.length}]`)
                .join(' '),
            },
          ])
          console.log(
            `[context-debug] wrote to data/logs/context-debug.log at ${new Date().toISOString()}`,
          )
        }
        trace?.requestContext({
          budgetCharacters: budget,
          parts: {
            systemPrompt: observation.systemPromptCharacters,
            systemTools: observation.systemToolsCharacters,
            skills: observation.skillsCharacters,
            memory: observation.memoryCharacters,
            messages: observation.messagesCharacters,
          },
        })
        trace?.requestHeader({
          kind: 'reply',
          providerKind: input.config.providerKind ?? 'deepseek',
          model: input.config.model,
          systemPrompt: finalPrompt,
          messageCount: state.messages.length,
          messageCharacters: observation.messagesCharacters,
          tools: tools.listForPlanning().map((tool) => tool.name),
        })
        trace?.modelCall({
          kind: 'reply',
          providerKind: input.config.providerKind ?? 'deepseek',
          model: input.config.model,
          streaming: true,
        })
        const callStarted = Date.now()
        let firstTokenAt: number | undefined
        try {
          const result = await provider.stream(
            state.messages,
            input.config,
            input.signal,
            (token) => {
              firstTokenAt ??= Date.now()
              input.onToken(token)
            },
            finalPrompt,
          )
          const reply = result.text
          trace?.modelResult({
            kind: 'reply',
            model: input.config.model,
            ok: true,
            latencyMs: Date.now() - callStarted,
            ttftMs:
              result.ttftMs ??
              (firstTokenAt === undefined ? undefined : firstTokenAt - callStarted),
            finishReason: result.finishReason,
            usage: result.usage,
            characters: reply.length,
          })
          return { reply }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          trace?.modelResult({
            kind: 'reply',
            model: input.config.model,
            ok: false,
            latencyMs: Date.now() - callStarted,
            ttftMs: firstTokenAt === undefined ? undefined : firstTokenAt - callStarted,
            errorCode: input.signal.aborted ? 'cancelled' : 'model_error',
            message,
          })
          throw error
        }
      }))
      .addNode('commit', wrap('commit', async (state) => ({ reply: state.reply })))
      .addEdge(START, 'normalize')
      .addEdge('normalize', 'recall')
      .addEdge('recall', 'plan')
      .addEdge('plan', 'toolBoundary')
      .addEdge('toolBoundary', 'maybeReplan')
      .addConditionalEdges('maybeReplan', (state) =>
        (state.pendingToolCalls?.length ?? 0) > 0 ? 'toolBoundary' : 'model',
      )
      .addEdge('model', 'commit')
      .addEdge('commit', END)
      .compile()

    const result = await graph.invoke({
      sessionId: input.sessionId,
      messages: input.messages,
      allMessages: input.messages,
      systemPrompt: '',
      pendingToolCalls: input.pendingToolCalls ?? [],
      toolResults: [],
      toolRound: 0,
      totalToolCalls: 0,
      lastRoundHadTools: false,
      lastRoundShouldReplan: false,
      reply: '',
    })
    return result.reply
  }
}
