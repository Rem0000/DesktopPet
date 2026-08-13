import { dialog, ipcMain, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import type {
  MemoryUpdateInput,
  MemoryWriteInput,
  PetAgentState,
  ProviderConfigInput,
  ProviderRuntimeConfig,
  ReminderCreateInput,
  SendChatInput,
  SpeechBubblePayload,
  ToolConfirmRequest,
} from '../../src/chat/contracts'
import { resolveDataSubpath, ensureDataDirs, resolveSkillsRoot } from '../projectPaths'
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
import { validateProviderConfig } from './deepSeekProvider'
import { createProvider } from './providerFactory'
import { MemoryService } from './memoryService'
import { MemoryStore } from './memoryStore'
import { DailyMeetStore } from './dailyMeetStore'
import { loadToolConfigOverrides, saveToolConfigOverrides } from './toolConfig'
import { loadContextConfig } from './contextConfig'
import { breakdownToUsage, ContextUsageTracker } from './contextUsage'
import { loadGuardConfig } from './guardConfig'
import { EpisodeDistiller } from './episodeDistiller'
import { loadEpisodeConfig } from './episodeConfig'
import { KnowledgeService } from './knowledgeService'
import { KnowledgeStore } from './knowledgeStore'
import { HistorySearchService } from './historySearch'
import { loadTavilyConfig } from './tavilyConfig'
import { TavilyService } from './tavilyService'
import { registerTavilyTools } from './tavilyTools'
import { summarizeToolInput } from './redact'
import { defaultToolRegistry } from './toolRegistry'
import { ToolTraceStore } from './toolTraceStore'
import { SkillRegistry } from './skills/skillRegistry'
import { createSkillRouter } from './skills/skillRouter'
import { createReadSkillFileTool } from './skills/skillFileTool'
import { RelationshipEvaluator } from '../relationship/relationshipEvaluator'
import { initializeRelationshipController } from '../relationship/relationshipController'
import { RelationshipService } from '../relationship/relationshipService'
import { RelationshipStore } from '../relationship/relationshipStore'

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
/** 会话级上下文占用观测表（初始化时赋值，删除会话/包时清理） */
let contextUsageTrackerRef: ContextUsageTracker | null = null
let reminderSchedulerRef: ReminderScheduler | null = null
let relationshipStoreRef: RelationshipStore | null = null
let relationshipEvaluatorRef: RelationshipEvaluator | null = null
let getActiveLive2DDir: (() => string | null) | null = null
let presentBubble: ((payload: SpeechBubblePayload) => void) | null = null
let isPetWindowVisible: (() => boolean) | null = null
let notifyReminderSystem: ((title: string, body: string) => void) | null = null
/** 串行化演化评估，避免并发双跑 */
let evaluationQueue: Promise<void> = Promise.resolve()
/** 当前排队/进行中的演化评估控制器；新评估会取消上一次，删除包时也会中止 */
let activeEvaluationController: AbortController | null = null
/** 串行化 episode 抽取，避免并发双跑 */
let episodeQueue: Promise<void> = Promise.resolve()
/** 当前排队/进行中的 episode 抽取控制器；新抽取会取消上一次 */
let activeEpisodeController: AbortController | null = null

/** 供小说工坊等模块复用同一 Provider 配置（不含回传明文到无关渲染逻辑之外） */
export function getChatRuntimeProviderConfig(): ProviderRuntimeConfig | null {
  return chatStoreRef?.getRuntimeProviderConfig() ?? null
}

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
  for (const sessionId of removed) contextUsageTrackerRef?.deleteSession(sessionId)
  await memoryStoreRef.deleteSessionSummaries(removed)
  await deleteRelationshipForPackage(packageId)
}

/** 删除模型包时级联清理其关系状态 */
export async function deleteRelationshipForPackage(packageId: string): Promise<boolean> {
  // 中止进行中的关系演化评估与 episode 抽取，避免向已删除包继续写入
  activeEvaluationController?.abort()
  activeEpisodeController?.abort()
  if (!relationshipStoreRef) return true
  return relationshipStoreRef.deletePackage(packageId)
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
    plannerModel: input.plannerModel,
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

  // Prompt 注入防护：data/config/guard-config.json 可覆盖，缺失回退默认
  const guardConfig = await loadGuardConfig(configDir)

  const store = new ChatStore(chatDir, safeStorage)
  await store.initialize()
  const memoryStore = new MemoryStore(memoryDir)
  await memoryStore.initialize()
  const dailyMeetStore = new DailyMeetStore(memoryDir)
  await dailyMeetStore.initialize()
  const reminderStore = new ReminderStore(remindersDir)
  await reminderStore.initialize()
  chatStoreRef = store
  memoryStoreRef = memoryStore
  const provider = createProvider()

  const relationshipStore = new RelationshipStore(resolveDataSubpath('relationships'))
  await relationshipStore.initialize()
  relationshipStoreRef = relationshipStore
  const relationshipService = new RelationshipService(
    relationshipStore,
    defaultToolRegistry,
    () => resolvePackageIdFromDir(getActiveLive2DDir?.() ?? null),
  )
  relationshipService.registerDefaultTools()
  const relationshipEvaluator = new RelationshipEvaluator(
    relationshipStore,
    (system, user, config, signal) =>
      provider.completeText(system, user, config, signal),
  )
  relationshipEvaluatorRef = relationshipEvaluator
  initializeRelationshipController(relationshipService)

  const memoryService = new MemoryService(
    memoryStore,
    defaultToolRegistry,
    (messages, config, signal) => provider.summarize(messages, config, signal),
    readPackagePersona,
    (packageId) => relationshipService.readState(packageId),
    {
      getLastMeetDate: (packageId) => dailyMeetStore.getLastMeetDate(packageId),
      setMeetToday: (packageId, date) => dailyMeetStore.setMeetToday(packageId, date),
    },
    guardConfig,
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

  const historySearchService = new HistorySearchService(
    store,
    defaultToolRegistry,
    () => resolvePackageIdFromDir(getActiveLive2DDir?.() ?? null),
  )
  historySearchService.registerDefaultTools()

  // Tavily 联网搜索/抓取：仅在有 API Key 时注册（env 或 data/config/tavily-config.json）
  const tavilyConfig = await loadTavilyConfig(configDir)
  if (tavilyConfig) {
    const tavilyService = new TavilyService(tavilyConfig.apiKey)
    registerTavilyTools(tavilyService, defaultToolRegistry)
  }

  // Skills 技能模块：扫描技能目录生成索引（常驻），命中才加载规则与工具
  const skillRegistry = new SkillRegistry()
  await skillRegistry.scan(resolveSkillsRoot())
  const skillRouter = createSkillRouter(skillRegistry, defaultToolRegistry)
  defaultToolRegistry.register(
    createReadSkillFileTool((id) => skillRegistry.getIndex(id)),
  )

  // 猜数字工具一次性加载并常驻：游戏需跨多轮对话持续可用，
  // 不随技能激活态卸载（避免切换/退出后模型无工具可调而只能编造）。
  // 常驻后仍通过技能路由注入 skill.md 规则，开局/结束引导不变。
  const residentSkillTools = await skillRegistry.loadScriptTools('guessnumber')
  for (const tool of residentSkillTools) {
    try {
      defaultToolRegistry.register(tool)
    } catch {
      // 已注册时跳过（与技能路由激活时的重复注册处理一致）
    }
  }

  const toolOverrides = await loadToolConfigOverrides(configDir)
  defaultToolRegistry.applyOverrides(toolOverrides)

  // 上下文预算：默认 40k，data/config/context-config.json 可覆盖
  const { budgetCharacters, importanceTrim, recentWindowChars } =
    await loadContextConfig(configDir)

  const traceStore = new ToolTraceStore(tracesDir)
  await traceStore.initialize()

  const episodeConfig = await loadEpisodeConfig(configDir)
  const episodeDistiller = new EpisodeDistiller(
    memoryStore,
    (system, user, config, signal) =>
      provider.completeText(system, user, config, signal),
    episodeConfig,
  )

  void ensureEmbeddingModelLoaded().catch((error) => {
    console.error('[retrieval] embedding model load failed:', error)
  })

  // 会话级上下文占用观测：按 packageId/sessionId 记录最近一次组装，供聊天窗展示拆分
  const contextUsageTracker = new ContextUsageTracker()
  contextUsageTrackerRef = contextUsageTracker

  const runtime = new AgentRuntime(
    provider,
    defaultToolRegistry,
    memoryService,
    budgetCharacters,
    (tool, packageId) => {
      // 人设优先策略下不向模型开放 update_relationship，好感不随对话调整
      if (tool.name !== 'update_relationship') return true
      return relationshipService.isUpdateAllowed(packageId)
    },
    { importanceTrim, recentWindowChars },
    guardConfig,
    skillRouter,
    contextUsageTracker,
  )
  const service = new ChatService(
    store,
    runtime,
    onPetState,
    () => resolvePackageIdFromDir(getActiveLive2DDir?.() ?? null),
    traceStore,
    (options) => {
      const evaluator = relationshipEvaluatorRef
      const config = store.getRuntimeProviderConfig()
      if (!evaluator || !config) return
      // 非阻塞排队评估：失败/取消不影响聊天。
      // 持有 AbortController 供后续排队时取消上一次，以及删除包时终止未完成的评估。
      const controller = new AbortController()
      activeEvaluationController?.abort()
      activeEvaluationController = controller
      evaluationQueue = evaluationQueue
        .catch(() => undefined)
        .then(() => {
          if (controller.signal.aborted) return
          return evaluator.maybeEvaluate({
            packageId: options.packageId,
            persona: readPackagePersona(options.packageId),
            messages: options.messages,
            config,
            signal: controller.signal,
          })
        })
        .then(() => {
          if (activeEvaluationController === controller) activeEvaluationController = null
        })
        .catch(() => {
          if (activeEvaluationController === controller) activeEvaluationController = null
        })
      // 对话关键事实自动 episode 沉淀（非阻塞、串行、可取消；失败只日志）
      const episodeController = new AbortController()
      activeEpisodeController?.abort()
      activeEpisodeController = episodeController
      episodeQueue = episodeQueue
        .catch(() => undefined)
        .then(() => {
          if (episodeController.signal.aborted) return
          return episodeDistiller.maybeDistill({
            packageId: options.packageId,
            sessionId: options.messages.at(-1)?.sessionId ?? '',
            messages: options.messages,
            config,
            signal: episodeController.signal,
          })
        })
        .then(() => {
          if (activeEpisodeController === episodeController) activeEpisodeController = null
        })
        .catch(() => {
          if (activeEpisodeController === episodeController) activeEpisodeController = null
        })
    },
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
    // 先取消该会话进行中的请求，再删除会话，避免主进程 activeRequests/activeSessions 残留
    service.cancelForSession(sessionId)
    const deleted = await store.deleteSession(sessionId)
    if (deleted) {
      await memoryStore.deleteSessionSummary(sessionId)
      contextUsageTrackerRef?.deleteSession(sessionId)
    }
    return deleted
  })
  ipcMain.handle('chat:active-package-id', () =>
    resolvePackageIdFromDir(getActiveLive2DDir?.() ?? null),
  )
  ipcMain.handle('chat:context:usage', (_event, rawSessionId: unknown) => {
    const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : ''
    if (!sessionId) return breakdownToUsage(undefined, budgetCharacters)
    const observation = contextUsageTracker.get(
      sessionId,
      resolvePackageIdFromDir(getActiveLive2DDir?.() ?? null) ?? undefined,
    )
    return breakdownToUsage(observation, budgetCharacters)
  })
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
  ipcMain.handle('skills:list', () => ({
    indices: skillRegistry.listIndices().map((index) => ({
      id: index.id,
      name: index.name,
      description: index.description,
      trigger: index.trigger,
      priority: index.priority,
      active: skillRegistry.getActiveId() === index.id,
      loaded: skillRegistry.isLoaded(index.id),
    })),
  }))
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

  // RAG 检索开关：关闭后 search_knowledge 不进入规划、对话不进行知识库检索（减少无关上下文占用）
  const readRagEnabled = async (): Promise<{ enabled: boolean }> => {
    const overrides = await loadToolConfigOverrides(configDir)
    return { enabled: overrides.search_knowledge?.enabled ?? true }
  }
  const writeRagEnabled = async (enabled: boolean): Promise<{ enabled: boolean }> => {
    const overrides = await loadToolConfigOverrides(configDir)
    overrides.search_knowledge = { enabled }
    await saveToolConfigOverrides(configDir, overrides)
    defaultToolRegistry.applyOverrides(overrides)
    return { enabled }
  }
  ipcMain.handle('chat:rag:get', () => readRagEnabled())
  ipcMain.handle('chat:rag:set', (_event, raw: unknown) => {
    if (typeof raw !== 'boolean') throw new Error('RAG 开关参数无效')
    return writeRagEnabled(raw)
  })

  return service
}
