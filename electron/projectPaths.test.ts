import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

describe('projectPaths novels subdir', () => {
  const previous = process.env.DESKTOP_PET_DATA
  let tempRoot = ''

  afterEach(async () => {
    if (previous === undefined) delete process.env.DESKTOP_PET_DATA
    else process.env.DESKTOP_PET_DATA = previous
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
  })

  it('ensureDataDirs creates novels/', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'pet-data-'))
    process.env.DESKTOP_PET_DATA = tempRoot
    const { ensureDataDirs, resolveDataSubpath } = await import('./projectPaths')
    await ensureDataDirs()
    const novelsDir = resolveDataSubpath('novels')
    expect(novelsDir).toBe(path.join(tempRoot, 'novels'))
    await mkdir(novelsDir, { recursive: true })
    const { access } = await import('node:fs/promises')
    await expect(access(novelsDir)).resolves.toBeUndefined()
  })
})
