import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TRACE_CONFIG } from '../../src/trace/contracts'
import { loadTraceConfig } from './traceConfig'

async function tempConfigDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'pet-trace-config-'))
}

describe('loadTraceConfig', () => {
  it('缺失配置时回退默认', async () => {
    const dir = await tempConfigDir()
    await expect(loadTraceConfig(dir)).resolves.toEqual(DEFAULT_TRACE_CONFIG)
  })

  it('合法字段覆盖默认', async () => {
    const dir = await tempConfigDir()
    await writeFile(
      path.join(dir, 'trace-config.json'),
      JSON.stringify({
        version: 1,
        level: 'meta',
        maxFieldChars: 800,
        fsync: 'turn',
        retentionDays: 7,
        maxSessions: 10,
        maxFileMB: 4,
      }),
      'utf8',
    )
    await expect(loadTraceConfig(dir)).resolves.toEqual({
      version: 1,
      enabled: true,
      level: 'meta',
      maxFieldChars: 800,
      fsync: 'turn',
      retentionDays: 7,
      maxSessions: 10,
      maxFileMB: 4,
    })
  })

  it('非法字段逐项回退默认，不整体失效', async () => {
    const dir = await tempConfigDir()
    await writeFile(
      path.join(dir, 'trace-config.json'),
      JSON.stringify({
        version: 1,
        level: 'weird',
        maxFieldChars: 5,
        fsync: 'always',
        retentionDays: -1,
        maxSessions: 0,
        maxFileMB: 99999,
      }),
      'utf8',
    )
    await expect(loadTraceConfig(dir)).resolves.toEqual(DEFAULT_TRACE_CONFIG)
  })

  it('level=off 归一为停写', async () => {
    const dir = await tempConfigDir()
    await writeFile(
      path.join(dir, 'trace-config.json'),
      JSON.stringify({ version: 1, level: 'off', enabled: true }),
      'utf8',
    )
    const config = await loadTraceConfig(dir)
    expect(config.enabled).toBe(false)
    expect(config.level).toBe('off')
  })

  it('版本不符或非 JSON 时回退默认', async () => {
    const dir = await tempConfigDir()
    await writeFile(
      path.join(dir, 'trace-config.json'),
      JSON.stringify({ version: 2, level: 'meta' }),
      'utf8',
    )
    await expect(loadTraceConfig(dir)).resolves.toEqual(DEFAULT_TRACE_CONFIG)

    await writeFile(path.join(dir, 'trace-config.json'), '{not json', 'utf8')
    await expect(loadTraceConfig(dir)).resolves.toEqual(DEFAULT_TRACE_CONFIG)
  })
})
