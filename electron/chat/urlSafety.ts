const URL_MAX_LENGTH = 2048

/** 私有/回环 IP 段：SSRF 常见目标 */
function isPrivateIp(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  // IPv4 字面量
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const octets = host.split('.').map((part) => Number(part))
    const [a, b] = octets
    if (a === 127) return true
    if (a === 10) return true
    if (a === 169 && b === 254) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true
  }
  return false
}

/**
 * web_fetch 的 URL 校验：仅 http/https、host 非空、长度受限、拒绝私有 IP/localhost。
 * 返回 null 表示安全；否则返回拒绝原因。
 */
export function isSafeHttpUrl(url: string): { ok: true } | { ok: false; reason: string } {
  if (!url || url.length > URL_MAX_LENGTH) {
    return { ok: false, reason: 'URL 无效或过长' }
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, reason: 'URL 格式无效' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: '仅支持 http/https' }
  }
  if (!parsed.hostname) {
    return { ok: false, reason: 'URL 缺少主机名' }
  }
  if (isPrivateIp(parsed.hostname)) {
    return { ok: false, reason: '拒绝访问本地或内网地址' }
  }
  return { ok: true }
}
