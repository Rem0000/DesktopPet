import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteTextFile } from '../fsAtomic'
import type {
  ChatMessage,
  ChatMessageStatus,
  ChatRole,
  ChatSession,
  ChatSessionSummary,
  ProviderConfigInput,
  ProviderPublicConfig,
  ProviderRuntimeConfig,
} from '../../src/chat/contracts'
import { DEFAULT_LIVE2D_PACKAGE_ID } from '../live2dLibrary'

const STORE_VERSION = 2
const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_MODEL = 'deepseek-chat'

type StoredProviderConfig = {
  baseUrl: string
  model: string
  encryptedApiKey?: string
}

type ChatDatabase = {
  version: number
  sessions: ChatSession[]
  provider: StoredProviderConfig
}

export type SecretCipher = {
  isEncryptionAvailable: () => boolean
  encryptString: (plainText: string) => Buffer
  decryptString: (encrypted: Buffer) => string
}

function emptyDatabase(): ChatDatabase {
  return {
    version: STORE_VERSION,
    sessions: [],
    provider: {
      baseUrl: DEFAULT_BASE_URL,
      model: DEFAULT_MODEL,
    },
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function titleFrom(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > 32 ? `${normalized.slice(0, 32)}…` : normalized
}

function migrateDatabase(raw: unknown): ChatDatabase {
  if (!raw || typeof raw !== 'object') throw new Error('不支持的聊天数据格式')
  const candidate = raw as Partial<ChatDatabase> & { version?: number }
  if (!Array.isArray(candidate.sessions) || !candidate.provider) {
    throw new Error('不支持的聊天数据格式')
  }
  if (
    typeof candidate.provider.baseUrl !== 'string' ||
    typeof candidate.provider.model !== 'string'
  ) {
    throw new Error('不支持的聊天数据格式')
  }

  const sessions = candidate.sessions.map((session) => {
    const packageId =
      typeof (session as ChatSession).packageId === 'string' &&
      (session as ChatSession).packageId.trim()
        ? (session as ChatSession).packageId.trim()
        : DEFAULT_LIVE2D_PACKAGE_ID
    return { ...session, packageId } as ChatSession
  })

  return {
    version: STORE_VERSION,
    sessions,
    provider: candidate.provider,
  }
}

export class ChatStore {
  private readonly dataPath: string
  private database = emptyDatabase()
  private memoryApiKey = ''
  private initialized = false
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(
    storageDirectory: string,
    private readonly cipher: SecretCipher,
  ) {
    this.dataPath = path.join(storageDirectory, 'chat-data.json')
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.dataPath), { recursive: true })
    try {
      const raw = await readFile(this.dataPath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      this.database = migrateDatabase(parsed)
      if ((parsed as { version?: number }).version !== STORE_VERSION) {
        await this.persist()
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        const backupPath = `${this.dataPath}.corrupt-${Date.now()}`
        try {
          await rename(this.dataPath, backupPath)
        } catch {
          // 原文件可能已被外部删除；继续创建空数据库。
        }
      }
      this.database = emptyDatabase()
      await this.persist()
    }
    this.initialized = true
  }

  listSessions(packageId?: string): ChatSessionSummary[] {
    this.assertInitialized()
    return this.database.sessions
      .filter((session) => (packageId ? session.packageId === packageId : true))
      .map(({ messages, ...session }) => ({
        ...session,
        messageCount: messages.length,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  getSession(sessionId: string): ChatSession | null {
    this.assertInitialized()
    const session = this.database.sessions.find((item) => item.id === sessionId)
    return session ? clone(session) : null
  }

  async createSession(packageId: string): Promise<ChatSession> {
    const normalized = packageId.trim()
    if (!normalized) throw new Error('模型包标识无效')
    return this.mutate(() => {
      const now = new Date().toISOString()
      const session: ChatSession = {
        id: randomUUID(),
        packageId: normalized,
        title: '新对话',
        createdAt: now,
        updatedAt: now,
        messages: [],
      }
      this.database.sessions.push(session)
      return clone(session)
    })
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    return this.mutate(() => {
      const index = this.database.sessions.findIndex((item) => item.id === sessionId)
      if (index < 0) return false
      this.database.sessions.splice(index, 1)
      return true
    })
  }

  async deleteSessionsByPackageId(packageId: string): Promise<string[]> {
    return this.mutate(() => {
      const removedIds: string[] = []
      this.database.sessions = this.database.sessions.filter((session) => {
        if (session.packageId !== packageId) return true
        removedIds.push(session.id)
        return false
      })
      return removedIds
    })
  }

  async appendMessage(
    sessionId: string,
    role: ChatRole,
    content: string,
    status: ChatMessageStatus = 'complete',
  ): Promise<ChatMessage> {
    return this.mutate(() => {
      const session = this.requireSession(sessionId)
      const now = new Date().toISOString()
      const message: ChatMessage = {
        id: randomUUID(),
        sessionId,
        role,
        content,
        status,
        createdAt: now,
        updatedAt: now,
      }
      session.messages.push(message)
      session.updatedAt = now
      if (role === 'user' && session.messages.filter((item) => item.role === 'user').length === 1) {
        session.title = titleFrom(content) || '新对话'
      }
      return clone(message)
    })
  }

  async updateMessage(
    sessionId: string,
    messageId: string,
    patch: Pick<ChatMessage, 'content' | 'status'> & Partial<Pick<ChatMessage, 'error'>>,
  ): Promise<ChatMessage> {
    return this.mutate(() => {
      const session = this.requireSession(sessionId)
      const message = session.messages.find((item) => item.id === messageId)
      if (!message) throw new Error('消息不存在')
      message.content = patch.content
      message.status = patch.status
      message.updatedAt = new Date().toISOString()
      if (patch.error) message.error = patch.error
      else delete message.error
      session.updatedAt = message.updatedAt
      return clone(message)
    })
  }

  getProviderConfig(): ProviderPublicConfig {
    this.assertInitialized()
    const hasEncrypted = Boolean(this.database.provider.encryptedApiKey)
    return {
      baseUrl: this.database.provider.baseUrl,
      model: this.database.provider.model,
      hasApiKey: Boolean(this.memoryApiKey) || hasEncrypted,
      apiKeyStorage: this.memoryApiKey
        ? 'memory'
        : hasEncrypted
          ? 'encrypted'
          : 'none',
    }
  }

  getRuntimeProviderConfig(): ProviderRuntimeConfig | null {
    this.assertInitialized()
    let apiKey = this.memoryApiKey
    const encrypted = this.database.provider.encryptedApiKey
    if (!apiKey && encrypted) {
      if (!this.cipher.isEncryptionAvailable()) return null
      try {
        apiKey = this.cipher.decryptString(Buffer.from(encrypted, 'base64'))
      } catch {
        return null
      }
    }
    if (!apiKey) return null
    return {
      baseUrl: this.database.provider.baseUrl,
      model: this.database.provider.model,
      apiKey,
    }
  }

  async updateProviderConfig(input: ProviderConfigInput): Promise<ProviderPublicConfig> {
    const baseUrl = input.baseUrl.trim().replace(/\/+$/, '')
    const model = input.model.trim()
    const key = input.apiKey?.trim()
    return this.mutate(() => {
      this.database.provider.baseUrl = baseUrl
      this.database.provider.model = model
      if (key !== undefined) {
        this.memoryApiKey = ''
        delete this.database.provider.encryptedApiKey
        if (key) {
          if (this.cipher.isEncryptionAvailable()) {
            this.database.provider.encryptedApiKey = this.cipher
              .encryptString(key)
              .toString('base64')
          } else {
            this.memoryApiKey = key
          }
        }
      }
      return this.getProviderConfig()
    })
  }

  private requireSession(sessionId: string): ChatSession {
    const session = this.database.sessions.find((item) => item.id === sessionId)
    if (!session) throw new Error('会话不存在')
    return session
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('ChatStore 尚未初始化')
  }

  private async mutate<T>(mutation: () => T): Promise<T> {
    this.assertInitialized()
    let result!: T
    const operation = this.writeQueue.then(async () => {
      result = mutation()
      await this.persist()
    })
    this.writeQueue = operation.catch(() => undefined)
    await operation
    return result
  }

  private async persist(): Promise<void> {
    await atomicWriteTextFile(this.dataPath, JSON.stringify(this.database, null, 2))
  }
}
