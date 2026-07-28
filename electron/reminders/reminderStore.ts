import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename } from 'node:fs/promises'
import path from 'node:path'
import type { Reminder, ReminderCreateInput } from '../../src/chat/contracts'
import { atomicWriteTextFile } from '../fsAtomic'

const STORE_VERSION = 1
const MAX_REMINDERS = 200
const MAX_CONTENT = 500

type ReminderDatabase = {
  version: typeof STORE_VERSION
  reminders: Reminder[]
}

function emptyDatabase(): ReminderDatabase {
  return { version: STORE_VERSION, reminders: [] }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function isReminderDatabase(value: unknown): value is ReminderDatabase {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ReminderDatabase>
  return (
    candidate.version === STORE_VERSION && Array.isArray(candidate.reminders)
  )
}

function resolveFireAt(input: ReminderCreateInput): string {
  if (typeof input.fireAt === 'string' && input.fireAt.trim()) {
    const parsed = Date.parse(input.fireAt)
    if (Number.isNaN(parsed)) throw new Error('fireAt 时间格式无效')
    return new Date(parsed).toISOString()
  }
  if (
    typeof input.delayMinutes === 'number' &&
    Number.isFinite(input.delayMinutes) &&
    input.delayMinutes > 0
  ) {
    return new Date(Date.now() + input.delayMinutes * 60_000).toISOString()
  }
  throw new Error('需要提供 fireAt 或正数 delayMinutes')
}

export class ReminderStore {
  private readonly dataPath: string
  private database = emptyDatabase()
  private initialized = false
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(storageDirectory: string) {
    this.dataPath = path.join(storageDirectory, 'reminder-data.json')
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.dataPath), { recursive: true })
    try {
      const raw = await readFile(this.dataPath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (!isReminderDatabase(parsed)) throw new Error('不支持的提醒数据格式')
      this.database = parsed
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        const backupPath = `${this.dataPath}.corrupt-${Date.now()}`
        try {
          await rename(this.dataPath, backupPath)
        } catch {
          // ignore
        }
      }
      this.database = emptyDatabase()
      await this.persist()
    }
    this.initialized = true
  }

  list(): Reminder[] {
    this.assertInitialized()
    return clone(this.database.reminders).sort((a, b) =>
      a.fireAt.localeCompare(b.fireAt),
    )
  }

  listPending(): Reminder[] {
    return this.list().filter((item) => item.status === 'pending')
  }

  listDue(now = new Date()): Reminder[] {
    const iso = now.toISOString()
    return this.listPending().filter((item) => item.fireAt <= iso)
  }

  get(id: string): Reminder | null {
    this.assertInitialized()
    const item = this.database.reminders.find((entry) => entry.id === id)
    return item ? clone(item) : null
  }

  async create(input: ReminderCreateInput): Promise<Reminder> {
    const content = input.content?.trim()
    if (!content) throw new Error('提醒内容不能为空')
    if (content.length > MAX_CONTENT) {
      throw new Error(`提醒内容不能超过 ${MAX_CONTENT} 个字符`)
    }
    const fireAt = resolveFireAt(input)
    return this.mutate(() => {
      if (this.database.reminders.length >= MAX_REMINDERS) {
        throw new Error('提醒条目已达上限，请先清理')
      }
      const now = new Date().toISOString()
      const reminder: Reminder = {
        id: randomUUID(),
        content,
        fireAt,
        status: 'pending',
        createdAt: now,
      }
      if (input.sourceSessionId) reminder.sourceSessionId = input.sourceSessionId
      this.database.reminders.push(reminder)
      return clone(reminder)
    })
  }

  async cancel(id: string): Promise<boolean> {
    return this.mutate(() => {
      const item = this.database.reminders.find((entry) => entry.id === id)
      if (!item || item.status !== 'pending') return false
      item.status = 'cancelled'
      return true
    })
  }

  async markFired(ids: string[], firedAt = new Date().toISOString()): Promise<number> {
    if (ids.length === 0) return 0
    const idSet = new Set(ids)
    return this.mutate(() => {
      let count = 0
      for (const item of this.database.reminders) {
        if (!idSet.has(item.id) || item.status !== 'pending') continue
        item.status = 'fired'
        item.firedAt = firedAt
        count += 1
      }
      return count
    })
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('ReminderStore 尚未初始化')
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
