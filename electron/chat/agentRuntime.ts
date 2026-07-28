import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import type {
  AgentTool,
  ChatMessage,
  ProviderRuntimeConfig,
} from '../../src/chat/contracts'
import { DEFAULT_SYSTEM_PROMPT } from './deepSeekProvider'
import type { MemoryService } from './memoryService'
import { classifyToolError, summarizeToolInput } from './redact'
import type { ToolRegistry } from './toolRegistry'

export type AgentProvider = {
  stream: (
    messages: ChatMessage[],
    config: ProviderRuntimeConfig,
    signal: AbortSignal,
    onToken: (token: string) => void,
    systemPrompt?: string,
  ) => Promise<string>
  /** Optional: one-shot invoke that may return tool calls instead of text. */
  planToolCalls?: (
    messages: ChatMessage[],
    config: ProviderRuntimeConfig,
    signal: AbortSignal,
    systemPrompt: string,
    tools: AgentTool[],
  ) => Promise<{ toolCalls: PendingToolCall[]; text?: string }>
}

export type PendingToolCall = {
  name: string
  input: unknown
}

export type ToolBoundaryEvent =
  | {
      phase: 'start'
      toolName: string
      inputSummary: string
    }
  | {
      phase: 'end'
      toolName: string
      ok: boolean
      errorCode?: string
      errorMessage?: string
      latencyMs: number
      inputSummary: string
      output?: unknown
    }

/** 单次用户请求内最大工具规划轮数（含首轮） */
export const MAX_TOOL_ROUNDS = 2
/** 单次用户请求内最大工具执行次数 */
export const MAX_TOOL_CALLS = 6

const AgentState = Annotation.Root({
  sessionId: Annotation<string>(),
  messages: Annotation<ChatMessage[]>(),
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

export function trimContext(messages: ChatMessage[], maxCharacters = 24_000): ChatMessage[] {
  const eligible = messages.filter(
    (message) => message.status === 'complete' && message.content.trim(),
  )
  const result: ChatMessage[] = []
  let used = 0
  for (let index = eligible.length - 1; index >= 0; index -= 1) {
    const message = eligible[index]
    if (!message) continue
    if (result.length > 0 && used + message.content.length > maxCharacters) break
    result.unshift(message)
    used += message.content.length
  }
  return result
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
 * 若用户要求记住但未成功写记忆，禁止口头「已记住」；输出规范类则引导改人设。
 */
export function formatToolResultsForModel(toolResults: string[], userText = ''): string {
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
        }
        const tool = parsed.tool ?? 'unknown'
        if (parsed.ok) {
          hasSuccess = true
          lines.push(`- ${tool}：成功。可在回复中自然确认已完成，不要复述 JSON。`)
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

  if (lines.length === 0) return ''
  return `\n\n${lines.join('\n')}`
}

export class AgentRuntime {
  constructor(
    private readonly provider: AgentProvider,
    private readonly tools: ToolRegistry,
    private readonly memory?: MemoryService,
    private readonly contextBudget = 24_000,
  ) {}

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
  }): Promise<string> {
    const memory = this.memory
    const tools = this.tools
    const budget = this.contextBudget
    const provider = this.provider
    const onToolEvent = input.onToolEvent

    const planPending = async (
      state: typeof AgentState.State,
      options: { includeToolResults: boolean },
    ): Promise<PendingToolCall[]> => {
      const registered = tools.listForPlanning()
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
      try {
        const planned = await provider.planToolCalls(
          state.messages,
          input.config,
          input.signal,
          `${state.systemPrompt || DEFAULT_SYSTEM_PROMPT}${toolNote}${memoryNote}`,
          [...registered],
        )
        const allowed = new Set(registered.map((tool) => tool.name))
        let pendingToolCalls = planned.toolCalls
          .filter((call) => allowed.has(call.name))
          .map((call) => ({
            name: call.name,
            input: withSourceSession(call.input, state.sessionId),
          }))
        pendingToolCalls = dedupePendingToolCalls(pendingToolCalls)
        if (options.includeToolResults) {
          pendingToolCalls = filterAlreadySucceededCalls(
            pendingToolCalls,
            state.toolResults ?? [],
          )
        }
        return pendingToolCalls.slice(0, Math.min(3, remaining))
      } catch (error) {
        const message = error instanceof Error ? error.message : '工具规划失败'
        emitPlanFailure(onToolEvent, message)
        return []
      }
    }

    const graph = new StateGraph(AgentState)
      .addNode('normalize', async (state) => ({
        messages: trimContext(state.messages, budget),
      }))
      .addNode('recall', async (state) => {
        if (!memory) {
          return {
            systemPrompt: DEFAULT_SYSTEM_PROMPT,
          }
        }
        const query =
          [...state.messages].reverse().find((message) => message.role === 'user')
            ?.content ?? ''
        const assembled = await memory.assemble({
          sessionId: state.sessionId,
          packageId: input.packageId,
          messages: state.messages,
          query,
          config: input.config,
          signal: input.signal,
          budget,
        })
        return {
          messages: assembled.recentMessages,
          systemPrompt: assembled.systemPrompt,
        }
      })
      .addNode('plan', async (state) => {
        if ((state.pendingToolCalls?.length ?? 0) > 0) {
          return { pendingToolCalls: state.pendingToolCalls }
        }
        const pendingToolCalls = await planPending(state, { includeToolResults: false })
        return { pendingToolCalls }
      })
      .addNode('toolBoundary', async (state) => {
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
          const tool = tools.get(call.name)
          if (!tool) {
            const errorCode = 'not_found'
            const errorMessage = `工具不存在：${call.name}`
            onToolEvent?.({
              phase: 'start',
              toolName: call.name,
              inputSummary,
            })
            onToolEvent?.({
              phase: 'end',
              toolName: call.name,
              ok: false,
              errorCode,
              errorMessage,
              latencyMs: 0,
              inputSummary,
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
              inputSummary,
            })
            onToolEvent?.({
              phase: 'end',
              toolName: call.name,
              ok: false,
              errorCode,
              errorMessage,
              latencyMs: 0,
              inputSummary,
            })
            results.push(JSON.stringify({ tool: call.name, ok: false, error: errorMessage }))
            continue
          }

          if (tools.getRiskLevel(call.name) === 'confirm') {
            const confirmed = input.confirmTool
              ? await input.confirmTool(call.name, call.input)
              : false
            if (!confirmed) {
              const errorCode = 'cancelled'
              const errorMessage =
                call.name === 'forget_memory'
                  ? '用户取消确认：记忆未被删除'
                  : `用户取消工具：${call.name}`
              onToolEvent?.({
                phase: 'start',
                toolName: call.name,
                inputSummary,
              })
              onToolEvent?.({
                phase: 'end',
                toolName: call.name,
                ok: false,
                errorCode,
                errorMessage,
                latencyMs: 0,
                inputSummary,
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
            inputSummary,
          })
          const started = Date.now()
          try {
            const validated = tool.validate(call.input)
            const output = await tool.execute(validated, input.signal)
            const latencyMs = Date.now() - started
            onToolEvent?.({
              phase: 'end',
              toolName: call.name,
              ok: true,
              latencyMs,
              inputSummary,
              output,
            })
            results.push(JSON.stringify({ tool: call.name, ok: true, output }))
          } catch (error) {
            const latencyMs = Date.now() - started
            const classified = classifyToolError(error)
            onToolEvent?.({
              phase: 'end',
              toolName: call.name,
              ok: false,
              errorCode: classified.errorCode,
              errorMessage: classified.message,
              latencyMs,
              inputSummary,
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
      })
      .addNode('maybeReplan', async (state) => {
        if (!state.lastRoundHadTools || !state.lastRoundShouldReplan) {
          return { pendingToolCalls: [] as PendingToolCall[], lastRoundShouldReplan: false }
        }
        if ((state.toolRound ?? 0) >= MAX_TOOL_ROUNDS) {
          return { pendingToolCalls: [] as PendingToolCall[], lastRoundShouldReplan: false }
        }
        if ((state.totalToolCalls ?? 0) >= MAX_TOOL_CALLS) {
          return { pendingToolCalls: [] as PendingToolCall[], lastRoundShouldReplan: false }
        }
        const pendingToolCalls = await planPending(state, { includeToolResults: true })
        return {
          pendingToolCalls,
          lastRoundHadTools: false,
          lastRoundShouldReplan: false,
        }
      })
      .addNode('model', async (state) => {
        const systemPrompt = state.systemPrompt || DEFAULT_SYSTEM_PROMPT
        const toolNote = formatToolResultsForModel(
          state.toolResults ?? [],
          latestUserText(state.messages),
        )
        return {
          reply: await provider.stream(
            state.messages,
            input.config,
            input.signal,
            input.onToken,
            `${systemPrompt}${toolNote}`,
          ),
        }
      })
      .addNode('commit', async (state) => ({ reply: state.reply }))
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
