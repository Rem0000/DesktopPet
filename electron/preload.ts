import { contextBridge, ipcRenderer } from 'electron'
import type {
  ChatSession,
  ChatSessionSummary,
  ChatStreamEvent,
  MemoryItem,
  MemoryUpdateInput,
  MemoryWriteInput,
  PetAgentState,
  ProviderConfigInput,
  ProviderPublicConfig,
  Reminder,
  ReminderCreateInput,
  SendChatInput,
  SendChatResult,
  SpeechBubblePayload,
  ToolConfirmRequest,
  ToolTraceRecord,
  ToolTraceStats,
  KnowledgeDocumentSummary,
} from '../src/chat/contracts'

export type Live2DRuntime = 'cubism2' | 'cubism4'

export type Live2DMotionGroupInfo = {
  name: string
  count: number
  hasSound: boolean
}

export type Live2DCatalog = {
  textures: string[]
  motionGroups: Live2DMotionGroupInfo[]
  expressions: string[]
  voices: string[]
  hasPhysics: boolean
  hasPose: boolean
  hasSound: boolean
  missing: string[]
  runtime: Live2DRuntime
}

export type Live2DModelRef = {
  model3Path: string
  modelUrl: string
  dir: string
  catalog: Live2DCatalog
  runtime: Live2DRuntime
}

export type Live2DSessionPayload = {
  modelUrl: string
  model3Path: string
  outDir?: string
  packageId?: string
  source: 'imported' | 'template-raw'
  catalog?: Live2DCatalog
  runtime?: Live2DRuntime
}

export type Live2DLibraryItem = {
  id: string
  dir: string
  displayName: string
  model3Path: string | null
  modelUrl: string | null
  runtime: Live2DRuntime | null
  summary: string
  invalid: boolean
  isDefault: boolean
  error?: string
}

const api = {
  openLive2DModel: (
    _mode: 'file' | 'folder' = 'folder',
  ): Promise<Live2DModelRef | null> =>
    ipcRenderer.invoke('live2d:open-model'),
  applyLive2DSession: (session: Live2DSessionPayload): Promise<boolean> =>
    ipcRenderer.invoke('live2d:apply-session', session),
  refreshLive2DSession: (
    session: Pick<Live2DSessionPayload, 'model3Path' | 'outDir'>,
  ): Promise<Live2DModelRef | null> =>
    ipcRenderer.invoke('live2d:refresh-session', session),

  setCursorFocusTracking: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('live2d:set-cursor-focus', enabled),
  onCursorScreenPoint: (cb: (point: { x: number; y: number }) => void) => {
    const handler = (_: unknown, point: { x: number; y: number }) => cb(point)
    ipcRenderer.on('live2d:cursor-point', handler)
    return () => {
      ipcRenderer.removeListener('live2d:cursor-point', handler)
    }
  },

  listLive2DLibrary: (): Promise<Live2DLibraryItem[]> =>
    ipcRenderer.invoke('live2d:library-list'),
  getActiveLive2DDir: (): Promise<string | null> =>
    ipcRenderer.invoke('live2d:library-active-dir'),
  setActiveLive2DDir: (dir: string | null): Promise<void> =>
    ipcRenderer.invoke('live2d:library-set-active-dir', dir),
  deleteLive2DLibraryItem: (
    dir: string,
  ): Promise<{ ok: boolean; wasActive?: boolean; error?: string }> =>
    ipcRenderer.invoke('live2d:library-delete', dir),
  applyLive2DLibraryItem: (dir: string): Promise<Live2DSessionPayload | null> =>
    ipcRenderer.invoke('live2d:library-apply', dir),
  applyDefaultLive2D: (): Promise<Live2DSessionPayload | null> =>
    ipcRenderer.invoke('live2d:apply-default'),
  getPersona: (
    packageId: string,
  ): Promise<{ ok: boolean; content?: string; error?: string }> =>
    ipcRenderer.invoke('live2d:persona:get', packageId),
  setPersona: (
    packageId: string,
    content: string,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('live2d:persona:set', packageId, content),
  resolvePackageId: (dir: string): Promise<string | null> =>
    ipcRenderer.invoke('live2d:resolve-package-id', dir),
  openLive2DManager: (): Promise<void> =>
    ipcRenderer.invoke('live2d:open-manager'),
  notifyLibraryChanged: (): Promise<void> =>
    ipcRenderer.invoke('live2d:notify-library-changed'),
  onLibraryChanged: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('live2d:library-changed', handler)
    return () => {
      ipcRenderer.removeListener('live2d:library-changed', handler)
    }
  },

  onLive2DSession: (cb: (session: Live2DSessionPayload) => void) => {
    const handler = (_: unknown, session: Live2DSessionPayload) => cb(session)
    ipcRenderer.on('live2d:session', handler)
    return () => {
      ipcRenderer.removeListener('live2d:session', handler)
    }
  },
  onActivePackageChanged: (cb: (payload: { packageId: string }) => void) => {
    const handler = (_: unknown, payload: { packageId: string }) => cb(payload)
    ipcRenderer.on('live2d:active-package', handler)
    return () => {
      ipcRenderer.removeListener('live2d:active-package', handler)
    }
  },
  onRequestLive2DImport: (cb: (mode?: 'file' | 'folder') => void) => {
    const handler = (_: unknown, mode: 'file' | 'folder' = 'folder') => cb(mode)
    ipcRenderer.on('live2d:request-import', handler)
    return () => {
      ipcRenderer.removeListener('live2d:request-import', handler)
    }
  },
  onPlayMotion: (cb: (group: string) => void) => {
    const handler = (_: unknown, payload: { group: string }) => cb(payload.group)
    ipcRenderer.on('live2d:play-motion', handler)
    return () => {
      ipcRenderer.removeListener('live2d:play-motion', handler)
    }
  },
  onPlayExpression: (cb: (name: string | null) => void) => {
    const handler = (_: unknown, payload: { name: string | null }) =>
      cb(payload.name)
    ipcRenderer.on('live2d:play-expression', handler)
    return () => {
      ipcRenderer.removeListener('live2d:play-expression', handler)
    }
  },
  onSetSound: (cb: (enabled: boolean) => void) => {
    const handler = (_: unknown, enabled: boolean) => cb(enabled)
    ipcRenderer.on('live2d:set-sound', handler)
    return () => {
      ipcRenderer.removeListener('live2d:set-sound', handler)
    }
  },

  chat: {
    getProviderConfig: (): Promise<ProviderPublicConfig> =>
      ipcRenderer.invoke('chat:config:get'),
    updateProviderConfig: (
      input: ProviderConfigInput,
    ): Promise<ProviderPublicConfig> =>
      ipcRenderer.invoke('chat:config:update', input),
    listSessions: (packageId?: string): Promise<ChatSessionSummary[]> =>
      ipcRenderer.invoke('chat:sessions:list', packageId),
    createSession: (packageId: string): Promise<ChatSession> =>
      ipcRenderer.invoke('chat:sessions:create', packageId),
    getActivePackageId: (): Promise<string | null> =>
      ipcRenderer.invoke('chat:active-package-id'),
    getSession: (sessionId: string): Promise<ChatSession | null> =>
      ipcRenderer.invoke('chat:sessions:get', sessionId),
    deleteSession: (sessionId: string): Promise<boolean> =>
      ipcRenderer.invoke('chat:sessions:delete', sessionId),
    send: (input: SendChatInput): Promise<SendChatResult> =>
      ipcRenderer.invoke('chat:send', input),
    cancel: (requestId: string): Promise<boolean> =>
      ipcRenderer.invoke('chat:cancel', requestId),
    onStream: (cb: (event: ChatStreamEvent) => void) => {
      const handler = (_: unknown, event: ChatStreamEvent) => cb(event)
      ipcRenderer.on('chat:stream', handler)
      return () => {
        ipcRenderer.removeListener('chat:stream', handler)
      }
    },
    onToolConfirm: (cb: (request: ToolConfirmRequest) => void) => {
      const handler = (_: unknown, request: ToolConfirmRequest) => cb(request)
      ipcRenderer.on('chat:tool-confirm', handler)
      return () => {
        ipcRenderer.removeListener('chat:tool-confirm', handler)
      }
    },
    respondToolConfirm: (
      confirmId: string,
      confirmed: boolean,
    ): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('chat:tool-confirm:respond', { confirmId, confirmed }),
    listMemories: (): Promise<MemoryItem[]> => ipcRenderer.invoke('memory:list'),
    getMemory: (id: string): Promise<MemoryItem | null> =>
      ipcRenderer.invoke('memory:get', id),
    writeMemory: (input: MemoryWriteInput): Promise<MemoryItem> =>
      ipcRenderer.invoke('memory:write', input),
    updateMemory: (id: string, patch: MemoryUpdateInput): Promise<MemoryItem> =>
      ipcRenderer.invoke('memory:update', id, patch),
    deleteMemory: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('memory:delete', id),
    clearMemories: (): Promise<number> => ipcRenderer.invoke('memory:clear'),
  },
  tools: {
    list: (): Promise<
      Array<{
        name: string
        description: string
        enabled: boolean
        riskLevel: 'safe' | 'confirm'
        hasParameters: boolean
      }>
    > => ipcRenderer.invoke('tools:list'),
    listTracesBySession: (sessionId: string): Promise<ToolTraceRecord[]> =>
      ipcRenderer.invoke('tools:traces:by-session', sessionId),
    getTraceStats: (): Promise<ToolTraceStats[]> =>
      ipcRenderer.invoke('tools:traces:stats'),
  },
  knowledge: {
    list: (): Promise<KnowledgeDocumentSummary[]> =>
      ipcRenderer.invoke('knowledge:list'),
    importDocuments: (): Promise<KnowledgeDocumentSummary[]> =>
      ipcRenderer.invoke('knowledge:import'),
    deleteDocument: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('knowledge:delete', id),
    rebuildIndex: (): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('knowledge:rebuild-index'),
    onRebuildProgress: (cb: (progress: { done: number; total: number }) => void) => {
      const handler = (_: unknown, progress: { done: number; total: number }) =>
        cb(progress)
      ipcRenderer.on('knowledge:rebuild-progress', handler)
      return () => {
        ipcRenderer.removeListener('knowledge:rebuild-progress', handler)
      }
    },
  },
  retrieval: {
    getModelStatus: (): Promise<{
      state: 'idle' | 'loading' | 'ready' | 'error'
      modelId?: string
      cacheDir?: string
      message?: string
      manualDownloadHint?: string
    }> => ipcRenderer.invoke('retrieval:model-status'),
    retryModel: (): Promise<{
      state: 'idle' | 'loading' | 'ready' | 'error'
      modelId?: string
      cacheDir?: string
      message?: string
      manualDownloadHint?: string
    }> => ipcRenderer.invoke('retrieval:retry-model'),
  },
  reminders: {
    list: (): Promise<Reminder[]> => ipcRenderer.invoke('reminders:list'),
    create: (input: ReminderCreateInput): Promise<Reminder> =>
      ipcRenderer.invoke('reminders:create', input),
    cancel: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('reminders:cancel', id),
  },
  onSpeechBubble: (cb: (payload: SpeechBubblePayload) => void) => {
    const handler = (_: unknown, payload: SpeechBubblePayload) => cb(payload)
    ipcRenderer.on('pet:show-bubble', handler)
    return () => {
      ipcRenderer.removeListener('pet:show-bubble', handler)
    }
  },
  dismissSpeechBubble: (): Promise<void> =>
    ipcRenderer.invoke('pet:dismiss-bubble'),
  getBubbleTailSide: (): Promise<'bl' | 'br'> =>
    ipcRenderer.invoke('pet:bubble-tail-side'),
  onAgentState: (cb: (state: PetAgentState) => void) => {
    const handler = (_: unknown, state: PetAgentState) => cb(state)
    ipcRenderer.on('pet:agent-state', handler)
    return () => {
      ipcRenderer.removeListener('pet:agent-state', handler)
    }
  },

  setClickThrough: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('window:set-click-through', enabled),
  dragMove: (dx: number, dy: number) =>
    ipcRenderer.send('window:drag-move', { dx, dy }),
  showContextMenu: (state?: {
    busy?: boolean
    hasLive2d?: boolean
    soundEnabled?: boolean
    motionGroups?: Live2DMotionGroupInfo[]
    expressions?: string[]
    activeModelDir?: string
  }): Promise<void> => ipcRenderer.invoke('pet:show-context-menu', state),
  onExitLive2D: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('pet:exit-live2d', handler)
    return () => {
      ipcRenderer.removeListener('pet:exit-live2d', handler)
    }
  },
}

contextBridge.exposeInMainWorld('petAPI', api)

export type PetAPI = typeof api
