import { dialog, ipcMain, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import type {
  MemoryUpdateInput,
  MemoryWriteInput,
  PetAgentState,
  ProviderConfigInput,
  ReminderCreateInput,
  SendChatInput,
  SpeechBubblePayload,
  ToolConfirmRequest,
} from '../../src/chat/contracts'
import { resolveDataSubpath, ensureDataDirs } from '../projectPaths'
import {
  ensureEmbeddingModelLoaded,
  getEmbeddingModelStatus,
  retryEmbeddingModelLoad,
} from '../retrieval/embeddingService'
import { resolvePackageIdFromDir, readPackagePersona } from '../live2dLibrary'
import { ReminderScheduler } from '../reminders/reminderScheduler'
import { ReminderService } from '../reminders/reminderService'
import { ReminderStore } from '../reminders/reminderStore'
import { AgentRuntime } from './agentRuntime'
import { ChatService, ChatServiceError } from './chatService'
import { ChatStore } from './chatStore'
import { DeepSeekProvider, validateProviderConfig } from './deepSeekProvider'
import { MemoryService } from './memoryService'
import { MemoryStore } from './memoryStore'
import { loadToolConfigOverrides } from './toolConfig'
import { KnowledgeService } from './knowledgeService'
import { KnowledgeStore } from './knowledgeStore'
import { summarizeToolInput } from './redact'
import { defaultToolRegistry } from './toolRegistry'
import { ToolTraceStore } from './toolTraceStore'

const TOOL_CONFIRM_TIMEOUT_MS = 60_000

type PendingToolConfirm = {
  resolve: (confirmed: boolean) => void
  timer: ReturnType<typeof setTimeout>
}

const pendingToolConfirms = new Map<string, PendingToolConfirm>()

function resolveToolConfirm(confirmId: string, confirmed: boolean): void {
  const pending = pendingToolConfirms.get(confirmId)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingToolConfirms.delete(confirmId)
  pending.resolve(confirmed)
}

let chatStoreRef: ChatStore | null = null
let memoryStoreRef: MemoryStore | null = null
let reminderSchedulerRef: ReminderScheduler | null = null
let getActiveLive2DDir: (() => string | null) | null = null
let presentBubble: ((payload: SpeechBubblePayload) => void) | null = null
let isPetWindowVisible: (() => boolean) | null = null
let notifyReminderSystem: ((title: string, body: string) => void) | null = null

export function setActiveLive2DDirGetter(getter: () => string | null): void {
  getActiveLive2DDir = getter
}

export function setReminderPresenters(options: {
  presentBubble: (payload: SpeechBubblePayload) => void
  isPetVisible: () => boolean
  notifySystem: (title: string, body: string) => void
}): void {
  presentBubble = options.presentBubble
  isPetWindowVisible = options.isPetVisible
  notifyReminderSystem = options.notifySystem
}

export function startReminderScheduler(): void {
  reminderSchedulerRef?.start()
}

export async function cascadeDeleteSessionsForPackage(packageId: string): Promise<void> {
  if (!chatStoreRef || !memoryStoreRef) return
  const removed = await chatStoreRef.deleteSessionsByPackageId(packageId)
  await memoryStoreRef.deleteSessionSummaries(removed)
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) {
    throw new Error(`${label}无效`)
  }
  return value.trim()
}

function requireSendInput(value: unknown): SendChatInput {
  if (!value || typeof value !== 'object') throw new Error('聊天请求格式无效')
  const input = value as Partial<SendChatInput>
  if (typeof input.text !== 'string') throw new Error('消息格式无效')
  return {
    sessionId: requireId(input.sessionId, '会话标识'),
    text: input.text,
  }
}

function requireProviderInput(value: unknown): ProviderConfigInput {
  if (!value || typeof value !== 'object') throw new Error('配置格式无效')
  const input = value as Partial<ProviderConfigInput>
  if (typeof input.baseUrl !== 'string' || typeof input.model !== 'string') {
    throw new Error('服务地址和模型不能为空')
  }
  if (input.apiKey !== undefined && typeof input.apiKey !== 'string') {
    throw new Error('API Key 格式无效')
  }
  return validateProviderConfig({
    baseUrl: input.baseUrl,
    model: input.model,
    apiKey: input.apiKey,
  })
}

function requireMemoryWrite(value: unknown): MemoryWriteInput {
  if (!value || typeof value !== 'object') throw new Error('记忆写入格式无效')
  const input = value as Partial<MemoryWriteInput>
  if (
    typeof input.type !== 'string' ||
    !['profile', 'fact', 'commitment', 'episode'].includes(input.type)
  ) {
    throw new Error('记忆类型无效（已不支持 preference，请改人设）')
  }
  if (typeof input.content !== 'string') throw new Error('记忆内容无效')
  return {
    type: input.type as MemoryWriteInput['type'],
    content: input.content,
    key: typeof input.key === 'string' ? input.key : undefined,
    importance:
      input.importance === 1 || input.importance === 2 || input.importance === 3
        ? input.importance
        : undefined,
    sourceSessionId:
      typeof input.sourceSessionId === 'string' ? input.sourceSessionId : undefined,
    sourceMessageIds: Array.isArray(input.sourceMessageIds)
      ? input.sourceMessageIds.filter((id): id is string => typeof id === 'string')
      : undefined,
    expiresAt: typeof input.expiresAt === 'string' ? input.expiresAt : undefined,
  }
}

function requireMemoryUpdate(value: unknown): MemoryUpdateInput {
  if (!value || typeof value !== 'object') throw new Error('记忆更新格式无效')
  const input = value as Record<string, unknown>
  return {
    content: typeof input.content === 'string' ? input.content : undefined,
    key: typeof input.key === 'string' ? input.key : undefined,
    importance:
      input.importance === 1 || input.importance === 2 || input.importance === 3
        ? input.importance
        : undefined,
    expiresAt:
      input.expiresAt === null
        ? null
        : typeof input.expiresAt === 'string'
          ? input.expiresAt
          : undefined,
    pinned: typeof input.pinned === 'boolean' ? input.pinned : undefined,
  }
}

function requireReminderCreate(value: unknown): ReminderCreateInput {
  if (!value || typeof value !== 'object') throw new Error('提醒格式无效')
  const input = value as Record<string, unknown>
  if (typeof input.content !== 'string') throw new Error('提醒内容无效')
  return {
    content: input.content,
    fireAt: typeof input.fireAt === 'string' ? input.fireAt : undefined,
    delayMinutes:
      typeof input.delayMinutes === 'number' ? input.delayMinutes : undefined,
    sourceSessionId:
      typeof input.sourceSessionId === 'string' ? input.sourceSessionId : undefined,
  }
}

export async function initializeChatController(
  onPetState: (state: PetAgentState) => void,
): Promise<ChatService> {
  await ensureDataDirs()
  const chatDir = resolveDataSubpath('chat')
  const memoryDir = resolveDataSubpath('memory')
  const knowledgeDir = resolveDataSubpath('knowledge')
  const tracesDir = resolveDataSubpath('traces')
  const remindersDir = resolveDataSubpath('reminders')
  const configDir = resolveDataSubpath('config')

  const store = new ChatStore(chatDir, safeStorage)
  await store.initialize()
  const memoryStore = new MemoryStore(memoryDir)
  await memoryStore.initialize()
  const reminderStore = new ReminderStore(remindersDir)
  await reminderStore.initialize()
  chatStoreRef = store
  memoryStoreRef = memoryStore
  const provider = new DeepSeekProvider()
  const memoryService = new MemoryService(
    memoryStore,
    defaultToolRegistry,
    (messages, config, signal) => provider.summarize(messages, config, signal),
    readPackagePersona,
  )
  memoryService.registerDefaultTools()

  const reminderScheduler = new ReminderScheduler({
    store: reminderStore,
    getPersona: () => {
      const packageId = resolvePackageIdFromDir(getActiveLive2DDir?.() ?? null)
      return packageId ? readPackagePersona(packageId) : ''
    },
    getRuntimeConfig: () => store.getRuntimeProviderConfig(),
    showBubble: (payload) => presentBubble?.(payload),
    onPetState,
    isPetVisible: () => isPetWindowVisible?.() ?? true,
    notifySystem: (title, body) => notifyReminderSystem?.(title, body),
  })
  reminderSchedulerRef = reminderScheduler
  const reminderService = new ReminderService(reminderStore, defaultToolRegistry, () =>
    reminderScheduler.reschedule(),
  )
  reminderService.registerDefaultTools()

  const knowledgeStore = new KnowledgeStore(knowledgeDir)
  await knowledgeStore.initialize()
  const knowledgeService = new KnowledgeService(knowledgeStore, defaultToolRegistry)
  knowledgeService.registerDefaultTools()

  const toolOverrides = await loadToolConfigOverrides(configDir)
  defaultToolRegistry.applyOverrides(toolOverrides)

  const traceStore = new ToolTraceStore(tracesDir)
  await traceStore.initialize()

  void ensureEmbeddingModelLoaded().catch((error) => {
    console.error('[retrieval] embedding model load failed:', error)
  })

  const runtime = new AgentRuntime(provider, defaultToolRegistry, memoryService)
  const service = new ChatService(
    store,
    runtime,
    onPetState,
    () => resolvePackageIdFromDir(getActiveLive2DDir?.() ?? null),
    traceStore,
  )

  ipcMain.handle('chat:config:get', () => store.getProviderConfig())
  ipcMain.handle('chat:config:update', (_event, raw: unknown) =>
    store.updateProviderConfig(requireProviderInput(raw)),
  )
  ipcMain.handle('chat:sessions:list', (_event, rawPackageId?: unknown) => {
    if (rawPackageId === undefined || rawPackageId === null) return store.listSessions()
    return store.listSessions(requireId(rawPackageId, '模型包标识'))
  })
  ipcMain.handle('chat:sessions:create', (_event, rawPackageId: unknown) =>
    store.createSession(requireId(rawPackageId, '模型包标识')),
  )
  ipcMain.handle('chat:sessions:get', (_event, rawId: unknown) =>
    store.getSession(requireId(rawId, '会话标识')),
  )
  ipcMain.handle('chat:sessions:delete', async (_event, rawId: unknown) => {
    const sessionId = requireId(rawId, '会话标识')
    const deleted = await store.deleteSession(sessionId)
    if (deleted) await memoryStore.deleteSessionSummary(sessionId)
    return deleted
  })
  ipcMain.handle('chat:active-package-id', () =>
    resolvePackageIdFromDir(getActiveLive2DDir?.() ?? null),
  )
  ipcMain.handle('chat:send', async (event, raw: unknown) => {
    try {
      return await service.send(requireSendInput(raw), {
        id: event.sender.id,
        send: (streamEvent) => {
          if (!event.sender.isDestroyed()) event.sender.send('chat:stream', streamEvent)
        },
        confirmTool: async (toolName, rawInput) => {
          if (event.sender.isDestroyed()) return false
          const confirmId = randomUUID()
          const payload: ToolConfirmRequest = {
            confirmId,
            toolName,
            inputSummary: summarizeToolInput(rawInput),
            requestId: '',
            sessionId: '',
            messageId: '',
          }
          return await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => {
              resolveToolConfirm(confirmId, false)
            }, TOOL_CONFIRM_TIMEOUT_MS)
            pendingToolConfirms.set(confirmId, {
              resolve,
              timer,
            })
            event.sender.send('chat:tool-confirm', payload)
          })
        },
      })
    } catch (error) {
      if (error instanceof ChatServiceError) throw new Error(error.detail.message)
      throw error
    }
  })
  ipcMain.handle('chat:cancel', (event, rawId: unknown) =>
    service.cancel(requireId(rawId, '请求标识'), event.sender.id),
  )
  ipcMain.handle('chat:tool-confirm:respond', (_event, raw: unknown) => {
    if (!raw || typeof raw !== 'object') return { ok: false as const }
    const value = raw as { confirmId?: unknown; confirmed?: unknown }
    if (typeof value.confirmId !== 'string' || !value.confirmId.trim()) {
      return { ok: false as const }
    }
    resolveToolConfirm(value.confirmId.trim(), Boolean(value.confirmed))
    return { ok: true as const }
  })

  ipcMain.handle('memory:list', () =>
    memoryStore.listItems().filter((item) => item.type !== 'preference'),
  )
  ipcMain.handle('memory:get', (_event, rawId: unknown) =>
    memoryStore.getItem(requireId(rawId, '记忆标识')),
  )
  ipcMain.handle('memory:write', (_event, raw: unknown) =>
    memoryStore.writeItem(requireMemoryWrite(raw)),
  )
  ipcMain.handle('memory:update', async (_event, rawId: unknown, rawPatch: unknown) =>
    memoryStore.updateItem(requireId(rawId, '记忆标识'), requireMemoryUpdate(rawPatch)),
  )
  ipcMain.handle('memory:delete', (_event, rawId: unknown) =>
    memoryStore.deleteItem(requireId(rawId, '记忆标识')),
  )
  ipcMain.handle('memory:clear', () => memoryStore.clearItems())

  ipcMain.handle('reminders:list', () => reminderStore.list())
  ipcMain.handle('reminders:create', async (_event, raw: unknown) => {
    const reminder = await reminderService.create(requireReminderCreate(raw))
    return reminder
  })
  ipcMain.handle('reminders:cancel', async (_event, rawId: unknown) =>
    reminderService.cancel(requireId(rawId, '提醒标识')),
  )

  ipcMain.handle('tools:list', () => defaultToolRegistry.listMeta())
  ipcMain.handle('tools:traces:by-session', (_event, rawSessionId: unknown) =>
    traceStore.listBySession(requireId(rawSessionId, '会话标识')),
  )
  ipcMain.handle('tools:traces:stats', () => traceStore.summarize())

  ipcMain.handle('knowledge:list', () =>
    knowledgeStore.listDocuments().map((item) => ({
      id: item.id,
      title: item.title,
      sourceName: item.sourceName,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
  )
  ipcMain.handle('knowledge:import', async () => {
    const result = await dialog.showOpenDialog({
      title: '导入知识库文档',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Text', extensions: ['md', 'txt'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return []
    const imported = []
    for (const filePath of result.filePaths) {
      imported.push(await knowledgeStore.importFile(filePath))
    }
    return imported.map((item) => ({
      id: item.id,
      title: item.title,
      sourceName: item.sourceName,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }))
  })
  ipcMain.handle('knowledge:delete', (_event, rawId: unknown) =>
    knowledgeStore.deleteDocument(requireId(rawId, '文档标识')),
  )
  ipcMain.handle('knowledge:rebuild-index', async (event) => {
    await knowledgeStore.rebuildIndex((done, total) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('knowledge:rebuild-progress', { done, total })
      }
    })
    return { ok: true as const }
  })
  ipcMain.handle('memory:rebuild-index', async () => {
    await memoryStore.rebuildVectorIndex()
    return { ok: true as const }
  })
  ipcMain.handle('retrieval:model-status', () => getEmbeddingModelStatus())
  ipcMain.handle('retrieval:retry-model', async () => retryEmbeddingModelLoad())

  return service
}
