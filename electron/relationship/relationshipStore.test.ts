import { access, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_AFFINITY,
  RelationshipStore,
  STAGE_ORDER,
  stageForAffinity,
} from './relationshipStore'

const directories: string[] = []

async function createStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'desktop-pet-rel-'))
  directories.push(directory)
  const store = new RelationshipStore(directory)
  await store.initialize()
  return { store, directory }
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('RelationshipStore', () => {
  it('缺失文件按默认值初始化', async () => {
    const { store } = await createStore()
    const state = await store.getState('pkg-1')
    expect(state.policy).toBe('layered')
    expect(state.affinity).toBe(DEFAULT_AFFINITY)
    expect(state.stage).toBe('stranger')
    expect(state.evolutions).toEqual([])
    expect(state.history).toEqual([])
  })

  it('applyWrite 累积好感并推进阶段，写入历史', async () => {
    const { store } = await createStore()
    let state = await store.applyWrite('pkg-1', { delta: 10, note: '聊得很开心' })
    expect(state.affinity).toBe(30)
    expect(state.stage).toBe('acquaintance')
    expect(state.history).toHaveLength(1)
    expect(state.history[0].delta).toBe(10)
    expect(state.history[0].beforeStage).toBe('stranger')
    expect(state.history[0].afterStage).toBe('acquaintance')

    // 累计两次 +10 → affinity 50（friendly）
    state = await store.applyWrite('pkg-1', { delta: 10 })
    state = await store.applyWrite('pkg-1', { delta: 10 })
    expect(state.affinity).toBe(50)
    expect(state.stage).toBe('friendly')
    expect(state.history).toHaveLength(3)
  })

  it('单次增量钳制 ±10，好感累计钳制 [0,100]', async () => {
    const { store } = await createStore()
    let state = await store.applyWrite('pkg-1', { delta: 1000 })
    expect(state.affinity).toBe(30)
    expect(state.stage).toBe('acquaintance')
    for (let i = 0; i < 10; i += 1) {
      state = await store.applyWrite('pkg-1', { delta: 10 })
    }
    expect(state.affinity).toBe(100)
    expect(state.stage).toBe('intimate')
    for (let i = 0; i < 20; i += 1) {
      state = await store.applyWrite('pkg-1', { delta: -10 })
    }
    expect(state.affinity).toBe(0)
    expect(state.stage).toBe('stranger')
  })

  it('纯 note 不改变好感但记录历史', async () => {
    const { store } = await createStore()
    const state = await store.applyWrite('pkg-1', { note: '提到喜欢猫' })
    expect(state.affinity).toBe(DEFAULT_AFFINITY)
    expect(state.history).toHaveLength(1)
    expect(state.history[0].note).toBe('提到喜欢猫')
  })

  it('patch 手工修正 affinity/policy/temperatureNote', async () => {
    const { store } = await createStore()
    const state = await store.patch('pkg-1', {
      affinity: 80,
      policy: 'dynamic-first',
      temperatureNote: '非常信任你',
    })
    expect(state.affinity).toBe(80)
    expect(state.stage).toBe('close')
    expect(state.policy).toBe('dynamic-first')
    expect(state.temperatureNote).toBe('非常信任你')
    expect(state.history.length).toBeGreaterThanOrEqual(2)
  })

  it('patch 未变化的 temperatureNote 不新增历史记录', async () => {
    const { store } = await createStore()
    await store.patch('pkg-1', { temperatureNote: '非常信任你' })
    const afterFirst = await store.getState('pkg-1')
    expect(afterFirst.history).toHaveLength(1)

    // 再次保存相同描述：不产生新历史、不更新时间戳
    await store.patch('pkg-1', { temperatureNote: '非常信任你' })
    const afterSecond = await store.getState('pkg-1')
    expect(afterSecond.history).toHaveLength(1)
    expect(afterSecond.updatedAt).toBe(afterFirst.updatedAt)

    // 保存不同描述：产生新历史
    await store.patch('pkg-1', { temperatureNote: '已经无话不谈' })
    const afterThird = await store.getState('pkg-1')
    expect(afterThird.history).toHaveLength(2)
    expect(afterThird.temperatureNote).toBe('已经无话不谈')
  })

  it('reset 回到默认并清空演化', async () => {
    const { store } = await createStore()
    await store.applyWrite('pkg-1', { delta: 50 })
    await store.addProposal('pkg-1', {
      personaQuote: '烟瘾重',
      change: '已戒烟',
      evidence: '近期多次提到戒烟成功',
    })
    const state = await store.reset('pkg-1')
    expect(state.affinity).toBe(DEFAULT_AFFINITY)
    expect(state.stage).toBe('stranger')
    expect(state.policy).toBe('layered')
    expect(state.evolutions).toEqual([])
    expect(state.history).toHaveLength(1)
    expect(state.history[0].type).toBe('reset')
  })

  it('演化候选 propose→applied/rejected 生命周期', async () => {
    const { store } = await createStore()
    const proposal = await store.addProposal('pkg-1', {
      personaQuote: '烟瘾重',
      change: '已戒烟',
      evidence: '证据',
    })
    const pending = await store.listProposals('pkg-1')
    expect(pending).toHaveLength(1)

    const applied = await store.respondProposal('pkg-1', proposal.id, true)
    expect(applied.status).toBe('applied')
    expect(applied.appliedAt).toBeTruthy()
    expect(await store.listProposals('pkg-1')).toHaveLength(0)

    const rejected = await store.addProposal('pkg-1', {
      personaQuote: '不爱说话',
      change: '话变多了',
      evidence: '证据',
    })
    const afterReject = await store.respondProposal('pkg-1', rejected.id, false)
    expect(afterReject.status).toBe('rejected')
    await expect(
      store.respondProposal('pkg-1', rejected.id, true),
    ).rejects.toThrow()
  })

  it('持久化到磁盘且可恢复', async () => {
    const { store, directory } = await createStore()
    await store.applyWrite('pkg-1', { delta: 10, note: '第一次深聊' })
    await store.applyWrite('pkg-1', { delta: 10 })
    await store.applyWrite('pkg-1', { delta: 10 })

    const reopened = new RelationshipStore(directory)
    await reopened.initialize()
    const state = await reopened.getState('pkg-1')
    expect(state.affinity).toBe(50)
    expect(state.stage).toBe('friendly')
    expect(state.history).toHaveLength(3)

    const file = path.join(directory, 'pkg-1.json')
    await expect(access(file)).resolves.toBeUndefined()
  })

  it('deletePackage 移除状态文件', async () => {
    const { store, directory } = await createStore()
    await store.applyWrite('pkg-1', { delta: 10 })
    await expect(
      access(path.join(directory, 'pkg-1.json')),
    ).resolves.toBeUndefined()
    await store.deletePackage('pkg-1')
    await expect(
      access(path.join(directory, 'pkg-1.json')),
    ).rejects.toThrow()
  })

  it('同包并发写入严格串行，增量不丢失', async () => {
    const { store } = await createStore()
    // 并发提交 5 次 +10；串行化后应精确累计 +50
    await Promise.all(
      Array.from({ length: 5 }, () => store.applyWrite('pkg-1', { delta: 10 })),
    )
    const state = await store.getState('pkg-1')
    expect(state.affinity).toBe(DEFAULT_AFFINITY + 50)
    expect(state.history).toHaveLength(5)
  })

  it('不同包写入互不阻塞，队列彼此隔离', async () => {
    const { store } = await createStore()
    // 注意 delta 会被钳制在 ±10 内，因此用合规值计算预期
    await Promise.all([
      store.applyWrite('pkg-a', { delta: 10 }),
      store.applyWrite('pkg-b', { delta: 8 }),
      store.applyWrite('pkg-a', { delta: 5 }),
    ])
    const a = await store.getState('pkg-a')
    const b = await store.getState('pkg-b')
    expect(a.affinity).toBe(DEFAULT_AFFINITY + 15)
    expect(b.affinity).toBe(DEFAULT_AFFINITY + 8)
    expect(a.history).toHaveLength(2)
    expect(b.history).toHaveLength(1)
  })

  it('stageForAffinity 阈值表正确', () => {
    expect(stageForAffinity(0)).toBe('stranger')
    expect(stageForAffinity(29)).toBe('stranger')
    expect(stageForAffinity(30)).toBe('acquaintance')
    expect(stageForAffinity(50)).toBe('friendly')
    expect(stageForAffinity(70)).toBe('close')
    expect(stageForAffinity(90)).toBe('intimate')
    expect(stageForAffinity(100)).toBe('intimate')
    expect(STAGE_ORDER).toHaveLength(5)
  })
})
