import type {
  AgentTool,
  Reminder,
  ReminderCreateInput,
} from '../../src/chat/contracts'
import type { ToolRegistry } from '../chat/toolRegistry'
import type { ReminderStore } from './reminderStore'

export class ReminderService {
  constructor(
    private readonly store: ReminderStore,
    private readonly registry: ToolRegistry,
    private readonly onChanged: () => void = () => undefined,
  ) {}

  registerDefaultTools(): void {
    for (const tool of this.buildTools()) {
      if (!this.registry.get(tool.name)) this.registry.register(tool as AgentTool)
    }
  }

  async create(input: ReminderCreateInput): Promise<Reminder> {
    const reminder = await this.store.create(input)
    this.onChanged()
    return reminder
  }

  async cancel(id: string): Promise<boolean> {
    const ok = await this.store.cancel(id)
    if (ok) this.onChanged()
    return ok
  }

  list(): Reminder[] {
    return this.store.list()
  }

  private buildTools() {
    return [
      {
        name: 'schedule_reminder',
        enabled: true,
        riskLevel: 'safe' as const,
        description:
          '创建本地到点提醒（会主动弹桌宠气泡）。用于用户明确要求「N 分钟后提醒」「到某时刻提醒」等。不要用 remember_fact 代替到点提醒。',
        parameters: {
          type: 'object' as const,
          properties: {
            content: { type: 'string', description: '提醒内容' },
            delayMinutes: {
              type: 'number',
              description: '多少分钟后提醒（与 fireAt 二选一）',
            },
            fireAt: {
              type: 'string',
              description: 'ISO 到期时间（与 delayMinutes 二选一）',
            },
          },
          required: ['content'],
          additionalProperties: false,
        },
        validate: (input: unknown) => {
          if (!input || typeof input !== 'object') throw new Error('参数无效')
          const value = input as Record<string, unknown>
          if (typeof value.content !== 'string') throw new Error('需要 content')
          return {
            content: value.content,
            delayMinutes:
              typeof value.delayMinutes === 'number'
                ? value.delayMinutes
                : undefined,
            fireAt: typeof value.fireAt === 'string' ? value.fireAt : undefined,
          } satisfies ReminderCreateInput
        },
        execute: async (input: ReminderCreateInput, _signal: AbortSignal) => {
          const reminder = await this.create(input)
          return {
            ok: true,
            id: reminder.id,
            fireAt: reminder.fireAt,
            content: reminder.content,
          }
        },
      },
      {
        name: 'cancel_reminder',
        enabled: true,
        riskLevel: 'safe' as const,
        description: '取消一条尚未触发的本地提醒（需提供提醒 id）。',
        parameters: {
          type: 'object' as const,
          properties: {
            id: { type: 'string', description: '提醒 id' },
          },
          required: ['id'],
          additionalProperties: false,
        },
        validate: (input: unknown) => {
          if (!input || typeof input !== 'object') throw new Error('参数无效')
          const value = input as Record<string, unknown>
          if (typeof value.id !== 'string' || !value.id.trim()) {
            throw new Error('需要 id')
          }
          return { id: value.id.trim() }
        },
        execute: async (input: { id: string }, _signal: AbortSignal) => {
          const ok = await this.cancel(input.id)
          return { ok, id: input.id }
        },
      },
    ]
  }
}
