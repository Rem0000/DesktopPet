import fs from 'node:fs'
import path from 'node:path'
import { resolveLayerPacksRoot } from './projectPaths'
import { pathToPetAssetUrl } from './petAssetProtocol'

export type Live2DRuntime = 'cubism2' | 'cubism4'

export type Live2DMotionGroupInfo = {
  name: string
  count: number
  /** 该组是否有任意条目带 Sound */
  hasSound: boolean
  /** 空组名展开时的动作文件名（如 complete / touch_head），语义组名时缺省 */
  displayName?: string
  /** 空组名展开时在组内的索引，用于精确定位播放 */
  index?: number
  /** true 表示 name 为空串、按单个动作展开的条目 */
  expanded?: boolean
}

export type Live2DCatalog = {
  textures: string[]
  motionGroups: Live2DMotionGroupInfo[]
  expressions: string[]
  voices: string[]
  hasPhysics: boolean
  hasPose: boolean
  hasSound: boolean
  missing: string[]
  runtime: Live2DRuntime
}

export type ImportedLive2DPackage = {
  model3Path: string
  modelUrl: string
  dir: string
  catalog: Live2DCatalog
  runtime: Live2DRuntime
}

/** Cubism 4 model3.json */
type Model3Json = {
  FileReferences?: {
    Moc?: string
    Textures?: string[]
    Physics?: string
    Pose?: string
    DisplayInfo?: string
    Expressions?: Array<{ Name?: string; File?: string }>
    Motions?: Record<
      string,
      Array<{ File?: string; Sound?: string; sound?: string; FadeInTime?: number; FadeOutTime?: number }>
    >
  }
}

/** Cubism 2 model.json（字段因模型而异） */
type Model2Json = {
  model?: string
  textures?: string[]
  physics?: string
  pose?: string
  expressions?: Array<{ name?: string; file?: string }>
  motions?: Record<
    string,
    Array<{ file?: string; sound?: string; File?: string; Sound?: string }>
  >
}

const VOICE_DIRS = ['voice', 'voices', 'sounds']

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(from, to)
    else fs.copyFileSync(from, to)
  }
}

export function detectRuntime(settingsPath: string): Live2DRuntime {
  const name = path.basename(settingsPath).toLowerCase()
  if (name.endsWith('.model3.json')) return 'cubism4'
  if (name === 'model.json' || name.endsWith('.model.json')) return 'cubism2'
  // 内容启发式
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<
      string,
      unknown
    >
    if (raw.FileReferences) return 'cubism4'
    if (typeof raw.model === 'string' || Array.isArray(raw.textures)) return 'cubism2'
  } catch {
    /* ignore */
  }
  return 'cubism4'
}

function findCubism4InDir(dir: string): string | null {
  const direct = ['Haru.model3.json', 'model3.json', 'model.model3.json']
  for (const name of direct) {
    const p = path.join(dir, name)
    if (fs.existsSync(p)) return p
  }
  const found = fs
    .readdirSync(dir)
    .find((f) => f.toLowerCase().endsWith('.model3.json'))
  if (found) return path.join(dir, found)
  return null
}

function findCubism2InDir(dir: string): string | null {
  const direct = ['model.json']
  for (const name of direct) {
    const p = path.join(dir, name)
    if (fs.existsSync(p)) return p
  }
  const found = fs
    .readdirSync(dir)
    .find((f) => f.toLowerCase().endsWith('.model.json'))
  if (found) return path.join(dir, found)
  return null
}

/** 优先 Cubism4，其次 Cubism2；浅层递归子目录 */
export function findModelSettingsInDir(dir: string): string {
  const c4 = findCubism4InDir(dir)
  if (c4) return c4
  const c2 = findCubism2InDir(dir)
  if (c2) return c2

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const nested = path.join(dir, entry.name)
    try {
      return findModelSettingsInDir(nested)
    } catch {
      /* continue */
    }
  }
  throw new Error(`目录内没有 model3.json / model.json：${dir}`)
}

function resolveRel(modelDir: string, rel: string): string {
  return path.normalize(path.join(modelDir, rel))
}

function toPosixRel(modelDir: string, abs: string): string {
  return path.relative(modelDir, abs).split(path.sep).join('/')
}

function scanVoiceWavs(modelDir: string): string[] {
  const out: string[] = []
  for (const name of VOICE_DIRS) {
    const root = path.join(modelDir, name)
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) continue
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.wav$/i.test(entry.name)) out.push(toPosixRel(modelDir, full))
      }
    }
    walk(root)
  }
  return out
}

function parseCubism4Catalog(modelPath: string): Live2DCatalog {
  const modelDir = path.dirname(modelPath)
  const raw = JSON.parse(fs.readFileSync(modelPath, 'utf8')) as Model3Json
  const refs = raw.FileReferences ?? {}
  const missing: string[] = []

  const check = (rel?: string) => {
    if (!rel) return
    if (!fs.existsSync(resolveRel(modelDir, rel))) missing.push(rel)
  }

  check(refs.Moc)
  const textures = refs.Textures ?? []
  for (const t of textures) check(t)
  if (refs.Physics) check(refs.Physics)
  if (refs.Pose) check(refs.Pose)
  if (refs.DisplayInfo) check(refs.DisplayInfo)

  const expressions: string[] = []
  for (const exp of refs.Expressions ?? []) {
    if (exp.File) check(exp.File)
    if (exp.Name) expressions.push(exp.Name)
    else if (exp.File)
      expressions.push(path.basename(exp.File, path.extname(exp.File)))
  }

  const motionGroups: Live2DMotionGroupInfo[] = []
  let hasSound = false
  const motionSounds: string[] = []
  const motions = refs.Motions ?? {}
  for (const [name, list] of Object.entries(motions)) {
    let groupHasSound = false
    const entries = list ?? []
    for (const item of entries) {
      const sound = item.Sound ?? item.sound
      if (item.File) check(item.File)
      if (sound) {
        check(sound)
        groupHasSound = true
        hasSound = true
        motionSounds.push(sound.replace(/\\/g, '/'))
      }
    }
    if (name === '' && entries.length > 0) {
      // 空组名：如碧蓝航线提取包，全部动作挤在一个 "" 组下。
      // 逐个动作展开成独立条目，便于在菜单里单独播放。
      for (const [i, item] of entries.entries()) {
        const displayName = item.File
          ? path.basename(item.File, path.extname(item.File))
          : `${i}`
        motionGroups.push({
          name: '',
          count: 1,
          hasSound: Boolean(item.Sound ?? item.sound),
          displayName,
          index: i,
          expanded: true,
        })
      }
      continue
    }
    motionGroups.push({
      name,
      count: entries.length,
      hasSound: groupHasSound,
    })
  }

  const scanned = scanVoiceWavs(modelDir)
  if (scanned.length) hasSound = true
  const voices = Array.from(new Set([...motionSounds, ...scanned]))

  return {
    textures,
    motionGroups,
    expressions,
    voices,
    hasPhysics: Boolean(refs.Physics),
    hasPose: Boolean(refs.Pose),
    hasSound,
    missing,
    runtime: 'cubism4',
  }
}

function parseCubism2Catalog(modelPath: string): Live2DCatalog {
  const modelDir = path.dirname(modelPath)
  const raw = JSON.parse(fs.readFileSync(modelPath, 'utf8')) as Model2Json
  const missing: string[] = []

  const check = (rel?: string) => {
    if (!rel) return
    if (!fs.existsSync(resolveRel(modelDir, rel))) missing.push(rel)
  }

  const moc = raw.model
  check(moc)
  const textures = raw.textures ?? []
  for (const t of textures) check(t)
  if (raw.physics) check(raw.physics)
  if (raw.pose) check(raw.pose)

  const expressions: string[] = []
  for (const exp of raw.expressions ?? []) {
    if (exp.file) check(exp.file)
    if (exp.name) expressions.push(exp.name)
    else if (exp.file)
      expressions.push(path.basename(exp.file, path.extname(exp.file)))
  }

  const motionGroups: Live2DMotionGroupInfo[] = []
  let hasSound = false
  const motionSounds: string[] = []
  const motions = raw.motions ?? {}
  for (const [name, list] of Object.entries(motions)) {
    let groupHasSound = false
    const entries = list ?? []
    for (const item of entries) {
      const file = item.file ?? item.File
      const sound = item.sound ?? item.Sound
      if (file) check(file)
      if (sound) {
        check(sound)
        groupHasSound = true
        hasSound = true
        motionSounds.push(sound.replace(/\\/g, '/'))
      }
    }
    if (name === '' && entries.length > 0) {
      for (const [i, item] of entries.entries()) {
        const file = item.file ?? item.File
        const sound = item.sound ?? item.Sound
        const displayName = file
          ? path.basename(file, path.extname(file))
          : `${i}`
        motionGroups.push({
          name: '',
          count: 1,
          hasSound: Boolean(sound),
          displayName,
          index: i,
          expanded: true,
        })
      }
      continue
    }
    motionGroups.push({
      name,
      count: entries.length,
      hasSound: groupHasSound,
    })
  }

  const scanned = scanVoiceWavs(modelDir)
  if (scanned.length) hasSound = true
  const voices = Array.from(new Set([...motionSounds, ...scanned]))

  return {
    textures,
    motionGroups,
    expressions,
    voices,
    hasPhysics: Boolean(raw.physics),
    hasPose: Boolean(raw.pose),
    hasSound,
    missing,
    runtime: 'cubism2',
  }
}

export function parseLive2DCatalog(modelSettingsPath: string): Live2DCatalog {
  const runtime = detectRuntime(modelSettingsPath)
  return runtime === 'cubism2'
    ? parseCubism2Catalog(modelSettingsPath)
    : parseCubism4Catalog(modelSettingsPath)
}

function assertEssentialFiles(catalog: Live2DCatalog) {
  if (catalog.textures.length === 0) {
    throw new Error('模型未声明贴图，请检查是否为完整 Live2D 模型包。')
  }
  const mocRe = catalog.runtime === 'cubism2' ? /\.moc$/i : /\.moc3$/i
  const missingEssential = catalog.missing.filter(
    (f) => catalog.textures.includes(f) || mocRe.test(f),
  )
  if (missingEssential.length === 0) return

  const preview = missingEssential.slice(0, 5).join(', ')
  const more =
    missingEssential.length > 5 ? ` 等 ${missingEssential.length} 个` : ''
  const hint =
    catalog.runtime === 'cubism2'
      ? '请导入包含 .moc 与贴图的完整 Cubism 2 包。'
      : '请导入包含 .moc3 与贴图文件夹的完整 Cubism 4 包。'
  throw new Error(`模型包不完整，缺少必要文件：${preview}${more}。${hint}`)
}

/**
 * 导入完整 Live2D 模型包：复制所在目录（含贴图/动作/声音等），再解析清单。
 * `pickedPath` 可以是 model3.json / model.json，也可以是包含模型的文件夹。
 */
export async function importLive2DPackage(
  pickedPath: string,
): Promise<ImportedLive2DPackage> {
  if (!fs.existsSync(pickedPath)) throw new Error('路径不存在')

  const stat = fs.statSync(pickedPath)
  let sourceSettings: string
  let sourceDir: string

  if (stat.isDirectory()) {
    sourceDir = pickedPath
    sourceSettings = findModelSettingsInDir(pickedPath)
  } else {
    sourceSettings = pickedPath
    sourceDir = path.dirname(sourceSettings)
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outRoot = path.join(resolveLayerPacksRoot(), 'live2d-models')
  const outDir = path.join(outRoot, `import-${stamp}`)
  copyDir(sourceDir, outDir)

  const relModel = path.relative(sourceDir, sourceSettings)
  let modelPath = path.join(outDir, relModel)
  if (!fs.existsSync(modelPath)) {
    modelPath = findModelSettingsInDir(outDir)
  }

  const catalog = parseLive2DCatalog(modelPath)
  assertEssentialFiles(catalog)
  return {
    model3Path: modelPath,
    modelUrl: pathToPetAssetUrl(modelPath),
    dir: path.dirname(modelPath),
    catalog,
    runtime: catalog.runtime,
  }
}

/** 校验已保存 session 的磁盘路径，并重算 pet-asset URL */
export function refreshLive2DSessionPaths(input: {
  model3Path: string
  outDir?: string
}): ImportedLive2DPackage | null {
  const modelPath = input.model3Path
  if (!modelPath || !fs.existsSync(modelPath)) return null
  try {
    const catalog = parseLive2DCatalog(modelPath)
    assertEssentialFiles(catalog)
    return {
      model3Path: modelPath,
      modelUrl: pathToPetAssetUrl(modelPath),
      dir: path.dirname(modelPath),
      catalog,
      runtime: catalog.runtime,
    }
  } catch {
    return null
  }
}

/** @deprecated 保留旧名；等价于 importLive2DPackage */
export async function resolveModel3FromDialogPath(
  model3Path: string,
): Promise<ImportedLive2DPackage> {
  return importLive2DPackage(model3Path)
}
