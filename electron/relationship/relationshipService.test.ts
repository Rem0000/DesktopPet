import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ToolRegistry } from '../chat/toolRegistry'
import { DEFAULT_AFFINITY, RelationshipStore } from './relationshipStore'
import { RelationshipService } from './relationshipService'

const directories: string[] = []

async function createService(packageId = 'pkg-1') {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'desktop-pet-rel-svc-'))
  directories.push(directory)
  const store = new RelationshipStore(directory)
  await store.initialize()
  const tools = new ToolRegistry()
  const service = new RelationshipService(store, tools, () => packageId)
  service.registerDefaultTools()
  return { store, tools, service }
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('RelationshipService update_relationship 策略闸门', () => {
  it('layered 策略下正常写入好感', async () => {
    const { store, tools } = await createService()
    const tool = tools.get('update_relationship')!
    const result = await tool.execute(
      tool.validate({ delta: 10, note: '聊得很开心' }),
      new AbortController().signal,
    )
    expect(result).toMatchObject({ ok: true })
    expect((await store.getState('pkg-1')).affinity).toBe(DEFAULT_AFFINITY + 10)
  })

  it('persona-first 策略下执行被拦截，好感不变且不新增记录', async () => {
    const { store, tools } = await createService()
    await store.patch('pkg-1', { policy: 'persona-first' })
    const before = (await store.getState('pkg-1')).history.length
    const tool = tools.get('update_relationship')!
    const result = await tool.execute(
      tool.validate({ delta: 10, note: 'x' }),
      new AbortController().signal,
    )
    expect(result).toMatchObject({
      ok: false,
      errorCode: 'persona_first_policy',
    })
    const state = await store.getState('pkg-1')
    expect(state.affinity).toBe(DEFAULT_AFFINITY)
    expect(state.history).toHaveLength(before)
  })

  it('isUpdateAllowed 随策略返回', async () => {
    const { store, service } = await createService()
    await store.patch('pkg-1', { policy: 'layered' })
    expect(await service.isUpdateAllowed()).toBe(true)
    await store.patch('pkg-1', { policy: 'persona-first' })
    expect(await service.isUpdateAllowed()).toBe(false)
    await store.patch('pkg-1', { policy: 'dynamic-first' })
    expect(await service.isUpdateAllowed()).toBe(true)
  })

  it('执行优先采用 ctx.packageId（会话归属），而非环境活跃包', async () => {
    const { store, tools } = await createService('ambient-pkg')
    // 环境活跃包已设 persona-first；会话归属包是 layered
    await store.patch('ambient-pkg', { policy: 'persona-first' })
    const tool = tools.get('update_relationship')!
    const result = await tool.execute(
      tool.validate({ delta: 5, note: '会话内聊得很开心' }),
      new AbortController().signal,
      { packageId: 'pkg-1' },
    )
    expect(result).toMatchObject({ ok: true })
    expect((await store.getState('pkg-1')).affinity).toBe(DEFAULT_AFFINITY + 5)
    // 环境活跃包不被写入
    expect((await store.getState('ambient-pkg')).affinity).toBe(DEFAULT_AFFINITY)
  })

  it('无 ctx 时回退环境活跃包', async () => {
    const { store, tools } = await createService('pkg-1')
    const tool = tools.get('update_relationship')!
    const result = await tool.execute(
      tool.validate({ delta: 3 }),
      new AbortController().signal,
    )
    expect(result).toMatchObject({ ok: true })
    expect((await store.getState('pkg-1')).affinity).toBe(DEFAULT_AFFINITY + 3)
  })

  it('无实际变化（delta 钳制为 0 且无笔记）时如实报告 no_change', async () => {
    const { store, tools } = await createService('pkg-1')
    const tool = tools.get('update_relationship')!
    const before = (await store.getState('pkg-1')).history.length

    const empty = await tool.execute(
      tool.validate({}),
      new AbortController().signal,
    )
    expect(empty).toMatchObject({ ok: false, errorCode: 'no_change' })

    // 0.4 会被钳制为 0 → no_change
    const fractional = await tool.execute(
      tool.validate({ delta: 0.4 }),
      new AbortController().signal,
    )
    expect(fractional).toMatchObject({ ok: false, errorCode: 'no_change' })

    // 纯空白 note 也是 no_change
    const blankNote = await tool.execute(
      tool.validate({ note: '   ' }),
      new AbortController().signal,
    )
    expect(blankNote).toMatchObject({ ok: false, errorCode: 'no_change' })

    const state = await store.getState('pkg-1')
    expect(state.affinity).toBe(DEFAULT_AFFINITY)
    expect(state.history).toHaveLength(before)
  })
})
