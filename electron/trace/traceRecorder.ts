import {
  EMPTY_TOKEN_USAGE,
  type TokenUsage,
  type TraceConfig,
  type TraceDroppedReason,
  type TraceModelCallKind,
  type TraceRetrievalHit,
  type TraceRetrievalSource,
  type TraceStepNode,
  type TraceTextValue,
  type TraceTurnStatus,
} from '../../src/trace/contracts'
import { redactFull, shapeJson, shapeSystemPrompt, shapeText, type FieldShapeContext } from './traceFields'
import type { TraceSessionWriter } from './traceWriter'

/**
 * 单轮链路记录器：向调用方提供类型化的事件 API，集中完成字段整形（脱敏 + 内联/摘要/外置）、
 * 用量累加与检查点刷盘。所有方法同步、不抛：观测失败绝不影响聊天主链路。
 */
export class TraceRecorder {
  private readonly shapeCtx: FieldShapeContext
  private readonly usage: TokenUsage = { ...EMPTY_TOKEN_USAGE }
  private modelCalls = 0
  private toolCalls = 0
  private toolSuccesses = 0

  constructor(
    private readonly writer: TraceSessionWriter,
    config: TraceConfig,
    readonly sessionId: string,
    readonly turn: number,
  ) {
    this.shapeCtx = {
      level: config.level,
      maxFieldChars: config.maxFieldChars,
      onBlob: (ref, text) => this.writer.addBlob(ref, text),
    }
  }

  /** 本轮累计用量（含规划、回复等全部模型调用；provider 缺失时为估算并带 estimated） */
  getTurnUsage(): TokenUsage {
    return { ...this.usage }
  }

  /** 按配置整形文本字段（meta 档只留摘要；full 档超限时外置原文） */
  shape(text: string): TraceTextValue {
    return shapeText(text, this.shapeCtx)
  }

  shapeValue(value: unknown): TraceTextValue {
    return shapeJson(value, this.shapeCtx)
  }

  turnStart(userMessageId?: string, requestId?: string): void {
    this.writer.append({
      type: 'turn/start',
      turn: this.turn,
      data: { userMessageId, requestId },
    })
  }

  turnEnd(input: {
    status: TraceTurnStatus
    latencyMs: number
    errorCode?: string
    message?: string
  }): void {
    this.writer.append({
      type: 'turn/end',
      turn: this.turn,
      data: {
        status: input.status,
        latencyMs: input.latencyMs,
        usage: { ...this.usage },
        modelCalls: this.modelCalls,
        toolCalls: this.toolCalls,
        toolSuccesses: this.toolSuccesses,
        errorCode: input.errorCode,
        message: input.message ? redactFull(input.message) : undefined,
      },
    })
    this.writer.checkpoint()
  }

  userMessage(input: { messageId: string; content: string }): void {
    this.writer.append({
      type: 'user/message',
      turn: this.turn,
      data: {
        messageId: input.messageId,
        content: this.shape(input.content),
        characters: input.content.length,
      },
    })
  }

  assistantMessage(input: { messageId: string; content: string; usage?: TokenUsage }): void {
    if (input.usage) this.addUsage(input.usage)
    this.writer.append({
      type: 'assistant/message',
      turn: this.turn,
      data: {
        messageId: input.messageId,
        content: this.shape(input.content),
        characters: input.content.length,
        usage: input.usage,
      },
    })
  }

  stepStart(node: TraceStepNode, round?: number): void {
    this.writer.append({ type: 'step/start', turn: this.turn, data: { node, round } })
  }

  stepEnd(node: TraceStepNode, latencyMs: number, note?: string): void {
    this.writer.append({
      type: 'step/end',
      turn: this.turn,
      data: { node, latencyMs, note },
    })
    this.writer.checkpoint()
  }

  /** 包裹一个图节点：产生成对的 step/start、step/end；异常时记录后原样抛出 */
  async span<T>(node: TraceStepNode, fn: () => Promise<T>, options?: { round?: number }): Promise<T> {
    this.stepStart(node, options?.round)
    const started = Date.now()
    try {
      const result = await fn()
      this.stepEnd(node, Date.now() - started)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.stepEnd(node, Date.now() - started, `error: ${message}`)
      throw error
    }
  }

  requestHeader(input: {
    kind: TraceModelCallKind
    providerKind: string
    model: string
    systemPrompt: string
    messageCount: number
    messageCharacters: number
    tools: string[]
  }): void {
    this.writer.append({
      type: 'request/header',
      turn: this.turn,
      data: {
        kind: input.kind,
        providerKind: input.providerKind,
        model: input.model,
        systemPrompt: shapeSystemPrompt(input.systemPrompt, { includePreview: false }),
        messageCount: input.messageCount,
        messageCharacters: input.messageCharacters,
        tools: [...input.tools],
      },
    })
    this.writer.checkpoint()
  }

  requestContext(input: {
    budgetCharacters: number
    parts: {
      systemPrompt: number
      systemTools: number
      skills: number
      memory: number
      messages: number
    }
  }): void {
    const usedCharacters =
      input.parts.systemPrompt +
      input.parts.systemTools +
      input.parts.skills +
      input.parts.memory +
      input.parts.messages
    this.writer.append({
      type: 'request/context',
      turn: this.turn,
      data: {
        budgetCharacters: input.budgetCharacters,
        usedCharacters,
        parts: { ...input.parts },
      },
    })
  }

  modelCall(input: {
    kind: TraceModelCallKind
    providerKind: string
    model: string
    streaming: boolean
  }): void {
    this.writer.append({ type: 'model/call', turn: this.turn, data: { ...input } })
  }

  modelResult(input: {
    kind: TraceModelCallKind
    model: string
    ok: boolean
    latencyMs: number
    ttftMs?: number
    finishReason?: string
    usage?: TokenUsage
    characters?: number
    errorCode?: string
    message?: string
  }): void {
    this.modelCalls += 1
    if (input.usage) this.addUsage(input.usage)
    this.writer.append({
      type: 'model/result',
      turn: this.turn,
      data: {
        ...input,
        message: input.message ? redactFull(input.message) : undefined,
      },
    })
  }

  planResult(input: {
    round?: number
    candidates: number
    planned: Array<{ name: string; input: unknown }>
    dropped: Array<{ name: string; reason: TraceDroppedReason }>
    failed?: string
  }): void {
    this.writer.append({
      type: 'plan/result',
      turn: this.turn,
      data: {
        round: input.round,
        candidates: input.candidates,
        planned: input.planned.map((call) => ({
          name: call.name,
          input: this.shapeValue(call.input),
        })),
        dropped: input.dropped.map((item) => ({ ...item })),
        failed: input.failed ? redactFull(input.failed) : undefined,
      },
    })
  }

  toolCall(input: {
    callId: string
    name: string
    riskLevel: 'safe' | 'confirm'
    args: unknown
  }): void {
    this.writer.append({
      type: 'tool/call',
      turn: this.turn,
      data: {
        callId: input.callId,
        name: input.name,
        riskLevel: input.riskLevel,
        args: this.shapeValue(input.args),
      },
    })
    this.writer.checkpoint()
  }

  toolConfirm(input: {
    callId: string
    name: string
    decision: 'approved' | 'denied' | 'timeout'
    waitedMs: number
  }): void {
    this.writer.append({ type: 'tool/confirm', turn: this.turn, data: { ...input } })
  }

  toolResult(input: {
    callId: string
    name: string
    ok: boolean
    latencyMs: number
    errorCode?: string
    message?: string
    output?: unknown
    citations?: number
    hitCount?: number
  }): void {
    this.toolCalls += 1
    if (input.ok) this.toolSuccesses += 1
    this.writer.append({
      type: 'tool/result',
      turn: this.turn,
      data: {
        callId: input.callId,
        name: input.name,
        ok: input.ok,
        latencyMs: input.latencyMs,
        errorCode: input.errorCode,
        message: input.message ? redactFull(input.message) : undefined,
        output: input.output === undefined ? undefined : this.shapeValue(input.output),
        citations: input.citations,
        hitCount: input.hitCount,
      },
    })
  }

  retrievalHits(input: {
    source: TraceRetrievalSource
    query: string
    topK?: number
    latencyMs: number
    hits: TraceRetrievalHit[]
  }): void {
    this.writer.append({
      type: 'retrieval/hits',
      turn: this.turn,
      data: {
        source: input.source,
        query: redactFull(input.query),
        topK: input.topK,
        latencyMs: input.latencyMs,
        hits: input.hits.map((hit) => ({ ...hit })),
      },
    })
  }

  skillRoute(input: { hit: boolean; skillId?: string; rulesCharacters?: number }): void {
    this.writer.append({ type: 'skill/route', turn: this.turn, data: { ...input } })
  }

  error(input: { code: string; message: string; where: string }): void {
    this.writer.append({
      type: 'error',
      turn: this.turn,
      data: { ...input, message: redactFull(input.message) },
    })
  }

  checkpoint(): void {
    this.writer.checkpoint()
  }

  private addUsage(usage: TokenUsage): void {
    this.usage.inputTokens += usage.inputTokens
    this.usage.outputTokens += usage.outputTokens
    this.usage.cacheReadTokens += usage.cacheReadTokens
    this.usage.cacheWriteTokens += usage.cacheWriteTokens
    this.usage.reasoningTokens += usage.reasoningTokens
    if (usage.estimated) this.usage.estimated = true
  }
}

/** 由 chatController 组装的「开一轮链路」工厂：注入会话侧事实（provider/工具/预算） */
export type TraceTurnStarter = (input: {
  sessionId: string
  packageId: string
  turn: number
  provider: { kind: string; baseUrl: string; model: string; plannerModel?: string }
}) => Promise<TraceRecorder | null>
