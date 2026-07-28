declare global {
  interface Window {
    Live2DCubismCore?: unknown
    Live2D?: unknown
  }
}

type RuntimeKind = 'cubism2' | 'cubism4'

const loading: Partial<Record<RuntimeKind, Promise<void>>> = {}

function hasCubism4(): boolean {
  return Boolean(typeof window !== 'undefined' && window.Live2DCubismCore)
}

function hasCubism2(): boolean {
  return Boolean(typeof window !== 'undefined' && window.Live2D)
}

function loadScriptOnce(src: string, marker: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const sel = `script[${marker}]`
    const existing = document.querySelector<HTMLScriptElement>(sel)
    if (existing) {
      if (existing.dataset.ready === '1') {
        resolve()
        return
      }
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener(
        'error',
        () => reject(new Error(`脚本加载失败: ${src}`)),
        { once: true },
      )
      return
    }

    const script = document.createElement('script')
    script.src = src
    script.async = false
    script.setAttribute(marker.replace(/^data-/, 'data-'), '')
    // marker like data-cubism-core
    const attr = marker.startsWith('data-') ? marker : `data-${marker}`
    script.setAttribute(attr, '1')
    script.onload = () => {
      script.dataset.ready = '1'
      resolve()
    }
    script.onerror = () => reject(new Error(`无法加载 ${src}`))
    document.head.appendChild(script)
  })
}

async function ensureCubism4Core(): Promise<void> {
  if (hasCubism4()) return
  if (loading.cubism4) return loading.cubism4

  loading.cubism4 = (async () => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-cubism-core], script[src*="live2dcubismcore"]',
    )
    if (existing) {
      if (hasCubism4()) return
      await new Promise<void>((resolve, reject) => {
        const done = () => {
          if (hasCubism4()) resolve()
          else reject(new Error('Cubism Core 未挂到 window.Live2DCubismCore'))
        }
        existing.addEventListener('load', done, { once: true })
        existing.addEventListener(
          'error',
          () => reject(new Error('Cubism Core 脚本加载失败')),
          { once: true },
        )
        // 已执行完的内联/预载脚本
        queueMicrotask(() => {
          if (hasCubism4()) resolve()
        })
      })
      return
    }

    await loadScriptOnce('/live2d/live2dcubismcore.min.js', 'data-cubism-core')
    if (!hasCubism4()) {
      throw new Error('Cubism Core 未挂到 window.Live2DCubismCore')
    }
  })().catch((err) => {
    delete loading.cubism4
    throw err
  })

  return loading.cubism4
}

async function ensureCubism2Core(): Promise<void> {
  if (hasCubism2()) return
  if (loading.cubism2) return loading.cubism2

  loading.cubism2 = (async () => {
    await loadScriptOnce('/live2d/live2d.min.js', 'data-live2d-core')
    if (!hasCubism2()) {
      throw new Error('Cubism 2 运行时未挂到 window.Live2D')
    }
  })().catch((err) => {
    delete loading.cubism2
    throw err
  })

  return loading.cubism2
}

/** 按 runtime 加载 Cubism 4 Core 或 Cubism 2 live2d.min.js */
export function ensureCubismCore(
  runtime: RuntimeKind = 'cubism4',
): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Cubism Core 只能在渲染进程加载'))
  }
  return runtime === 'cubism2' ? ensureCubism2Core() : ensureCubism4Core()
}
