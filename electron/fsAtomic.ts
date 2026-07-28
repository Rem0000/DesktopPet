import { copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const MAX_RETRIES = 5
const RETRY_DELAY_MS = 50

function isTransientLockError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 原子写入文本文件。Windows 上 rename 覆盖可能被占用文件时会 EPERM，
 * 此时退化为 copyFile 覆盖并清理临时文件。
 */
export async function atomicWriteTextFile(
  filePath: string,
  content: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })

  let lastError: unknown
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${attempt}.tmp`
    try {
      await writeFile(tempPath, content, 'utf8')
      try {
        await rename(tempPath, filePath)
      } catch (error) {
        if (!isTransientLockError(error)) throw error
        await copyFile(tempPath, filePath)
        await rm(tempPath, { force: true })
      }
      return
    } catch (error) {
      lastError = error
      await rm(tempPath, { force: true }).catch(() => undefined)
      if (!isTransientLockError(error) || attempt === MAX_RETRIES - 1) {
        throw error
      }
      await sleep(RETRY_DELAY_MS * (attempt + 1))
    }
  }

  throw lastError instanceof Error ? lastError : new Error('原子写入失败')
}
