import { describe, expect, it } from 'vitest'
import type { Reminder } from '../../src/chat/contracts'
import {
  clampBubbleText,
  fallbackBubbleText,
  mergeReminderIntent,
} from './reminderText'

function item(content: string): Reminder {
  return {
    id: content,
    content,
    fireAt: new Date().toISOString(),
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
}

describe('reminderText', () => {
  it('单条合并用原文，多条列要点', () => {
    expect(mergeReminderIntent([item('喝水')])).toBe('喝水')
    expect(mergeReminderIntent([item('喝水'), item('开会')])).toBe(
      '1. 喝水\n2. 开会',
    )
  })

  it('降级文案与截断', () => {
    expect(fallbackBubbleText([item('喝水')])).toBe('提醒你：喝水')
    expect(fallbackBubbleText([item('A'), item('B')])).toBe('该提醒你啦：A；B')
    expect(clampBubbleText('  hello   world  ')).toBe('hello world')
  })
})
