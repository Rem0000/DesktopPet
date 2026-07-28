import nodeModule from 'node:module'

let patched = false

type ModuleLoad = (
  request: string,
  parent: nodeModule.Module,
  isMain: boolean,
) => unknown

function isSharpRequest(request: string): boolean {
  return request === 'sharp' || /(?:^|[\\/])sharp(?:[\\/]|$)/.test(request)
}

function createSharpStub(): () => {
  metadata: () => Promise<{ channels: number }>
  rotate: () => { raw: () => { toBuffer: () => Promise<{ data: Buffer; info: object }> } }
} {
  return () => ({
    metadata: async () => ({ channels: 3 }),
    rotate: () => ({
      raw: () => ({
        toBuffer: async () => ({
          data: Buffer.alloc(0),
          info: { width: 1, height: 1, channels: 3 },
        }),
      }),
    }),
  })
}

/**
 * @xenova/transformers 顶层会 import sharp（仅图像管线需要）。
 * 文本 feature-extraction 不依赖 sharp，但缺省安装会阻断模块加载。
 */
export function ensureSharpStubForTransformers(): void {
  if (patched) return
  const moduleHost = nodeModule as typeof nodeModule & { _load: ModuleLoad }
  const originalLoad = moduleHost._load
  moduleHost._load = function sharpStubLoader(
    this: unknown,
    request: string,
    parent: nodeModule.Module,
    isMain: boolean,
  ) {
    if (isSharpRequest(request)) {
      return createSharpStub()
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  patched = true
}
