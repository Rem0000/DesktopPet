import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { ToolTraceRecord, ToolTraceStats } from '../../src/chat/contracts'

function dayKey(iso = new Date().toISOString()): string {
  return iso.slice(0, 10)
}

function parseRecord(line: string): ToolTraceRecord | null {
  try {
    const value = JSON.parse(line) as Partial<ToolTraceRecord>
    if (
      typeof value.requestId !== 'string' ||
      typeof value.sessionId !== 'string' ||
      typeof value.toolName !== 'string' ||
      typeof value.startedAt !== 'string' ||
      typeof value.endedAt !== 'string' ||
      typeof value.ok !== 'boolean' ||
      typeof value.latencyMs !== 'number'
    ) {
      return null
    }
    return value as ToolTraceRecord
  } catch {
    return null
  }
}

export class ToolTraceStore {
  private readonly dir: string
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(storageDirectory: string) {
    this.dir = storageDirectory
  }

  async initialize(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
  }

  async append(record: ToolTraceRecord): Promise<void> {
    const filePath = path.join(this.dir, `${dayKey(record.startedAt)}.jsonl`)
    const line = `${JSON.stringify(record)}\n`
    const operation = this.writeQueue.then(async () => {
      await mkdir(this.dir, { recursive: true })
      const { appendFile } = await import('node:fs/promises')
      await appendFile(filePath, line, 'utf8')
    })
    this.writeQueue = operation.catch(() => undefined)
    await operation
  }

  async listBySession(sessionId: string): Promise<ToolTraceRecord[]> {
    const { readdir, readFile } = await import('node:fs/promises')
    let names: string[] = []
    try {
      names = (await readdir(this.dir)).filter((name) => name.endsWith('.jsonl'))
    } catch {
      return []
    }
    const records: ToolTraceRecord[] = []
    for (const name of names.sort()) {
      const raw = await readFile(path.join(this.dir, name), 'utf8')
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        const record = parseRecord(line)
        if (record && record.sessionId === sessionId) records.push(record)
      }
    }
    return records
  }

  async summarize(): Promise<ToolTraceStats[]> {
    const { readdir, readFile } = await import('node:fs/promises')
    let names: string[] = []
    try {
      names = (await readdir(this.dir)).filter((name) => name.endsWith('.jsonl'))
    } catch {
      return []
    }
    const buckets = new Map<string, { calls: number; successes: number; totalLatency: number }>()
    for (const name of names) {
      const raw = await readFile(path.join(this.dir, name), 'utf8')
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        const record = parseRecord(line)
        if (!record) continue
        const bucket = buckets.get(record.toolName) ?? {
          calls: 0,
          successes: 0,
          totalLatency: 0,
        }
        bucket.calls += 1
        if (record.ok) bucket.successes += 1
        bucket.totalLatency += record.latencyMs
        buckets.set(record.toolName, bucket)
      }
    }
    return [...buckets.entries()]
      .map(([toolName, bucket]) => ({
        toolName,
        calls: bucket.calls,
        successes: bucket.successes,
        avgLatencyMs:
          bucket.calls === 0 ? 0 : Math.round(bucket.totalLatency / bucket.calls),
      }))
      .sort((a, b) => b.calls - a.calls)
  }
}
