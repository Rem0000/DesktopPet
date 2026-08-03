import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** 默认上下文预算（字符）；仍远小于 DeepSeek 64k token 上限 */
export const DEFAULT_CONTEXT_BUDGET = 40_000
export const CONTEXT_BUDGET_MIN = 16_000
export const CONTEXT_BUDGET_MAX = 64_000

const FILE_NAME = 'context-config.json'

export type ContextConfigFile = {
  version: 1
  budgetCharacters?: number
}

function isConfigFile(value: unknown): value is ContextConfigFile {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ContextConfigFile>
  return candidate.version === 1
}

function sanitizeBudget(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const rounded = Math.round(value)
  if (rounded < CONTEXT_BUDGET_MIN || rounded > CONTEXT_BUDGET_MAX) return undefined
  return rounded
}

/** 读取上下文配置；缺失/非法一律回退默认预算，绝不中断聊天 */
export async function loadContextConfig(
  storageDirectory: string,
): Promise<{ budgetCharacters: number }> {
  const filePath = path.join(storageDirectory, FILE_NAME)
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!isConfigFile(parsed)) return { budgetCharacters: DEFAULT_CONTEXT_BUDGET }
    const budget = sanitizeBudget(parsed.budgetCharacters)
    return { budgetCharacters: budget ?? DEFAULT_CONTEXT_BUDGET }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { budgetCharacters: DEFAULT_CONTEXT_BUDGET }
    // 解析失败也回退默认，不抛出
    return { budgetCharacters: DEFAULT_CONTEXT_BUDGET }
  }
}

export async function saveContextConfig(
  storageDirectory: string,
  budgetCharacters: number,
): Promise<void> {
  const filePath = path.join(storageDirectory, FILE_NAME)
  await mkdir(path.dirname(filePath), { recursive: true })
  const payload: ContextConfigFile = {
    version: 1,
    budgetCharacters: sanitizeBudget(budgetCharacters) ?? DEFAULT_CONTEXT_BUDGET,
  }
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}
