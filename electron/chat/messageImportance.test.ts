import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../src/chat/contracts'
import {
  scoreMessageImportance,
  trimContextWeighted,
} from './messageImportance'

function message(
  id: string,
  content: string,
  role: ChatMessage['role'] = 'user',
  importance?: 1 | 2 | 3,
): ChatMessage {
  return {
    id,
    sessionId: 's',
    role,
    content,
    status: 'complete',
    createdAt: `2026-01-01T00:00:0${id.length % 10}.000Z`,
    updatedAt: `2026-01-01T00:00:0${id.length % 10}.000Z`,
    ...(importance ? { importance } : {}),
  }
}

describe('scoreMessageImportance', () => {
  it('用户消息关键事实为高重要性', () => {
    expect(scoreMessageImportance('我决定明天开始学习英语', 'user')).toBe(3)
    expect(scoreMessageImportance('我的生日是 6 月 1 日', 'user')).toBe(3)
  })

  it('提问与较长内容为高重要性', () => {
    expect(scoreMessageImportance('LangGraph 的节点怎么编排？', 'user')).toBe(3)
    expect(scoreMessageImportance('x'.repeat(40), 'user')).toBe(3)
  })

  it('寒暄与平凡闲聊为中/低重要性', () => {
    expect(scoreMessageImportance('嗯嗯', 'user')).toBe(1)
    expect(scoreMessageImportance('今天天气不错', 'user')).toBe(2)
  })

  it('助手消息带成功工具调用为高重要性', () => {
    expect(scoreMessageImportance('好的', 'assistant', { hasToolSuccess: true })).toBe(3)
    expect(scoreMessageImportance('好的', 'assistant')).toBe(2)
  })
})

describe('trimContextWeighted', () => {
  it('预算内保留全部并保序', () => {
    const messages = [message('1', 'a'), message('2', 'b'), message('3', 'c')]
    const result = trimContextWeighted(messages, 10_000)
    expect(result.map((item) => item.id)).toEqual(['1', '2', '3'])
  })

  it('超预算保留最近窗口且至少保留最新一条', () => {
    const messages = [
      message('1', '12345'),
      message('2', '67890'),
      message('3', 'current', 'user', 3),
    ]
    const result = trimContextWeighted(messages, 8)
    expect(result.map((item) => item.id)).toEqual(['3'])
  })

  it('窗口外高重要性消息优先于低重要性保留，输出保序', () => {
    const messages = [
      message('1', 'x'.repeat(20), 'user', 1),
      message('2', 'y'.repeat(20), 'user', 3),
      message('3', 'z'.repeat(20), 'user', 3),
      message('4', 'recent-' + 'n'.repeat(20), 'user', 2),
    ]
    // 预算 60：近期窗口(40)只装下最新一条(27 字)，剩余 33 字优先给窗口外高重要性
    const result = trimContextWeighted(messages, 60, { recentWindowChars: 40 })
    const ids = result.map((item) => item.id)
    expect(ids).toContain('4')
    // 输出保序
    expect(ids).toEqual([...ids].sort())
    // 窗口外高重要性(3)被保留，低重要性(1)被裁掉
    expect(ids).toContain('2')
    expect(ids).not.toContain('1')
  })

  it('importanceTrim=false 时回退纯 recency（只留最近窗口）', () => {
    const messages = [
      message('1', 'x'.repeat(20), 'user', 3),
      message('2', 'y'.repeat(20), 'user', 2),
      message('3', 'z'.repeat(20), 'user', 2),
    ]
    // 近期窗口 40 正好装下最新两条(20+20)
    const result = trimContextWeighted(messages, 60, {
      recentWindowChars: 40,
      importanceTrim: false,
    })
    expect(result.map((item) => item.id)).toEqual(['2', '3'])
  })
})
