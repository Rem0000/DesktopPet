import { randomUUID } from 'node:crypto'
import type {
  ChatError,
  ChatMessage,
  ChatStreamEvent,
  PetAgentState,
  SendChatInput,
  SendChatResult,
} from '../../src/chat/contracts'
import type { AgentRuntime, ToolBoundaryEvent } from './agentRuntime'
import type { ChatStore } from './chatStore'
import { normalizeProviderError } from './deepSeekProvider'
import { citationsFromToolOutput } from './knowledgeService'
import { scoreMessageImportance } from './messageImportance'
import { summarizeToolInput } from './redact'
import type { TraceRecorder, TraceTurnStarter } from '../trace/traceRecorder'

export type ChatEventSink = {
  id: number
  send: (event: ChatStreamEvent) => void
  confirmTool?: (toolName: string, rawInput: unknown) => Promise<boolean>
}

type ActiveRequest = {
  requestId: string
  sessionId: string
  userMessageId: string
  userText: string
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
    private readonly onChatComplete?: (options: {
      packageId: string
      messages: ChatMessage[]
    }) => void,
    /** 开启一轮链路追踪（缺省时不产生链路日志） */
    private readonly beginTrace?: TraceTurnStarter,
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

    const userMessage = await this.store.appendMessage(
      sessionId,
      'user',
      text,
      'complete',
      scoreMessageImportance(text, 'user'),
    )
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
      userMessageId: userMessage.id,
      userText: text,
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

  /** 取消指定会话的全部进行中请求（删除会话时调用，防止 activeRequests 残留） */
  cancelForSession(sessionId: string): void {
    for (const active of this.activeRequests.values()) {
      if (active.sessionId === sessionId) active.controller.abort()
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
      outputPreview:
        event.output === undefined ? undefined : summarizeToolInput(event.output, 400),
      citations:
        event.ok && event.toolName === 'search_knowledge'
          ? citationsFromToolOutput(event.output)
          : undefined,
    })
  }

  private async execute(active: ActiveRequest): Promise<void> {
    let content = ''
    let startedSpeaking = false
    let hasToolSuccess = false
    const turnStarted = Date.now()
    let recorder: TraceRecorder | null = null
    try {
      const session = this.store.getSession(active.sessionId)
      const config = this.store.getRuntimeProviderConfig()
      if (!session || !config) throw new Error('聊天运行配置已失效')

      // 链路追踪：轮次序号 = 会话内用户消息条数（含本条）
      const turn = session.messages.filter((message) => message.role === 'user').length
      recorder =
        (await this.beginTrace?.({
          sessionId: active.sessionId,
          packageId: session.packageId,
          turn,
          provider: {
            kind: config.providerKind ?? 'deepseek',
            baseUrl: config.baseUrl,
            model: config.model,
            plannerModel: config.plannerModel,
          },
        })) ?? null
      recorder?.turnStart(active.userMessageId, active.requestId)
      recorder?.userMessage({
        messageId: active.userMessageId,
        content: active.userText,
      })

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
        onToolEvent: (event) => {
          if (event.phase === 'end' && event.ok) hasToolSuccess = true
          this.handleToolEvent(active, event)
        },
        confirmTool: active.sender.confirmTool
          ? (toolName, rawInput) => active.sender.confirmTool!(toolName, rawInput)
          : undefined,
        trace: recorder,
      })
      content = content || reply
      if (!content) throw new Error('DeepSeek 返回了空回复')
      const message = await this.store.updateMessage(
        active.sessionId,
        active.assistantMessageId,
        {
          content,
          status: 'complete',
          importance: scoreMessageImportance(content, 'assistant', { hasToolSuccess }),
        },
      )
      recorder?.assistantMessage({
        messageId: active.assistantMessageId,
        content,
      })
      recorder?.turnEnd({
        status: 'completed',
        latencyMs: Date.now() - turnStarted,
      })
      active.sender.send({
        type: 'complete',
        requestId: active.requestId,
        sessionId: active.sessionId,
        message,
        usage: recorder?.getTurnUsage(),
      })
      // 对话完成后触发关系演化评估（非阻塞；失败不影响聊天）
      const finalSession = this.store.getSession(active.sessionId)
      this.onChatComplete?.({
        packageId: session.packageId,
        messages: finalSession?.messages ?? session.messages,
      })
    } catch (error) {
      const normalized = active.controller.signal.aborted
        ? ({ code: 'cancelled', message: '已停止生成', retryable: true } satisfies ChatError)
        : normalizeProviderError(error)
      const status = normalized.code === 'cancelled' ? 'cancelled' : 'error'
      recorder?.turnEnd({
        status,
        latencyMs: Date.now() - turnStarted,
        errorCode: normalized.code,
        message: normalized.message,
      })
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
