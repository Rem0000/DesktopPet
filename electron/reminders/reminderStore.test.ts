import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ReminderStore } from './reminderStore'

const directories: string[] = []

async function createStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'desktop-pet-reminder-'))
  directories.push(directory)
  const store = new ReminderStore(directory)
  await store.initialize()
  return { store, directory }
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('ReminderStore', () => {
  it('创建后落盘，且无 packageId 字段', async () => {
    const { store, directory } = await createStore()
    const created = await store.create({
      content: '喝水',
      delayMinutes: 30,
    })
    expect(created.status).toBe('pending')
    expect(created.content).toBe('喝水')
    expect(created).not.toHaveProperty('packageId')

    const raw = await readFile(path.join(directory, 'reminder-data.json'), 'utf8')
    const parsed = JSON.parse(raw) as { reminders: Array<Record<string, unknown>> }
    expect(parsed.reminders).toHaveLength(1)
    expect(parsed.reminders[0]).not.toHaveProperty('packageId')
  })

  it('支持取消 pending，并按 fireAt 查询到期项', async () => {
    const { store } = await createStore()
    const past = await store.create({
      content: '过去的提醒',
      fireAt: new Date(Date.now() - 60_000).toISOString(),
    })
    const future = await store.create({
      content: '未来的提醒',
      fireAt: new Date(Date.now() + 3_600_000).toISOString(),
    })

    expect(store.listDue()).toHaveLength(1)
    expect(store.listDue()[0]?.id).toBe(past.id)

    expect(await store.cancel(past.id)).toBe(true)
    expect(store.listDue()).toHaveLength(0)
    expect(store.get(past.id)?.status).toBe('cancelled')

    expect(await store.cancel(future.id)).toBe(true)
    expect(store.get(future.id)?.status).toBe('cancelled')
  })

  it('markFired 批量标记', async () => {
    const { store } = await createStore()
    const a = await store.create({
      content: 'A',
      fireAt: new Date(Date.now() - 1_000).toISOString(),
    })
    const b = await store.create({
      content: 'B',
      fireAt: new Date(Date.now() - 500).toISOString(),
    })
    expect(await store.markFired([a.id, b.id])).toBe(2)
    expect(store.listDue()).toHaveLength(0)
    expect(store.get(a.id)?.status).toBe('fired')
    expect(store.get(b.id)?.firedAt).toBeTruthy()
  })
})
