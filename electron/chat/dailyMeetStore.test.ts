import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DailyMeetStore } from './dailyMeetStore'

const directories: string[] = []

async function createStore(): Promise<DailyMeetStore> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'desktop-pet-daily-'))
  directories.push(directory)
  const store = new DailyMeetStore(directory)
  await store.initialize()
  return store
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('DailyMeetStore', () => {
  it('无记录时返回 null', async () => {
    const store = await createStore()
    expect(store.getLastMeetDate('pkg-a')).toBeNull()
  })

  it('setMeetToday 后返回对应日期', async () => {
    const store = await createStore()
    await store.setMeetToday('pkg-a', '2026-08-05')
    expect(store.getLastMeetDate('pkg-a')).toBe('2026-08-05')
  })

  it('按包隔离，互不干扰', async () => {
    const store = await createStore()
    await store.setMeetToday('pkg-a', '2026-08-05')
    expect(store.getLastMeetDate('pkg-a')).toBe('2026-08-05')
    expect(store.getLastMeetDate('pkg-b')).toBeNull()
  })

  it('同日覆盖为最新日期', async () => {
    const store = await createStore()
    await store.setMeetToday('pkg-a', '2026-08-05')
    await store.setMeetToday('pkg-a', '2026-08-05')
    expect(store.getLastMeetDate('pkg-a')).toBe('2026-08-05')
  })

  it('跨实例持久化（重新初始化后仍可读）', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'desktop-pet-daily-'))
    directories.push(directory)
    const first = new DailyMeetStore(directory)
    await first.initialize()
    await first.setMeetToday('pkg-a', '2026-08-05')

    const second = new DailyMeetStore(directory)
    await second.initialize()
    expect(second.getLastMeetDate('pkg-a')).toBe('2026-08-05')
  })
})
