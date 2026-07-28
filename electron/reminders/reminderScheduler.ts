import { powerMonitor } from 'electron'
import type {
  PetAgentState,
  ProviderRuntimeConfig,
  Reminder,
  SpeechBubblePayload,
} from '../../src/chat/contracts'
import { rewriteReminderInPersona } from './reminderRewrite'
import type { ReminderStore } from './reminderStore'
import {
  fallbackBubbleText,
  mergeReminderIntent,
} from './reminderText'

const MAX_TIMEOUT_MS = 2_147_483_647

export type ReminderSchedulerDeps = {
  store: ReminderStore
  getPersona: () => string
  getRuntimeConfig: () => ProviderRuntimeConfig | null
  showBubble: (payload: SpeechBubblePayload) => void
  onPetState?: (state: PetAgentState) => void
  /** 宠物窗不可见时的系统通知兜底 */
  notifySystem?: (title: string, body: string) => void
  isPetVisible?: () => boolean
}

export class ReminderScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null
  private firing = false
  private started = false
  private readonly onResume = () => {
    void this.scanAndFire()
  }

  constructor(private readonly deps: ReminderSchedulerDeps) {}

  start(): void {
    if (this.started) return
    this.started = true
    try {
      powerMonitor.on('resume', this.onResume)
    } catch {
      // 非 Electron 测试环境可能无 powerMonitor
    }
    void this.scanAndFire()
  }

  stop(): void {
    this.started = false
    this.clearTimer()
    try {
      powerMonitor.removeListener('resume', this.onResume)
    } catch {
      // ignore
    }
  }

  /** 创建/取消后重新排队下一次触发 */
  reschedule(): void {
    if (!this.started || this.firing) return
    this.scheduleNext()
  }

  async scanAndFire(): Promise<void> {
    if (this.firing) return
    this.clearTimer()
    const due = this.deps.store.listDue()
    if (due.length > 0) {
      await this.fireBatch(due)
    }
    this.scheduleNext()
  }

  private scheduleNext(): void {
    this.clearTimer()
    const pending = this.deps.store.listPending()
    const next = pending[0]
    if (!next) return
    const delay = Math.max(0, Date.parse(next.fireAt) - Date.now())
    const wait = Math.min(delay, MAX_TIMEOUT_MS)
    this.timer = setTimeout(() => {
      void this.scanAndFire()
    }, wait)
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private async fireBatch(batch: Reminder[]): Promise<void> {
    this.firing = true
    try {
      const intent = mergeReminderIntent(batch)
      const fallback = fallbackBubbleText(batch)
      let text = fallback
      const config = this.deps.getRuntimeConfig()
      if (config) {
        const rewritten = await rewriteReminderInPersona({
          persona: this.deps.getPersona(),
          intent,
          config,
        })
        if (rewritten) text = rewritten
      }

      const ids = batch.map((item) => item.id)
      await this.deps.store.markFired(ids)

      this.deps.onPetState?.('speaking')
      this.deps.showBubble({ text, durationMs: 10_000 })

      if (this.deps.notifySystem && this.deps.isPetVisible && !this.deps.isPetVisible()) {
        this.deps.notifySystem('桌宠提醒', text)
      }
    } finally {
      this.firing = false
    }
  }
}
