import fs from 'node:fs'
import path from 'node:path'
import { protocol } from 'electron'
import { resolveLayerPacksRoot, resolveProjectRoot } from './projectPaths'

export const PET_ASSET_SCHEME = 'pet-asset'
/** 固定 host，盘符只放在 pathname 里（/D/...），避免 D: 被 Chromium 当成 hostname */
const PET_ASSET_HOST = 'abs'

const MIME: Record<string, string> = {
  '.json': 'application/json',
  '.moc3': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
}

/** Windows 绝对路径 → URL pathname（不含冒号，如 /D/ProjectWork/...） */
function toUrlPathname(absPath: string): string {
  const normalized = path.normalize(absPath).replace(/\\/g, '/')
  if (/^[A-Za-z]:/.test(normalized)) {
    const drive = normalized[0].toUpperCase()
    const rest = normalized.slice(2)
    return `/${drive}${rest}`
  }
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

/** URL pathname → Windows/posix 绝对路径 */
function fromUrlPathname(pathname: string): string {
  let p = decodeURIComponent(pathname)
  if (/^\/[A-Za-z]\//.test(p)) {
    return path.normalize(`${p[1].toUpperCase()}:${p.slice(2)}`)
  }
  if (/^\/[A-Za-z]:/.test(p)) {
    return path.normalize(p.slice(1))
  }
  return path.normalize(p)
}

/** 将本地绝对路径转为渲染进程可加载的 URL */
export function pathToPetAssetUrl(absPath: string): string {
  return `${PET_ASSET_SCHEME}://${PET_ASSET_HOST}${toUrlPathname(absPath)}`
}

export function petAssetUrlToPath(urlStr: string): string | null {
  try {
    const u = new URL(urlStr)
    if (u.protocol !== `${PET_ASSET_SCHEME}:`) return null

    if (!u.hostname || u.hostname === PET_ASSET_HOST) {
      return fromUrlPathname(u.pathname)
    }

    // 兼容 Chromium 把 pet-asset://D:/... 误解析为 host=d 的旧 URL
    if (/^[a-z]$/i.test(u.hostname)) {
      return path.normalize(`${u.hostname.toUpperCase()}:${u.pathname}`)
    }

    return null
  } catch {
    return null
  }
}

function allowedRoots(): string[] {
  return [
    resolveLayerPacksRoot(),
    path.join(resolveProjectRoot(), 'assets'),
  ].map((r) => path.resolve(r))
}

function isPathAllowed(filePath: string): boolean {
  const norm = path.resolve(filePath)
  return allowedRoots().some((root) => {
    const rel = path.relative(root, norm)
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  })
}

/** 须在 app.ready 之前调用 */
export function registerPetAssetScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PET_ASSET_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        bypassCSP: true,
      },
    },
  ])
}

/** 须在 app.ready 之后调用 */
export function installPetAssetHandler() {
  protocol.handle(PET_ASSET_SCHEME, async (request) => {
    const filePath = petAssetUrlToPath(request.url)
    if (!filePath) {
      console.error('[pet-asset] bad url', request.url)
      return new Response('Bad Request', { status: 400 })
    }
    if (!isPathAllowed(filePath)) {
      console.error('[pet-asset] forbidden', filePath)
      return new Response('Forbidden', { status: 403 })
    }
    try {
      const data = await fs.promises.readFile(filePath)
      const ext = path.extname(filePath).toLowerCase()
      const type = MIME[ext] ?? 'application/octet-stream'
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': type,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        },
      })
    } catch (err) {
      console.error('[pet-asset] missing', filePath, err)
      return new Response('Not Found', { status: 404 })
    }
  })
}
