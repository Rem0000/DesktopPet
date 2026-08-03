import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

/** 解析仓库根目录（含 package.json） */
export function resolveProjectRoot(): string {
  const candidates = [process.cwd(), path.join(__dirname, '..')]
  try {
    if (typeof app?.getAppPath === 'function') {
      candidates.push(app.getAppPath())
    }
  } catch {
    // vitest 等无 Electron 运行时
  }
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir
    }
  }
  return process.cwd()
}

/** Live2D 导入包存放目录 */
export function resolveLayerPacksRoot(): string {
  return (
    process.env.DESKTOP_PET_LAYER_PACKS ||
    path.join(resolveProjectRoot(), 'layer-packs')
  )
}

export type DataSubpath =
  | 'chat'
  | 'memory'
  | 'knowledge'
  | 'traces'
  | 'logs'
  | 'models'
  | 'reminders'
  | 'config'
  | 'novels'
  | 'relationships'

/** 运行时持久化数据根目录（默认 <projectRoot>/data/） */
export function resolveDataRoot(): string {
  if (process.env.DESKTOP_PET_USE_USER_DATA === '1') {
    try {
      return app.getPath('userData')
    } catch {
      return path.join(resolveProjectRoot(), 'data')
    }
  }
  return process.env.DESKTOP_PET_DATA || path.join(resolveProjectRoot(), 'data')
}

/** 数据根目录下的子路径 */
export function resolveDataSubpath(subpath: DataSubpath): string {
  return path.join(resolveDataRoot(), subpath)
}

const ALL_SUBPATHS: DataSubpath[] = [
  'chat',
  'memory',
  'knowledge',
  'traces',
  'logs',
  'models',
  'reminders',
  'config',
  'novels',
  'relationships',
]

/** 确保数据子目录存在 */
export async function ensureDataDirs(): Promise<void> {
  const { mkdir } = await import('node:fs/promises')
  await Promise.all(
    ALL_SUBPATHS.map((subpath) =>
      mkdir(resolveDataSubpath(subpath), { recursive: true }),
    ),
  )
}
