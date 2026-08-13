import { describe, expect, it } from 'vitest'
import path from 'node:path'
import type { AgentTool } from '../../../src/chat/contracts'

// 加载真实猜数字技能的 tools.js（CJS，路径相对于仓库根）
const toolsPath = path.resolve(
  __dirname,
  '../../../skills/guessnumber/script/tools.js',
)
const mod = require(toolsPath) as {
  createTools(): AgentTool[]
  _getState(sessionId: string): { secret: number; attempts: number; running: boolean } | undefined
}

function getTool(name: string): AgentTool {
  const tool = mod.createTools().find((t) => t.name === name)
  if (!tool) throw new Error(`tool 不存在:${name}`)
  return tool
}

const input = (sessionId: string, extra: Record<string, unknown> = {}) => ({
  sourceSessionId: sessionId,
  ...extra,
})

describe('guessnumber tools（真实 tools.js）', () => {
  it('generate_secret 幂等：同会话游戏进行中重复调用不换谜底', async () => {
    const gen = getTool('generate_secret')
    const a = (await gen.execute(input('s1'), new AbortController().signal)) as { secret: number }
    const b = (await gen.execute(input('s1'), new AbortController().signal)) as { secret: number }
    expect(a.secret).toBe(b.secret)
  })

  it('猜过数字后再 generate_secret 会开新局并重置次数', async () => {
    const gen = getTool('generate_secret')
    const cmp = getTool('compare_guess')
    // 第一局猜两次,未猜中(模拟状态残留)
    await gen.execute(input('s5'), new AbortController().signal)
    await cmp.execute(input('s5', { guess: 1 }), new AbortController().signal)
    await cmp.execute(input('s5', { guess: 2 }), new AbortController().signal)
    // 再来一局 → 必须开新局,而非沿用残留
    const fresh = (await gen.execute(input('s5'), new AbortController().signal)) as {
      secret: number
    }
    const r = (await cmp.execute(
      input('s5', { guess: fresh.secret }),
      new AbortController().signal,
    )) as { status: string; attempts: number; gameOver?: boolean }
    expect(r.status).toBe('correct')
    expect(r.attempts).toBe(1)
    expect(r.gameOver).toBe(true)
  })

  it('compare_guess 返回真实状态与次数', async () => {
    const gen = getTool('generate_secret')
    const cmp = getTool('compare_guess')
    const { secret } = (await gen.execute(input('s2'), new AbortController().signal)) as {
      secret: number
    }
    const r = (await cmp.execute(
      input('s2', { guess: secret + 1 }),
      new AbortController().signal,
    )) as { status: string; attempts: number }
    expect(r.status).toBe('high')
    expect(r.attempts).toBe(1)
  })

  it('游戏状态按会话隔离：会话 A 的局不影响会话 B', async () => {
    const gen = getTool('generate_secret')
    const cmp = getTool('compare_guess')
    const { secret: secretA } = (await gen.execute(input('A'), new AbortController().signal)) as {
      secret: number
    }
    await gen.execute(input('B'), new AbortController().signal)
    const rA = (await cmp.execute(
      input('A', { guess: secretA }),
      new AbortController().signal,
    )) as { status: string }
    expect(rA.status).toBe('correct')
    // A 猜中结束不影响 B 仍可继续猜
    const rB = (await cmp.execute(
      input('B', { guess: 50 }),
      new AbortController().signal,
    )) as { status: string; attempts: number }
    expect(['low', 'high', 'correct']).toContain(rB.status)
    expect(rB.attempts).toBe(1)
  })

  it('compare_guess 无 sourceSessionId 时报错', async () => {
    const cmp = getTool('compare_guess')
    const r = (await cmp.execute({ guess: 50 }, new AbortController().signal)) as {
      ok: boolean
      error?: string
    }
    expect(r.ok).toBe(false)
    expect(r.error).toContain('游戏尚未开始')
  })

  it('end_game 清理该会话游戏状态', async () => {
    const gen = getTool('generate_secret')
    const end = getTool('end_game')
    const cmp = getTool('compare_guess')
    await gen.execute(input('s3'), new AbortController().signal)
    expect(await end.execute(input('s3'), new AbortController().signal)).toMatchObject({
      ok: true,
      ended: true,
    })
    const after = (await cmp.execute(
      input('s3', { guess: 50 }),
      new AbortController().signal,
    )) as { ok: boolean }
    expect(after.ok).toBe(false)
  })
})
