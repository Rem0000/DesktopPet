import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { DailyMeetDatabase } from '../../src/chat/contracts'
import { atomicWriteTextFile } from '../fsAtomic'

const STORE_VERSION = 1

function emptyDatabase(): DailyMeetDatabase {
  return { version: STORE_VERSION, byPackage: {} }
}

function isDatabase(value: unknown): value is DailyMeetDatabase {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<DailyMeetDatabase>
  return (
    candidate.version === STORE_VERSION &&
    Boolean(candidate.byPackage) &&
    typeof candidate.byPackage === 'object'
  )
}

/**
 * 每日首次见面状态：按 Live2D 包记录"当日是否已首次对话"（`lastMeetDate: 'YYYY-MM-DD'`）。
 * 跨会话、跨应用重启持久化；原子写 + 串行队列避免并发读改写丢失。
 */
export class DailyMeetStore {
  private readonly dataPath: string
  private database = emptyDatabase()
  private initialized = false
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(storageDirectory: string) {
    this.dataPath = path.join(storageDirectory, 'daily-meet.json')
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.dataPath), { recursive: true })
    try {
      const raw = await readFile(this.dataPath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (isDatabase(parsed)) this.database = parsed
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        // 解析失败按空库处理，不抛出
      }
      this.database = emptyDatabase()
    }
    this.initialized = true
  }

  /** 返回该包最近一次"首次见面"的本地日期（YYYY-MM-DD）；无记录返回 null */
  getLastMeetDate(packageId: string): string | null {
    this.assertInitialized()
    const record = this.database.byPackage[packageId]
    return record && typeof record.lastMeetDate === 'string' ? record.lastMeetDate : null
  }

  /** 记录该包"今天已首次见面" */
  async setMeetToday(packageId: string, date: string): Promise<void> {
    await this.mutate(() => {
      this.database.byPackage[packageId] = { lastMeetDate: date }
    })
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('DailyMeetStore 尚未初始化')
  }

  private async mutate<T>(mutation: () => T): Promise<T> {
    this.assertInitialized()
    let result!: T
    const operation = this.writeQueue.then(async () => {
      result = mutation()
      await atomicWriteTextFile(this.dataPath, JSON.stringify(this.database, null, 2))
    })
    this.writeQueue = operation.catch(() => undefined)
    await operation
    return result
  }
}
