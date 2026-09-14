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

/** 链路追踪数据目录：sessions（会话事件流）/ blobs（外置原文）/ legacy（旧日报只读保留） */
export type TraceDirPaths = {
  root: string
  sessions: string
  blobs: string
  legacy: string
}

export function resolveTracePaths(): TraceDirPaths {
  const root = resolveDataSubpath('traces')
  return {
    root,
    sessions: path.join(root, 'sessions'),
    blobs: path.join(root, 'blobs'),
    legacy: path.join(root, 'legacy'),
  }
}

/**
 * 把任意字符串编码为单个安全路径段：安全码元保持字面，其余（含 `~`、分隔符、`.`/`..`）
 * 转义为 `~XXXX`。会话 id 来自渲染进程输入，落盘前 MUST 经过本函数，避免路径穿越。
 */
export function encodeTraceSegment(raw: string): string {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
    else out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
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

/** 确保数据子目录存在（含链路追踪的 sessions/blobs/legacy） */
export async function ensureDataDirs(): Promise<void> {
  const { mkdir } = await import('node:fs/promises')
  const trace = resolveTracePaths()
  await Promise.all([
    ...ALL_SUBPATHS.map((subpath) =>
      mkdir(resolveDataSubpath(subpath), { recursive: true }),
    ),
    mkdir(trace.sessions, { recursive: true }),
    mkdir(trace.blobs, { recursive: true }),
    mkdir(trace.legacy, { recursive: true }),
  ])
}
