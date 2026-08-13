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

/**
 * 技能目录根：开发态为项目根 skills/，打包态为 resources/skills/（extraResources）。
 * 技能随版本控制并打进安装包，与 live2d 资源一致。
 */
export function resolveSkillsRoot(): string {
  if (process.env.DESKTOP_PET_SKILLS) return process.env.DESKTOP_PET_SKILLS
  try {
    if (app.isPackaged && process.resourcesPath) {
      return path.join(process.resourcesPath, 'skills')
    }
  } catch {
    // vitest 等无 Electron 运行时
  }
  return path.join(resolveProjectRoot(), 'skills')
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
