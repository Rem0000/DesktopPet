import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  CONTEXT_BUDGET_MAX,
  DEFAULT_CONTEXT_BUDGET,
  loadContextConfig,
  saveContextConfig,
} from './contextConfig'

async function tempDirectory(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'context-config-'))
}

describe('loadContextConfig', () => {
  it('配置缺失时回退默认预算并采用默认裁剪选项', async () => {
    const directory = await tempDirectory()
    try {
      const config = await loadContextConfig(directory)
      expect(config.budgetCharacters).toBe(DEFAULT_CONTEXT_BUDGET)
      expect(config.importanceTrim).toBe(true)
      expect(config.recentWindowChars).toBe(Math.floor(DEFAULT_CONTEXT_BUDGET * 0.7))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('读取合法配置的 budgetCharacters 与自定义裁剪选项', async () => {
    const directory = await tempDirectory()
    try {
      await writeFile(
        path.join(directory, 'context-config.json'),
        JSON.stringify({ version: 1, budgetCharacters: 52_000, importanceTrim: false, recentWindowChars: 30_000 }),
      )
      const config = await loadContextConfig(directory)
      expect(config.budgetCharacters).toBe(52_000)
      expect(config.importanceTrim).toBe(false)
      expect(config.recentWindowChars).toBe(30_000)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('超出允许范围的预算回退默认', async () => {
    const directory = await tempDirectory()
    try {
      await writeFile(
        path.join(directory, 'context-config.json'),
        JSON.stringify({ version: 1, budgetCharacters: CONTEXT_BUDGET_MAX + 1 }),
      )
      expect((await loadContextConfig(directory)).budgetCharacters).toBe(DEFAULT_CONTEXT_BUDGET)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('格式非法（非 JSON）回退默认', async () => {
    const directory = await tempDirectory()
    try {
      await writeFile(path.join(directory, 'context-config.json'), 'not-json')
      expect((await loadContextConfig(directory)).budgetCharacters).toBe(DEFAULT_CONTEXT_BUDGET)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('version 非法回退默认', async () => {
    const directory = await tempDirectory()
    try {
      await writeFile(
        path.join(directory, 'context-config.json'),
        JSON.stringify({ version: 2, budgetCharacters: 30_000 }),
      )
      expect((await loadContextConfig(directory)).budgetCharacters).toBe(DEFAULT_CONTEXT_BUDGET)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('saveContextConfig', () => {
  it('写入后再次读取可还原 budget（含非法值回退默认）', async () => {
    const directory = await tempDirectory()
    try {
      await saveContextConfig(directory, 30_000)
      const written = JSON.parse(
        await readFile(path.join(directory, 'context-config.json'), 'utf8'),
      ) as { version: number; budgetCharacters: number }
      expect(written).toEqual({ version: 1, budgetCharacters: 30_000 })

      await saveContextConfig(directory, 999_999)
      const writtenInvalid = JSON.parse(
        await readFile(path.join(directory, 'context-config.json'), 'utf8'),
      ) as { version: number; budgetCharacters: number }
      // 非法值写入时回退默认，load 仍会执行同样的回退
      expect(writtenInvalid.budgetCharacters).toBe(DEFAULT_CONTEXT_BUDGET)
      expect((await loadContextConfig(directory)).budgetCharacters).toBe(DEFAULT_CONTEXT_BUDGET)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
