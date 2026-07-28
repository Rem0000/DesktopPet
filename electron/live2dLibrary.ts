import fs from 'node:fs'
import path from 'node:path'
import { resolveLayerPacksRoot } from './projectPaths'
import { pathToPetAssetUrl } from './petAssetProtocol'
import {
  findModelSettingsInDir,
  parseLive2DCatalog,
  type ImportedLive2DPackage,
  type Live2DRuntime,
} from './live2dBind'

/** 内置默认 Live2D 包（不可删除；启动/空库回退） */
export const DEFAULT_LIVE2D_PACKAGE_ID = 'import-2026-07-16T09-28-47-370Z'

export const PERSONA_FILENAME = 'persona.md'

export type Live2DLibraryItem = {
  id: string
  dir: string
  displayName: string
  model3Path: string | null
  modelUrl: string | null
  runtime: Live2DRuntime | null
  summary: string
  invalid: boolean
  isDefault: boolean
  error?: string
}

function live2dModelsRoot(): string {
  return path.join(resolveLayerPacksRoot(), 'live2d-models')
}

export function getDefaultLive2DPackageDir(): string {
  return path.join(live2dModelsRoot(), DEFAULT_LIVE2D_PACKAGE_ID)
}

export function isDefaultLive2DPackageId(id: string): boolean {
  return id === DEFAULT_LIVE2D_PACKAGE_ID
}

/** 从任意包内路径解析一层 import-* packageId */
export function resolvePackageIdFromDir(fileOrDir: string | null | undefined): string | null {
  if (!fileOrDir) return null
  const root = path.resolve(live2dModelsRoot())
  const target = path.resolve(fileOrDir)
  const rel = path.relative(root, target)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  const top = rel.split(/[/\\]/)[0]
  return top || null
}

function personaPathForPackage(packageId: string): string {
  return path.join(live2dModelsRoot(), packageId, PERSONA_FILENAME)
}

export function readPackagePersona(packageId: string): string {
  const file = personaPathForPackage(packageId)
  if (!fs.existsSync(file)) return ''
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

export function writePackagePersona(
  packageId: string,
  content: string,
): { ok: boolean; error?: string } {
  const root = path.resolve(live2dModelsRoot())
  const dir = path.resolve(path.join(live2dModelsRoot(), packageId))
  const rel = path.relative(root, dir)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.includes('..')) {
    return { ok: false, error: '包标识无效' }
  }
  if (!fs.existsSync(dir)) return { ok: false, error: '模型包不存在' }
  try {
    fs.writeFileSync(personaPathForPackage(packageId), content, 'utf8')
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function summarize(catalog: {
  runtime: Live2DRuntime
  textures: string[]
  motionGroups: { length: number }
  expressions: { length: number }
  voices?: string[]
  hasSound: boolean
}): string {
  const parts = [
    catalog.runtime === 'cubism2' ? 'Cubism2' : 'Cubism4',
    `贴图 ${catalog.textures.length}`,
    `动作组 ${catalog.motionGroups.length}`,
    `表情 ${catalog.expressions.length}`,
  ]
  if (catalog.voices?.length) parts.push(`语音 ${catalog.voices.length}`)
  else if (catalog.hasSound) parts.push('含声音')
  return parts.join(' · ')
}

/** 优先 model.json / model3.json 的 name 字段，其次文件名，最后目录 id */
function resolveDisplayName(settingsPath: string, fallbackId: string): string {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<
      string,
      unknown
    >
    const fromJson =
      (typeof raw.name === 'string' && raw.name.trim()) ||
      (typeof raw.Name === 'string' && raw.Name.trim()) ||
      ''
    if (fromJson) return fromJson
  } catch {
    /* ignore */
  }
  const base = path
    .basename(settingsPath)
    .replace(/\.model3\.json$/i, '')
    .replace(/\.model\.json$/i, '')
    .replace(/\.json$/i, '')
  if (base && !/^model$/i.test(base)) return base
  return fallbackId
}

/** 列出 live2d-models 下一层导入包 */
export function listImportedLive2DPackages(): Live2DLibraryItem[] {
  const root = live2dModelsRoot()
  if (!fs.existsSync(root)) return []

  const entries = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => {
      if (a === DEFAULT_LIVE2D_PACKAGE_ID) return -1
      if (b === DEFAULT_LIVE2D_PACKAGE_ID) return 1
      return b.localeCompare(a)
    })

  const items: Live2DLibraryItem[] = []
  for (const id of entries) {
    const dir = path.join(root, id)
    const isDefault = isDefaultLive2DPackageId(id)
    try {
      const model3Path = findModelSettingsInDir(dir)
      const catalog = parseLive2DCatalog(model3Path)
      items.push({
        id,
        dir,
        displayName: resolveDisplayName(model3Path, id),
        model3Path,
        modelUrl: pathToPetAssetUrl(model3Path),
        runtime: catalog.runtime,
        summary: summarize(catalog),
        invalid: false,
        isDefault,
      })
    } catch (err) {
      items.push({
        id,
        dir,
        displayName: id,
        model3Path: null,
        modelUrl: null,
        runtime: null,
        summary: '无法解析（可删除）',
        invalid: true,
        isDefault,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return items
}

export function deleteImportedLive2DPackage(dir: string): {
  ok: boolean
  error?: string
} {
  const packageId = resolvePackageIdFromDir(dir)
  if (packageId && isDefaultLive2DPackageId(packageId)) {
    return { ok: false, error: '默认模型不可删除' }
  }
  const root = path.resolve(live2dModelsRoot())
  const target = path.resolve(dir)
  const rel = path.relative(root, target)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, error: '路径不在导入目录内' }
  }
  if (rel.includes(path.sep) || rel.includes('/')) {
    return { ok: false, error: '只能删除导入包根目录' }
  }
  if (!fs.existsSync(target)) return { ok: true }
  try {
    fs.rmSync(target, { recursive: true, force: true })
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** 将已导入包转为可应用的 session 载荷 */
export function packageFromImportDir(
  dir: string,
): ImportedLive2DPackage | null {
  const root = path.resolve(live2dModelsRoot())
  const target = path.resolve(dir)
  const rel = path.relative(root, target)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  if (!fs.existsSync(target)) return null
  try {
    const model3Path = findModelSettingsInDir(target)
    const catalog = parseLive2DCatalog(model3Path)
    return {
      model3Path,
      modelUrl: pathToPetAssetUrl(model3Path),
      dir: path.dirname(model3Path),
      catalog,
      runtime: catalog.runtime,
    }
  } catch {
    return null
  }
}

export function packageFromPackageId(packageId: string): ImportedLive2DPackage | null {
  return packageFromImportDir(path.join(live2dModelsRoot(), packageId))
}

export function isPathUnderImportDir(
  filePath: string | undefined,
  importDir: string,
): boolean {
  if (!filePath) return false
  const root = path.resolve(importDir)
  const p = path.resolve(filePath)
  const rel = path.relative(root, p)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}
