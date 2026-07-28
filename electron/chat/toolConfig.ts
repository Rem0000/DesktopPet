import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { ToolConfigFile, ToolConfigOverride } from '../../src/chat/contracts'
import type { ToolConfigOverrides } from './toolRegistry'

const FILE_NAME = 'tool-config.json'

function isConfigFile(value: unknown): value is ToolConfigFile {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ToolConfigFile>
  return candidate.version === 1 && Boolean(candidate.tools) && typeof candidate.tools === 'object'
}

export async function loadToolConfigOverrides(
  storageDirectory: string,
): Promise<ToolConfigOverrides> {
  const filePath = path.join(storageDirectory, FILE_NAME)
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!isConfigFile(parsed)) return {}
    const overrides: ToolConfigOverrides = {}
    for (const [name, entry] of Object.entries(parsed.tools)) {
      if (!entry || typeof entry !== 'object') continue
      const patch: ToolConfigOverride = {}
      if (typeof entry.enabled === 'boolean') patch.enabled = entry.enabled
      if (Object.keys(patch).length > 0) overrides[name] = patch
    }
    return overrides
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return {}
    throw error
  }
}

export async function saveToolConfigOverrides(
  storageDirectory: string,
  overrides: ToolConfigOverrides,
): Promise<void> {
  const filePath = path.join(storageDirectory, FILE_NAME)
  await mkdir(path.dirname(filePath), { recursive: true })
  const payload: ToolConfigFile = { version: 1, tools: overrides }
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}
