/**
 * Browser-safe subset of Node's `url` module.
 * Plain JS so Vite/esbuild optimizeDeps can resolve named exports reliably.
 */

export function pathToFileURL(filepath) {
  let normalized = String(filepath).replace(/\\/g, '/')
  if (/^[A-Za-z]:/.test(normalized)) {
    normalized = `/${normalized}`
  } else if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`
  }
  return new URL(`file://${normalized}`)
}

export function fileURLToPath(url) {
  const href = typeof url === 'string' ? url : url.href
  let p = decodeURIComponent(href.replace(/^file:\/\//, ''))
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1)
  return p
}

/** Minimal WHATWG/legacy-compatible parse used by @pixi/utils */
export function parse(urlStr, _parseQueryString, _slashesDenoteHost) {
  try {
    const u = new URL(urlStr, 'http://localhost')
    return {
      protocol: u.protocol || null,
      slashes: true,
      auth: u.username
        ? `${u.username}${u.password ? `:${u.password}` : ''}`
        : null,
      host: u.host || null,
      port: u.port || null,
      hostname: u.hostname || null,
      hash: u.hash || null,
      search: u.search || null,
      query: u.search ? u.search.slice(1) : null,
      pathname: u.pathname || null,
      path: `${u.pathname || ''}${u.search || ''}` || null,
      href: u.href,
    }
  } catch {
    return {
      protocol: null,
      slashes: null,
      auth: null,
      host: null,
      port: null,
      hostname: null,
      hash: null,
      search: null,
      query: null,
      pathname: urlStr,
      path: urlStr,
      href: urlStr,
    }
  }
}

export function format(urlObj) {
  if (urlObj && urlObj.href) return urlObj.href
  const protocol = (urlObj && urlObj.protocol) || 'http:'
  const host =
    (urlObj && urlObj.host) ||
    (urlObj && urlObj.hostname
      ? `${urlObj.hostname}${urlObj.port ? `:${urlObj.port}` : ''}`
      : 'localhost')
  const pathname = (urlObj && urlObj.pathname) || '/'
  let search = (urlObj && urlObj.search) || ''
  if (!search && urlObj && urlObj.query && typeof urlObj.query === 'object') {
    search =
      '?' +
      Object.entries(urlObj.query)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
  }
  const hash = (urlObj && urlObj.hash) || ''
  return `${protocol}//${host}${pathname}${search}${hash}`
}

/**
 * 相对路径解析。pet-asset 使用 /D/... 无冒号 pathname，可直接用 WHATWG URL。
 */
export function resolve(...args) {
  if (args.length === 0) return ''
  try {
    let base = args[0]
    for (let i = 1; i < args.length; i++) {
      base = new URL(args[i], base).href
    }
    return base
  } catch {
    return args[args.length - 1] || ''
  }
}

export const URL = globalThis.URL

const api = {
  pathToFileURL,
  fileURLToPath,
  parse,
  format,
  resolve,
  URL,
}

export default api
