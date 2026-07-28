import { randomUUID } from 'node:crypto'
import type {
  ChatError,
  ChatStreamEvent,
  PetAgentState,
  SendChatInput,
  SendChatResult,
  ToolTraceRecord,
} from '../../src/chat/contracts'
import type { AgentRuntime, ToolBoundaryEvent } from './agentRuntime'
import type { ChatStore } from './chatStore'
import { normalizeProviderError } from './deepSeekProvider'
import { citationsFromToolOutput } from './knowledgeService'
import type { ToolTraceStore } from './toolTraceStore'

export type ChatEventSink = {
  id: number
  send: (event: ChatStreamEvent) => void
  confirmTool?: (toolName: string, rawInput: unknown) => Promise<boolean>
}

type ActiveRequest = {
  requestId: string
  sessionId: string
  assistantMessageId: string
  sender: ChatEventSink
  controller: AbortController
}

export class ChatServiceError extends Error {
  constructor(readonly detail: ChatError) {
    super(detail.message)
  }
}

function validationError(message: string): ChatServiceError {
  return new ChatServiceError({
    code: 'validation',
    message,
    retryable: false,
  })
}

export class ChatService {
  private readonly activeRequests = new Map<string, ActiveRequest>()
  private readonly activeSessions = new Map<string, string>()

  constructor(
    private readonly store: ChatStore,
    private readonly runtime: AgentRuntime,
    private readonly onPetState: (state: PetAgentState) => void,
    private readonly getActivePackageId: () => string | null = () => null,
    private readonly traces?: ToolTraceStore,
  ) {}

  async send(input: SendChatInput, sender: ChatEventSink): Promise<SendChatResult> {
    const sessionId = input.sessionId?.trim()
    const text = input.text?.trim()
    if (!sessionId || !text) throw validationError('消息不能为空')
    if (text.length > 8_000) throw validationError('单条消息不能超过 8000 个字符')
    const session = this.store.getSession(sessionId)
    if (!session) throw validationError('会话不存在')
    const activePackageId = this.getActivePackageId()
    if (!activePackageId) throw validationError('当前没有活跃的 Live2D 模型')
    if (session.packageId !== activePackageId) {
      throw validationError('当前会话不属于正在使用的模型，请切换会话后再发送')
    }
    if (!this.store.getRuntimeProviderConfig()) {
      throw new ChatServiceError({
        code: 'configuration',
        message: '请先配置 DeepSeek API Key',
        retryable: false,
      })
    }
    if (this.activeSessions.has(sessionId)) {
      throw new ChatServiceError({
        code: 'busy',
        message: '当前会话正在生成回复',
        retryable: true,
      })
    }

    const userMessage = await this.store.appendMessage(sessionId, 'user', text)
    const assistantMessage = await this.store.appendMessage(
      sessionId,
      'assistant',
      '',
      'streaming',
    )
    const requestId = randomUUID()
    const active: ActiveRequest = {
      requestId,
      sessionId,
      assistantMessageId: assistantMessage.id,
      sender,
      controller: new AbortController(),
    }
    this.activeRequests.set(requestId, active)
    this.activeSessions.set(sessionId, requestId)
    this.onPetState('thinking')
    void this.execute(active)

    return { requestId, userMessage, assistantMessage }
  }

  cancel(requestId: string, senderId?: number): boolean {
    const active = this.activeRequests.get(requestId)
    if (!active || (senderId !== undefined && active.sender.id !== senderId)) return false
    active.controller.abort()
    return true
  }

  cancelForSender(senderId: number): void {
    for (const active of this.activeRequests.values()) {
      if (active.sender.id === senderId) active.controller.abort()
    }
  }

  private handleToolEvent(active: ActiveRequest, event: ToolBoundaryEvent): void {
    if (event.phase === 'start') {
      active.sender.send({
        type: 'tool_call',
        requestId: active.requestId,
        sessionId: active.sessionId,
        messageId: active.assistantMessageId,
        toolName: event.toolName,
        phase: 'start',
        inputSummary: event.inputSummary,
      })
      return
    }

    active.sender.send({
      type: 'tool_call',
      requestId: active.requestId,
      sessionId: active.sessionId,
      messageId: active.assistantMessageId,
      toolName: event.toolName,
      phase: 'end',
      ok: event.ok,
      errorCode: event.errorCode,
      latencyMs: event.latencyMs,
      inputSummary: event.inputSummary,
      citations:
        event.ok && event.toolName === 'search_knowledge'
          ? citationsFromToolOutput(event.output)
          : undefined,
    })

    const startedAt = new Date(Date.now() - event.latencyMs).toISOString()
    const record: ToolTraceRecord = {
      requestId: active.requestId,
      sessionId: active.sessionId,
      messageId: active.assistantMessageId,
      toolName: event.toolName,
      startedAt,
      endedAt: new Date().toISOString(),
      ok: event.ok,
      errorCode: event.errorCode,
      latencyMs: event.latencyMs,
      inputSummary: event.inputSummary,
      citations:
        event.ok && event.toolName === 'search_knowledge'
          ? citationsFromToolOutput(event.output)
          : undefined,
    }
    void this.traces?.append(record)
  }

  private async execute(active: ActiveRequest): Promise<void> {
    let content = ''
    let startedSpeaking = false
    try {
      const session = this.store.getSession(active.sessionId)
      const config = this.store.getRuntimeProviderConfig()
      if (!session || !config) throw new Error('聊天运行配置已失效')

      const reply = await this.runtime.run({
        sessionId: active.sessionId,
        packageId: session.packageId,
        messages: session.messages,
        config,
        signal: active.controller.signal,
        onToken: (chunk) => {
          content += chunk
          if (!startedSpeaking) {
            startedSpeaking = true
            this.onPetState('speaking')
          }
          active.sender.send({
            type: 'chunk',
            requestId: active.requestId,
            sessionId: active.sessionId,
            messageId: active.assistantMessageId,
            chunk,
          })
        },
        onToolEvent: (event) => this.handleToolEvent(active, event),
        confirmTool: active.sender.confirmTool
          ? (toolName, rawInput) => active.sender.confirmTool!(toolName, rawInput)
          : undefined,
      })
      content = content || reply
      if (!content) throw new Error('DeepSeek 返回了空回复')
      const message = await this.store.updateMessage(
        active.sessionId,
        active.assistantMessageId,
        { content, status: 'complete' },
      )
      active.sender.send({
        type: 'complete',
        requestId: active.requestId,
        sessionId: active.sessionId,
        message,
      })
    } catch (error) {
      const normalized = active.controller.signal.aborted
        ? ({ code: 'cancelled', message: '已停止生成', retryable: true } satisfies ChatError)
        : normalizeProviderError(error)
      const status = normalized.code === 'cancelled' ? 'cancelled' : 'error'
      const message = await this.store.updateMessage(
        active.sessionId,
        active.assistantMessageId,
        { content, status, error: normalized },
      )
      if (status === 'cancelled') {
        active.sender.send({
          type: 'complete',
          requestId: active.requestId,
          sessionId: active.sessionId,
          message,
        })
      } else {
        active.sender.send({
          type: 'error',
          requestId: active.requestId,
          sessionId: active.sessionId,
          message,
          error: normalized,
        })
      }
    } finally {
      this.activeRequests.delete(active.requestId)
      if (this.activeSessions.get(active.sessionId) === active.requestId) {
        this.activeSessions.delete(active.sessionId)
      }
      if (this.activeRequests.size === 0) this.onPetState('idle')
    }
  }
}
