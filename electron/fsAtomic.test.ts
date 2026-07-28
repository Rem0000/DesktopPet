import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { atomicWriteTextFile } from './fsAtomic'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('atomicWriteTextFile', () => {
  it('写入并读取 JSON 文件', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pet-atomic-'))
    directories.push(directory)
    const filePath = path.join(directory, 'chat-data.json')
    await atomicWriteTextFile(filePath, JSON.stringify({ ok: true }))
    const raw = await readFile(filePath, 'utf8')
    expect(JSON.parse(raw)).toEqual({ ok: true })
  })

  it('可覆盖已有文件', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pet-atomic-overwrite-'))
    directories.push(directory)
    const filePath = path.join(directory, 'chat-data.json')
    await writeFile(filePath, '{"before":true}', 'utf8')
    await atomicWriteTextFile(filePath, JSON.stringify({ after: true }))
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({ after: true })
  })
})
