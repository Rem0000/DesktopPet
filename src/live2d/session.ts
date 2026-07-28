export type Live2DRuntime = 'cubism2' | 'cubism4'

export type Live2DMotionGroupInfo = {
  name: string
  count: number
  hasSound: boolean
}

export type Live2DCatalog = {
  textures: string[]
  motionGroups: Live2DMotionGroupInfo[]
  expressions: string[]
  voices?: string[]
  hasPhysics: boolean
  hasPose: boolean
  hasSound: boolean
  missing: string[]
  runtime?: Live2DRuntime
}

export type Live2DSession = {
  modelUrl: string
  model3Path: string
  outDir?: string
  packageId?: string
  source: 'imported' | 'template-raw'
  catalog?: Live2DCatalog
  runtime?: Live2DRuntime
}

const KEY = 'desktop-pet-live2d-session'

export function loadLive2DSession(): Live2DSession | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    return JSON.parse(raw) as Live2DSession
  } catch {
    return null
  }
}

export function saveLive2DSession(session: Live2DSession | null) {
  if (!session) {
    localStorage.removeItem(KEY)
    return
  }
  localStorage.setItem(KEY, JSON.stringify(session))
}

export function summarizeCatalog(catalog?: Live2DCatalog): string {
  if (!catalog) return ''
  const parts = [
    catalog.runtime === 'cubism2' ? 'Cubism2' : 'Cubism4',
    `贴图 ${catalog.textures.length}`,
    `动作组 ${catalog.motionGroups.length}`,
    `表情 ${catalog.expressions.length}`,
  ]
  if (catalog.voices?.length) parts.push(`语音 ${catalog.voices.length}`)
  else if (catalog.hasSound) parts.push('含声音')
  if (catalog.hasPhysics) parts.push('物理')
  if (catalog.missing.length) parts.push(`缺 ${catalog.missing.length} 个文件`)
  return parts.join(' · ')
}
