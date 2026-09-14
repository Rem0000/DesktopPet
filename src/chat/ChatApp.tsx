import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import type {
  ChatMessage,
  ChatSession,
  ChatSessionSummary,
  ChatStreamEvent,
  ContextUsage,
  KnowledgeCitation,
  KnowledgeDocumentSummary,
  MemoryItem,
  ProviderPublicConfig,
  ToolConfirmRequest,
} from './contracts'
import {
  hydrateToolStateFromTraces,
  type ToolTimelineItem,
} from './toolTraceHydration'
import { MarkdownView } from './MarkdownView'
import { formatUsage } from '../trace/format'
import type { TokenUsage, TraceSessionSummary } from '../trace/contracts'

const DEFAULT_CONFIG: ProviderPublicConfig = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  hasApiKey: false,
  apiKeyStorage: 'none',
}
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function dateGroupLabel(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return '更早'
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = 86_400_000
  if (then.getTime() >= startOfToday) return '今天'
  if (then.getTime() >= startOfToday - day) return '昨天'
  if (then.getTime() >= startOfToday - 6 * day) return '最近 7 天'
  return '更早'
}

/** 消息时间展示：今天显示 HH:mm，跨天显示 MM-DD HH:mm；流式/失败/取消显示对应状态 */
function formatMessageTime(iso: string, status: ChatMessage['status']): string {
  if (status === 'streaming') return '生成中…'
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''
  const now = new Date()
  const sameDay =
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate()
  const hhmm = then.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return hhmm
  return `${then.getMonth() + 1}-${then.getDate()} ${hhmm}`
}

/** 宠物/助手头像：优先 modelUrl 图片，失败回退首字符圆形底 */
function PetAvatar({
  modelUrl,
  name,
  size,
}: {
  modelUrl: string | null
  name: string
  size?: 'message' | 'header'
}) {
  const [failed, setFailed] = useState(false)
  if (modelUrl && !failed) {
    return (
      <span
        className={`pet-avatar ${size ?? 'message'}${failed ? ' failed' : ''}`}
        title={name}
      >
        {/* pet-asset:// 本地协议贴图，加载失败回退首字符；不设 crossOrigin（该协议下会报错） */}
        <img src={modelUrl} alt="" draggable={false} onError={() => setFailed(true)} />
      </span>
    )
  }
  const initial = (name || '宠').trim().charAt(0).toUpperCase()
  return (
    <span className={`pet-avatar ${size ?? 'message'} fallback`} title={name}>
      <span className="avatar-fallback">{initial}</span>
    </span>
  )
}

export function ChatApp() {
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([])
  const [session, setSession] = useState<ChatSession | null>(null)
  const [packageId, setPackageId] = useState<string | null>(null)
  /** 当前活跃 Live2D 包的头像信息（modelUrl + 显示名，用于助手头像与头部身份） */
  const [petProfile, setPetProfile] = useState<{ name: string; modelUrl: string | null } | null>(
    null,
  )
  const [input, setInput] = useState('')
  const [activeRequests, setActiveRequests] = useState<Record<string, string>>({})
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [apiKey, setApiKey] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [showMemory, setShowMemory] = useState(false)
  const [showKnowledge, setShowKnowledge] = useState(false)
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [memoryQuery, setMemoryQuery] = useState('')
  const [documents, setDocuments] = useState<KnowledgeDocumentSummary[]>([])
  const [retrievalModelError, setRetrievalModelError] = useState('')
  const [retrievalModelLoading, setRetrievalModelLoading] = useState(false)
  const [rebuildingKnowledge, setRebuildingKnowledge] = useState(false)
  const [rebuildProgress, setRebuildProgress] = useState<{ done: number; total: number } | null>(
    null,
  )
  const [ragEnabled, setRagEnabled] = useState(true)
  const [citationsByMessage, setCitationsByMessage] = useState<
    Record<string, KnowledgeCitation[]>
  >({})
  const [notice, setNotice] = useState('')
  const [initializing, setInitializing] = useState(true)
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null)
  /** 链路投影：会话累计用量摘要 */
  const [usageSummary, setUsageSummary] = useState<TraceSessionSummary | null>(null)
  /** 链路投影：最近一轮 token 用量（来自 complete 事件） */
  const [turnUsage, setTurnUsage] = useState<TokenUsage | null>(null)
  const [toolTimelines, setToolTimelines] = useState<Record<string, ToolTimelineItem[]>>({})
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({})
  const [expandedCitations, setExpandedCitations] = useState<Record<string, boolean>>({})
  const [pendingConfirm, setPendingConfirm] = useState<ToolConfirmRequest | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const messageEndRef = useRef<HTMLDivElement>(null)
  const sidebarMenuRef = useRef<HTMLDivElement>(null)
  /** 当前展示会话 id（供流式完成事件判断是否刷新其上下文占用） */
  const currentSessionIdRef = useRef<string | null>(null)

  const refreshSessions = useCallback(async (forPackageId?: string | null) => {
    const id = forPackageId ?? packageId
    if (!id) {
      setSessions([])
      return [] as ChatSessionSummary[]
    }
    const next = await window.petAPI.chat.listSessions(id)
    setSessions(next)
    return next
  }, [packageId])

  const refreshMemories = useCallback(async () => {
    const next = await window.petAPI.chat.listMemories()
    setMemories(next)
    return next
  }, [])

  const refreshKnowledge = useCallback(async () => {
    const next = await window.petAPI.knowledge.list()
    setDocuments(next)
    return next
  }, [])

  const refreshRagEnabled = useCallback(async () => {
    try {
      const { enabled } = await window.petAPI.chat.getRagEnabled()
      setRagEnabled(enabled)
    } catch {
      setRagEnabled(true)
    }
  }, [])

  const toggleRag = useCallback(
    async (next: boolean) => {
      try {
        const result = await window.petAPI.chat.setRagEnabled(next)
        setRagEnabled(result.enabled)
        setNotice(
          result.enabled
            ? '已开启知识库检索（RAG）'
            : '已关闭知识库检索，对话不再检索知识库',
        )
      } catch (error) {
        setNotice(`切换失败：${errorText(error)}`)
      }
    },
    [],
  )

  const refreshContextUsage = useCallback(async (sessionId: string) => {
    try {
      const next = await window.petAPI.chat.getContextUsage(sessionId)
      setContextUsage(next)
    } catch {
      setContextUsage(null)
    }
  }, [])

  /** 读取链路投影的会话累计用量（token 计数；不涉及金额换算） */
  const refreshUsage = useCallback(async (sessionId: string) => {
    try {
      setUsageSummary(await window.petAPI.traces.sessionSummary(sessionId))
    } catch {
      setUsageSummary(null)
    }
  }, [])

  const openSession = useCallback(async (sessionId: string) => {
    const next = await window.petAPI.chat.getSession(sessionId)
    if (!next) return

    setSession(next)
    currentSessionIdRef.current = sessionId
    void refreshContextUsage(sessionId)
    setTurnUsage(null)
    void refreshUsage(sessionId)
    // 切换会话时只保留目标会话自身的进行中请求标记，清除其余残留，
    // 避免历史会话的 activeRequests 泄漏导致输入框被 disabled 卡住。
    setActiveRequests((current) => {
      const mine = current[sessionId]
      return mine === undefined ? {} : { [sessionId]: mine }
    })

    try {
      const traces = await window.petAPI.tools.listTracesBySession(sessionId)
      const assistantIds = new Set(
        next.messages.filter((message) => message.role === 'assistant').map((m) => m.id),
      )
      const hydrated = hydrateToolStateFromTraces(traces, assistantIds)
      setToolTimelines((current) => ({ ...current, ...hydrated.toolTimelines }))
      setCitationsByMessage((current) => ({ ...current, ...hydrated.citationsByMessage }))
      setExpandedTools((current) => {
        const next = { ...current }
        for (const messageId of Object.keys(hydrated.toolTimelines)) {
          next[messageId] = true
        }
        return next
      })
    } catch {
      // 观测日志不可读时不阻断打开会话
    }
  }, [refreshContextUsage])

  const createSession = useCallback(async (forPackageId?: string | null) => {
    const id = forPackageId ?? packageId
    if (!id) throw new Error('当前没有活跃模型')
    const created = await window.petAPI.chat.createSession(id)
    setSession(created)
    currentSessionIdRef.current = created.id
    setContextUsage(null)
    // 新会话无任何进行中请求，清空残留标记，确保输入框立即可用
    setActiveRequests({})
    await refreshSessions(id)
    return created
  }, [packageId, refreshSessions])

  const switchToPackage = useCallback(
    async (nextPackageId: string) => {
      setPackageId(nextPackageId)
      const available = await refreshSessions(nextPackageId)
      if (available[0]) await openSession(available[0].id)
      else await createSession(nextPackageId)
    },
    [createSession, openSession, refreshSessions],
  )

  useEffect(() => {
    void (async () => {
      try {
        const [provider, activeId] = await Promise.all([
          window.petAPI.chat.getProviderConfig(),
          window.petAPI.chat.getActivePackageId(),
        ])
        setConfig(provider)
        if (activeId) await switchToPackage(activeId)
        else setNotice('等待 Live2D 模型就绪…')
      } catch (error) {
        setNotice(`初始化聊天失败：${errorText(error)}`)
      } finally {
        setInitializing(false)
      }
    })()
  }, [switchToPackage])

  useEffect(() => {
    const applyStatus = (status: {
      state: string
      message?: string
      manualDownloadHint?: string
    }) => {
      setRetrievalModelLoading(status.state === 'loading')
      if (status.state === 'error') {
        setRetrievalModelError(
          [status.message, status.manualDownloadHint].filter(Boolean).join('\n'),
        )
      } else if (status.state === 'ready') {
        setRetrievalModelError('')
      }
    }
    void window.petAPI.retrieval.getModelStatus().then(applyStatus)
    const timer = window.setInterval(() => {
      void window.petAPI.retrieval.getModelStatus().then(applyStatus)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    return window.petAPI.chat.onToolConfirm((request) => {
      setPendingConfirm(request)
    })
  }, [])

  // 活跃包变化时同步头像信息
  useEffect(() => {
    if (!packageId) {
      setPetProfile(null)
      return
    }
    let cancelled = false
    void window.petAPI
      .listLive2DLibrary()
      .then((items) => {
        if (cancelled) return
        const active = items.find((item) => item.id === packageId || item.dir === packageId)
        setPetProfile(
          active
            ? { name: active.displayName, modelUrl: active.modelUrl }
            : { name: packageId, modelUrl: null },
        )
      })
      .catch(() => {
        if (!cancelled) setPetProfile({ name: packageId, modelUrl: null })
      })
    return () => {
      cancelled = true
    }
  }, [packageId])

  useEffect(() => {
    return window.petAPI.knowledge.onRebuildProgress((progress) => {
      setRebuildProgress(progress)
    })
  }, [])

  useEffect(() => {
    return window.petAPI.onActivePackageChanged(({ packageId: nextId }) => {
      void switchToPackage(nextId).catch((error) => {
        setNotice(`切换模型会话失败：${errorText(error)}`)
      })
    })
  }, [switchToPackage])

  useEffect(() => {
    const applyEvent = (event: ChatStreamEvent) => {
      if (event.type === 'tool_call') {
        setToolTimelines((current) => {
          const list = [...(current[event.messageId] ?? [])]
          if (event.phase === 'start') {
            list.push({
              toolName: event.toolName,
              phase: 'start',
              inputSummary: event.inputSummary,
            })
          } else {
            const index = [...list]
              .reverse()
              .findIndex(
                (item) => item.toolName === event.toolName && item.phase === 'start',
              )
            const realIndex = index >= 0 ? list.length - 1 - index : -1
            const nextItem: ToolTimelineItem = {
              toolName: event.toolName,
              phase: 'end',
              ok: event.ok,
              errorCode: event.errorCode,
              latencyMs: event.latencyMs,
              inputSummary: event.inputSummary,
              outputPreview: event.outputPreview,
              hitCount:
                event.toolName === 'search_knowledge'
                  ? (event.citations?.length ?? 0)
                  : undefined,
            }
            if (realIndex >= 0) list[realIndex] = nextItem
            else list.push(nextItem)
          }
          return { ...current, [event.messageId]: list }
        })
        setExpandedTools((current) => ({ ...current, [event.messageId]: true }))
        if (event.phase === 'end' && event.toolName === 'plan_tools' && event.ok === false) {
          setNotice(`工具规划失败：${event.errorCode ?? 'plan_failed'}（仍将尝试普通回复）`)
        }
        if (event.phase === 'end' && event.toolName === 'search_knowledge') {
          const citations = event.citations ?? []
          if (citations.length > 0) {
            setCitationsByMessage((current) => ({
              ...current,
              [event.messageId]: [...(current[event.messageId] ?? []), ...citations],
            }))
          }
        }
        return
      }

      setSession((current) => {
        if (!current || current.id !== event.sessionId) return current
        if (event.type === 'chunk') {
          return {
            ...current,
            messages: current.messages.map((message) =>
              message.id === event.messageId
                ? { ...message, content: message.content + event.chunk }
                : message,
            ),
          }
        }
        return {
          ...current,
          messages: current.messages.map((message) =>
            message.id === event.message.id ? event.message : message,
          ),
        }
      })
      if (event.type !== 'chunk') {
        setActiveRequests((current) => {
          const next = { ...current }
          delete next[event.sessionId]
          return next
        })
        void refreshSessions()
        // 仅当完成的事件属于当前展示会话时才刷新其上下文占用，避免后台会话完成覆盖当前展示
        if (event.type === 'complete' && currentSessionIdRef.current === event.sessionId) {
          void refreshContextUsage(event.sessionId)
          setTurnUsage(event.usage ?? null)
          void refreshUsage(event.sessionId)
        }
      }
    }
    return window.petAPI.chat.onStream(applyEvent)
  }, [refreshSessions, refreshContextUsage])

  useEffect(() => {
    void refreshRagEnabled()
  }, [refreshRagEnabled])

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [session?.messages])

  const filteredMemories = useMemo(() => {
    const q = memoryQuery.trim().toLowerCase()
    if (!q) return memories
    return memories.filter((item) => {
      const hay = `${item.type} ${item.key ?? ''} ${item.content}`.toLowerCase()
      return hay.includes(q)
    })
  }, [memories, memoryQuery])

  const currentRequest = session ? activeRequests[session.id] : undefined
  const canSend = useMemo(
    () => Boolean(session && input.trim() && !currentRequest),
    [currentRequest, input, session],
  )

  const sendText = useCallback(
    async (text: string) => {
      if (!session || activeRequests[session.id] || !text.trim()) return
      setNotice('')
      try {
        const result = await window.petAPI.chat.send({
          sessionId: session.id,
          text: text.trim(),
        })
        setSession((current) =>
          current?.id === session.id
            ? {
                ...current,
                messages: [
                  ...current.messages,
                  result.userMessage,
                  result.assistantMessage,
                ],
              }
            : current,
        )
        setActiveRequests((current) => ({
          ...current,
          [session.id]: result.requestId,
        }))
        await refreshSessions()
      } catch (error) {
        setNotice(errorText(error))
      }
    },
    [activeRequests, refreshSessions, session],
  )

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    const text = input
    if (!canSend) return
    setInput('')
    void sendText(text)
  }

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  const stop = async () => {
    if (!currentRequest) return
    await window.petAPI.chat.cancel(currentRequest)
  }

  const removeSession = async (sessionId: string) => {
    if (!window.confirm('删除这个会话及其全部消息？')) return
    await window.petAPI.chat.deleteSession(sessionId)
    const remaining = await refreshSessions()
    // 无论删除的是否当前会话，都清理该会话的进行中请求标记，
    // 避免残留 activeRequests 使输入框被 disabled 卡住。
    setActiveRequests((current) => {
      if (!(sessionId in current)) return current
      const next = { ...current }
      delete next[sessionId]
      return next
    })
    if (session?.id !== sessionId) return
    try {
      if (remaining[0]) await openSession(remaining[0].id)
      else await createSession()
    } catch (error) {
      // 切换失败时兜底新建，避免 session 停在已删除会话导致输入框禁用
      setSession(null)
      try {
        await createSession()
      } catch (createError) {
        setNotice(`删除后新建会话失败：${errorText(createError)}`)
      }
      setNotice(`切换会话失败：${errorText(error)}`)
    }
  }

  const retry = (failedMessage: ChatMessage) => {
    if (!session) return
    const failedIndex = session.messages.findIndex((item) => item.id === failedMessage.id)
    const previousUser = session.messages
      .slice(0, failedIndex)
      .reverse()
      .find((item) => item.role === 'user')
    if (previousUser) void sendText(previousUser.content)
  }

  const saveConfig = async (event: FormEvent) => {
    event.preventDefault()
    setNotice('')
    try {
      const updated = await window.petAPI.chat.updateProviderConfig({
        baseUrl: config.baseUrl,
        model: config.model,
        plannerModel: config.plannerModel,
        apiKey: apiKey || undefined,
      })
      setConfig(updated)
      setApiKey('')
      setNotice(
        updated.apiKeyStorage === 'memory'
          ? '配置已保存；当前系统无法加密凭据，API Key 仅本次运行有效。'
          : 'DeepSeek 配置已保存。',
      )
    } catch (error) {
      setNotice(errorText(error))
    }
  }

  const openMemoryPanel = async () => {
    setShowMemory((value) => !value)
    setShowSettings(false)
    setShowKnowledge(false)
    try {
      await refreshMemories()
    } catch (error) {
      setNotice(errorText(error))
    }
  }

  const openKnowledgePanel = async () => {
    setShowKnowledge((value) => !value)
    setShowSettings(false)
    setShowMemory(false)
    try {
      await refreshKnowledge()
    } catch (error) {
      setNotice(errorText(error))
    }
  }

  const importKnowledge = async () => {
    try {
      const imported = await window.petAPI.knowledge.importDocuments()
      await refreshKnowledge()
      setNotice(imported.length ? `已导入 ${imported.length} 篇文档` : '已取消导入')
    } catch (error) {
      setNotice(errorText(error))
    }
  }

  const removeKnowledge = async (id: string) => {
    if (!window.confirm('删除这篇知识库文档及其索引？')) return
    await window.petAPI.knowledge.deleteDocument(id)
    await refreshKnowledge()
  }

  const rebuildKnowledgeIndex = async () => {
    setRebuildingKnowledge(true)
    setRebuildProgress({ done: 0, total: 0 })
    try {
      await window.petAPI.knowledge.rebuildIndex()
      setNotice('知识库索引已重建')
    } catch (error) {
      setNotice(errorText(error))
    } finally {
      setRebuildingKnowledge(false)
      setRebuildProgress(null)
    }
  }

  const retryRetrievalModel = async () => {
    setRetrievalModelLoading(true)
    const status = await window.petAPI.retrieval.retryModel()
    setRetrievalModelLoading(status.state === 'loading')
    if (status.state === 'error') {
      setRetrievalModelError(
        [status.message, status.manualDownloadHint].filter(Boolean).join('\n'),
      )
      setNotice('Embedding 模型仍未就绪')
      return
    }
    setRetrievalModelError('')
    setNotice('Embedding 模型已加载，Hybrid 检索可用')
  }

  const respondConfirm = async (confirmed: boolean) => {
    if (!pendingConfirm) return
    const id = pendingConfirm.confirmId
    setPendingConfirm(null)
    try {
      await window.petAPI.chat.respondToolConfirm(id, confirmed)
    } catch (error) {
      setNotice(errorText(error))
    }
  }

  const saveMemoryItem = async (item: MemoryItem, content: string) => {
    try {
      await window.petAPI.chat.updateMemory(item.id, { content })
      await refreshMemories()
      setNotice('记忆已更新，后续对话将使用新内容。')
    } catch (error) {
      setNotice(errorText(error))
    }
  }

  const removeMemoryItem = async (id: string) => {
    if (!window.confirm('删除这条长期记忆？')) return
    await window.petAPI.chat.deleteMemory(id)
    await refreshMemories()
  }

  const togglePinMemory = async (item: MemoryItem) => {
    try {
      await window.petAPI.chat.updateMemory(item.id, { pinned: !item.pinned })
      await refreshMemories()
    } catch (error) {
      setNotice(errorText(error))
    }
  }

  const clearAllMemories = async () => {
    if (!window.confirm('清空全部长期记忆？聊天会话记录不会被删除。')) return
    await window.petAPI.chat.clearMemories()
    await refreshMemories()
    setNotice('长期记忆已清空。')
  }

  const utilityPanelOpen = showSettings || showMemory || showKnowledge

  // 点击菜单外区域时关闭左侧菜单
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!sidebarMenuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [menuOpen])

  const closeUtilityPanel = () => {
    setShowSettings(false)
    setShowMemory(false)
    setShowKnowledge(false)
    setMenuOpen(false)
  }

  return (
    <main className={`chat-shell${utilityPanelOpen ? ' has-utility-panel' : ''}`}>
      <aside className="session-sidebar">
        <div className="sidebar-header">
          <strong>对话</strong>
          <button
            type="button"
            disabled={!packageId}
            onClick={() => void createSession()}
          >
            ＋ 新对话
          </button>
        </div>
        {packageId && (
          <div className="package-hint" title={packageId}>
            当前模型会话
          </div>
        )}
        <div className="session-list">
          {sessions.map((item, index) => {
            const group = dateGroupLabel(item.updatedAt)
            const prevGroup = index > 0 ? dateGroupLabel(sessions[index - 1]!.updatedAt) : null
            const showGroup = prevGroup === null || prevGroup !== group
            return (
              <div key={item.id}>
                {showGroup && <div className="session-date-group">{group}</div>}
                <div
                  className={`session-item ${session?.id === item.id ? 'active' : ''}`}
                >
                  <button type="button" onClick={() => void openSession(item.id)}>
                    <span>{item.title}</span>
                    <small>{item.messageCount} 条消息</small>
                  </button>
                  <button
                    type="button"
                    className="delete-session"
                    title="删除会话"
                    onClick={() => void removeSession(item.id)}
                  >
                    ×
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        <div className="sidebar-actions">
          <div
            className={`sidebar-menu${utilityPanelOpen ? ' active' : ''}`}
            ref={sidebarMenuRef}
          >
            <button
              type="button"
              className="sidebar-menu-toggle"
              onClick={() => {
                if (menuOpen) {
                  setMenuOpen(false)
                  return
                }
                if (utilityPanelOpen) {
                  closeUtilityPanel()
                  return
                }
                setMenuOpen(true)
              }}
              title="打开设置 / 记忆 / 知识库"
            >
              <span className="sidebar-menu-icon" aria-hidden="true">☰</span>
            </button>
            {menuOpen && (
              <div className="sidebar-menu-popover">
                <button
                  type="button"
                  className={`sidebar-menu-item${showSettings ? ' active' : ''}`}
                  onClick={() => {
                    setMenuOpen(false)
                    setShowSettings((value) => !value)
                    setShowMemory(false)
                    setShowKnowledge(false)
                  }}
                >
                  ⚙ DeepSeek 设置
                </button>
                <button
                  type="button"
                  className={`sidebar-menu-item${showMemory ? ' active' : ''}`}
                  onClick={() => {
                    setMenuOpen(false)
                    void openMemoryPanel()
                  }}
                >
                  🧠 长期记忆
                </button>
                <button
                  type="button"
                  className={`sidebar-menu-item${showKnowledge ? ' active' : ''}`}
                  onClick={() => {
                    setMenuOpen(false)
                    void openKnowledgePanel()
                  }}
                >
                  📚 知识库
                </button>
                <button
                  type="button"
                  className="sidebar-menu-item"
                  onClick={() => {
                    setMenuOpen(false)
                    void window.petAPI.traces.openConsole()
                  }}
                >
                  🔍 链路追踪台
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <section className="conversation">
        <header className="conversation-header">
          <div className="conversation-identity">
            {petProfile && (
              <PetAvatar modelUrl={petProfile.modelUrl} name={petProfile.name} size="header" />
            )}
            <div className="conversation-identity-text">
              <strong>{petProfile?.name ?? session?.title ?? '桌宠聊天'}</strong>
              <span>{config.model}</span>
            </div>
          </div>
          <span className={`provider-status ${config.hasApiKey ? 'ready' : ''}`}>
            {config.hasApiKey ? 'DeepSeek 已配置' : '需要配置 API Key'}
          </span>
        </header>

        {retrievalModelLoading && (
          <div className="chat-banner info">Embedding 模型加载中… Hybrid 检索将在就绪后可用</div>
        )}
        {retrievalModelError && (
          <div className="chat-banner error">
            <pre>{retrievalModelError}</pre>
            <button type="button" onClick={() => void retryRetrievalModel()}>
              重试加载模型
            </button>
          </div>
        )}
        {pendingConfirm && (
          <div className="chat-banner confirm">
            <div>
              <strong>确认执行工具：{pendingConfirm.toolName}</strong>
              <code>{pendingConfirm.inputSummary}</code>
            </div>
            <div className="confirm-actions">
              <button type="button" onClick={() => void respondConfirm(true)}>
                确认
              </button>
              <button type="button" className="danger" onClick={() => void respondConfirm(false)}>
                拒绝
              </button>
            </div>
          </div>
        )}

        <div className="message-list" aria-live="polite">
          {initializing ? (
            <div className="empty-chat">正在加载聊天…</div>
          ) : session?.messages.length ? (
            <div className="message-list-inner">
              {session.messages.map((message) => {
                const timeline = toolTimelines[message.id] ?? []
                const toolsRunning =
                  message.role === 'assistant' &&
                  message.status === 'streaming' &&
                  !message.content &&
                  timeline.some((item) => item.phase === 'start')
                const placeholder = toolsRunning
                  ? '正在调用工具…'
                  : message.status === 'streaming'
                    ? '思考中…'
                    : ''
                return (
                <div key={message.id} className={`message-row ${message.role}`}>
                  {message.role === 'assistant' && petProfile && (
                    <PetAvatar modelUrl={petProfile.modelUrl} name={petProfile.name} />
                  )}
                  <div className={`message-bubble ${message.status}`}>
                    {message.role === 'assistant' && timeline.length > 0 && (
                        <ToolTimeline
                          items={timeline}
                          expanded={expandedTools[message.id] !== false}
                          onToggle={() =>
                            setExpandedTools((current) => ({
                              ...current,
                              [message.id]: !(current[message.id] !== false),
                            }))
                          }
                        />
                      )}
                    {message.role === 'assistant' &&
                    message.status !== 'streaming' &&
                    message.content ? (
                      <MarkdownView content={message.content} />
                    ) : (
                      <div className="message-plain-text">
                        {message.content || placeholder}
                        {message.role === 'assistant' &&
                          message.status === 'streaming' &&
                          Boolean(message.content) && (
                            <span className="streaming-caret" aria-hidden="true" />
                          )}
                      </div>
                    )}
                    {(citationsByMessage[message.id]?.length ?? 0) > 0 && (
                      <CitationBlock
                        citations={citationsByMessage[message.id] ?? []}
                        expanded={Boolean(expandedCitations[message.id])}
                        onToggle={() =>
                          setExpandedCitations((current) => ({
                            ...current,
                            [message.id]: !current[message.id],
                          }))
                        }
                      />
                    )}
                    {message.status === 'error' && (
                      <div className="message-error">
                        {message.error?.message ?? '回复失败'}
                        {message.error?.retryable && (
                          <button type="button" onClick={() => retry(message)}>
                            重试
                          </button>
                        )}
                      </div>
                    )}
                    {message.status === 'cancelled' && (
                      <small className="message-state">已停止</small>
                    )}
                    <time className="message-time" dateTime={message.createdAt}>
                      {formatMessageTime(message.createdAt, message.status)}
                    </time>
                  </div>
                </div>
                )
              })}
            </div>
          ) : (
            <div className="empty-chat">
              <strong>和桌宠聊点什么吧</strong>
              <span>发送消息开始对话。可导入知识库文档，或让桌宠记住你的画像与约定。</span>
            </div>
          )}
          <div ref={messageEndRef} />
        </div>

        {notice && <div className="chat-notice">{notice}</div>}

        <form className="chat-composer" onSubmit={submit}>
          <textarea
            value={input}
            rows={2}
            maxLength={8000}
            placeholder={currentRequest ? '桌宠正在回复…' : '输入消息，Enter 发送，Shift+Enter 换行'}
            disabled={Boolean(currentRequest)}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onComposerKeyDown}
          />
          {currentRequest ? (
            <button type="button" className="stop-button" onClick={() => void stop()}>
              停止
            </button>
          ) : (
            <button type="submit" disabled={!canSend}>
              发送
            </button>
          )}
        </form>
        {contextUsage && (
          <ContextUsagePanel
            usage={contextUsage}
            onRefresh={() => session && void refreshContextUsage(session.id)}
          />
        )}
        {(turnUsage || usageSummary) && (
          <div className="usage-chip" title="token 用量（来自链路投影，只呈现计数）">
            {turnUsage && <span>本轮 {formatUsage(turnUsage)}</span>}
            {usageSummary && (
              <span>
                会话累计 in {usageSummary.usage.inputTokens} · out{' '}
                {usageSummary.usage.outputTokens}
                {usageSummary.usage.estimated ? '（估算）' : ''}
              </span>
            )}
          </div>
        )}
      </section>

      {utilityPanelOpen && (
        <aside className="utility-sidebar">
          <div className="utility-sidebar-header">
            <strong>
              {showSettings && 'DeepSeek 设置'}
              {showMemory && '长期记忆'}
              {showKnowledge && '知识库'}
            </strong>
            <button type="button" className="utility-sidebar-close" onClick={closeUtilityPanel}>
              关闭
            </button>
          </div>

          <div className="utility-sidebar-body">
            {showSettings && (
              <form className="settings-panel" onSubmit={saveConfig}>
                <label>
                  服务地址
                  <input
                    value={config.baseUrl}
                    onChange={(event) =>
                      setConfig((current) => ({ ...current, baseUrl: event.target.value }))
                    }
                  />
                </label>
                <label>
                  模型
                  <input
                    value={config.model}
                    onChange={(event) =>
                      setConfig((current) => ({ ...current, model: event.target.value }))
                    }
                  />
                </label>
                <label>
                  规划模型（可选，留空则复用上方模型）
                  <input
                    value={config.plannerModel ?? ''}
                    placeholder="如 deepseek-reasoner"
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        plannerModel: event.target.value.trim() || undefined,
                      }))
                    }
                  />
                </label>
                <label>
                  API Key
                  <input
                    type="password"
                    value={apiKey}
                    placeholder={
                      config.hasApiKey ? '已配置；留空则保持不变' : '请输入 DeepSeek API Key'
                    }
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                </label>
                <button type="submit">保存设置</button>
              </form>
            )}

            {showMemory && (
              <div className="memory-panel">
                <div className="memory-panel-header">
                  <p>
                    用户画像与事实跨模型共享。角色口吻请在「管理已导入模型」中编辑人设。删除会话不会删除这里的记忆。
                  </p>
                  <button type="button" onClick={() => void clearAllMemories()}>
                    清空全部
                  </button>
                </div>
                <input
                  className="memory-search"
                  value={memoryQuery}
                  placeholder="搜索记忆（类型 / key / 内容）"
                  onChange={(event) => setMemoryQuery(event.target.value)}
                />
                {filteredMemories.length === 0 ? (
                  <div className="memory-empty">
                    {memories.length === 0
                      ? '暂无长期记忆。可在对话中让桌宠记住画像或事实；模型个性化请改人设文件。'
                      : '没有匹配的记忆条目。'}
                  </div>
                ) : (
                  <div className="memory-list">
                    {filteredMemories.map((item) => (
                      <MemoryRow
                        key={item.id}
                        item={item}
                        onSave={(content) => void saveMemoryItem(item, content)}
                        onDelete={() => void removeMemoryItem(item.id)}
                        onTogglePin={() => void togglePinMemory(item)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {showKnowledge && (
              <div className="memory-panel">
                <div className="memory-panel-header">
                  <p>与用户长期记忆分库。支持 md/txt；Hybrid 检索（BM25 + BGE 向量）并展示引用。</p>
                  <div className="memory-panel-actions">
                    <button type="button" onClick={() => void importKnowledge()}>
                      导入文档
                    </button>
                    <button
                      type="button"
                      disabled={rebuildingKnowledge}
                      onClick={() => void rebuildKnowledgeIndex()}
                    >
                      {rebuildingKnowledge
                        ? rebuildProgress && rebuildProgress.total > 0
                          ? `重建中 ${rebuildProgress.done}/${rebuildProgress.total}`
                          : '重建中…'
                        : '重建索引'}
                    </button>
                  </div>
                </div>
                <label className="rag-toggle">
                  <input
                    type="checkbox"
                    checked={ragEnabled}
                    onChange={(event) => void toggleRag(event.target.checked)}
                  />
                  <span>对话中启用知识库检索（RAG）</span>
                  <small>
                    {ragEnabled
                      ? '开启：提问文档细节时可通过 search_knowledge 检索'
                      : '关闭：对话不检索知识库，减少无关上下文占用'}
                  </small>
                </label>
                {retrievalModelError && (
                  <div className="memory-empty retrieval-error">
                    <p>{retrievalModelError}</p>
                    <button type="button" onClick={() => void retryRetrievalModel()}>
                      重试加载模型
                    </button>
                  </div>
                )}
                {documents.length === 0 ? (
                  <div className="memory-empty">暂无文档。可导入项目说明后提问细节。</div>
                ) : (
                  <div className="memory-list">
                    {documents.map((doc) => (
                      <article key={doc.id} className="memory-item">
                        <header>
                          <span>{doc.title}</span>
                          <small>{doc.sourceName}</small>
                        </header>
                        <footer>
                          <small>{new Date(doc.updatedAt).toLocaleString()}</small>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => void removeKnowledge(doc.id)}
                          >
                            删除
                          </button>
                        </footer>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      )}
    </main>
  )
}

/** 上下文占用拆分面板（对齐 Claude Code 的 Messages / System tools / System prompt / Memory files / Skills）
 *  点击按钮向上弹出浮层卡片，层级高于聊天内容，不挤压布局。 */
function ContextUsagePanel(props: {
  usage: ContextUsage
  onRefresh: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const { usage } = props
  const percent = Math.round(usage.ratio * 100)
  const count = usage.observed
    ? usage.parts.filter((part) => part.characters > 0).length
    : 0
  return (
    <div className={`context-usage${usage.ratio >= 0.9 ? ' context-usage-warn' : ''}`}>
      <button
        type="button"
        className="context-usage-toggle"
        onClick={() => setExpanded((value) => !value)}
        title={`已用 ${usage.usedCharacters.toLocaleString()} / ${usage.budgetCharacters.toLocaleString()} 字符 · 点击查看来源占比`}
      >
        <span className="context-usage-pct">
          {usage.observed ? `上下文 ${percent}%` : '上下文 暂无统计'}
        </span>
        <span className="context-usage-caret">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="context-usage-popover" role="dialog" aria-label="上下文使用详情">
          <div className="context-usage-popover-header">
            <strong>上下文使用详情</strong>
            <button
              type="button"
              className="context-usage-popover-close"
              title="关闭"
              onClick={() => setExpanded(false)}
            >
              ×
            </button>
          </div>
          {usage.observed ? (
            <>
              <ul>
                {usage.parts.map((part) => {
                  if (part.characters === 0) return null
                  const width = usage.usedCharacters > 0
                    ? Math.max(3, Math.round((part.characters / usage.usedCharacters) * 100))
                    : 0
                  return (
                    <li key={part.key}>
                      <div className="context-usage-row">
                        <span className="context-usage-name">{part.label}</span>
                        <span className="context-usage-char">
                          {(part.characters / 1000).toFixed(1)}k
                        </span>
                      </div>
                      <div className="context-usage-track">
                        <span
                          className={`context-usage-bar part-${part.key}`}
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
              <div className="context-usage-summary">
                <span>共 {count} 类来源</span>
                <span>
                  {usage.usedCharacters.toLocaleString()} / {usage.budgetCharacters.toLocaleString()} 字符
                </span>
                <button type="button" className="context-usage-refresh" onClick={props.onRefresh}>
                  刷新
                </button>
              </div>
            </>
          ) : (
            <div className="context-usage-empty">该会话尚未产生上下文统计，发送一条消息后可见。</div>
          )}
        </div>
      )}
    </div>
  )
}

function CitationBlock(props: {
  citations: KnowledgeCitation[]
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div className="citation-block">
      <button type="button" className="citation-block-toggle" onClick={props.onToggle}>
        引用来源 {props.expanded ? '▾' : '▸'} {props.citations.length} 条
      </button>
      {props.expanded && (
        <ul>
          {props.citations.map((citation) => (
            <li key={citation.chunkId}>
              <em>{citation.sourceName}</em>
              {citation.headingPath && citation.headingPath.length > 0 && (
                <small>{citation.headingPath.join(' / ')}</small>
              )}
              <span>{citation.excerpt}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ToolTimeline(props: {
  items: ToolTimelineItem[]
  expanded: boolean
  onToggle: () => void
}) {
  const summary = props.items
    .map((item) => {
      if (item.phase === 'start') return `${item.toolName}…`
      if (item.ok) {
        const hits =
          typeof item.hitCount === 'number' && item.toolName === 'search_knowledge'
            ? ` · 命中${item.hitCount}条`
            : ''
        return `${item.toolName} ✓${item.latencyMs ?? 0}ms${hits}`
      }
      return `${item.toolName} ✗`
    })
    .join(' · ')

  // 时间线整体状态点：任一运行中 → running；有失败 → fail；否则成功 → ok
  const running = props.items.some((item) => item.phase === 'start')
  const hasFail = props.items.some((item) => item.phase === 'end' && !item.ok)
  const dotClass = running ? 'running' : hasFail ? 'fail' : 'ok'

  return (
    <div className="tool-timeline">
      <button type="button" className="tool-timeline-toggle" onClick={props.onToggle}>
        <span className={`tool-dot ${dotClass}`} aria-hidden="true" />
        <span>
          工具调用 {props.expanded ? '▾' : '▸'} {summary}
        </span>
      </button>
      {props.expanded && (
        <ul className="tool-timeline-list">
          {props.items.map((item, index) => (
            <li key={`${item.toolName}-${index}`}>
              <strong>{item.toolName}</strong>
              {item.phase === 'start' && <span>进行中</span>}
              {item.phase === 'end' && item.ok && (
                <span>
                  成功 · {item.latencyMs ?? 0}ms
                  {item.toolName === 'search_knowledge' &&
                    typeof item.hitCount === 'number' &&
                    ` · 命中${item.hitCount}条`}
                </span>
              )}
              {item.phase === 'end' && !item.ok && (
                <span className="tool-fail">
                  失败{item.errorCode ? ` · ${item.errorCode}` : ''}
                </span>
              )}
              {item.inputSummary && (
                <code title={item.inputSummary}>{item.inputSummary}</code>
              )}
              {item.phase === 'end' && item.outputPreview && (
                <details className="tool-output">
                  <summary>结果</summary>
                  <pre>{item.outputPreview}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MemoryRow(props: {
  item: MemoryItem
  onSave: (content: string) => void
  onDelete: () => void
  onTogglePin: () => void
}) {
  const [content, setContent] = useState(props.item.content)
  useEffect(() => {
    setContent(props.item.content)
  }, [props.item.content, props.item.id])

  return (
    <article className={`memory-item ${props.item.pinned ? 'pinned' : ''}`}>
      <header>
        <span>{props.item.type}</span>
        {props.item.key && <code>{props.item.key}</code>}
        <small>重要度 {props.item.importance}</small>
        {props.item.pinned && <small className="pin-badge">已置顶</small>}
      </header>
      <textarea
        value={content}
        rows={2}
        onChange={(event) => setContent(event.target.value)}
      />
      <footer>
        <small>
          {props.item.sourceSessionId
            ? `来源会话 ${props.item.sourceSessionId.slice(0, 8)}…`
            : '无来源会话'}
        </small>
        <div>
          <button type="button" onClick={props.onTogglePin}>
            {props.item.pinned ? '取消置顶' : '置顶'}
          </button>
          <button type="button" onClick={() => props.onSave(content)}>
            保存
          </button>
          <button type="button" className="danger" onClick={props.onDelete}>
            删除
          </button>
        </div>
      </footer>
    </article>
  )
}
