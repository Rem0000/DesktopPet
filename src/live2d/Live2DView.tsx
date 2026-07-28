import { useEffect, useRef } from 'react'
import * as PIXI from 'pixi.js'
import { ensureCubismCore } from './ensureCubismCore'
import type { Live2DCatalog, Live2DRuntime } from './session'

// pixi-live2d-display 依赖全局 PIXI
;(window as unknown as { PIXI: typeof PIXI }).PIXI = PIXI

type Live2DModule = typeof import('pixi-live2d-display/cubism4')

type Live2DModelInstance = Awaited<
  ReturnType<Live2DModule['Live2DModel']['from']>
>

type Props = {
  modelUrl: string
  runtime?: Live2DRuntime
  catalog?: Live2DCatalog | null
  speaking: boolean
  blink: boolean
  soundEnabled?: boolean
  className?: string
}

const tickerByRuntime: Partial<Record<Live2DRuntime, boolean>> = {}

async function loadLive2DModule(runtime: Live2DRuntime): Promise<Live2DModule> {
  if (runtime === 'cubism2') {
    return (await import('pixi-live2d-display/cubism2')) as unknown as Live2DModule
  }
  return import('pixi-live2d-display/cubism4')
}

function ensureTicker(mod: Live2DModule, runtime: Live2DRuntime) {
  if (tickerByRuntime[runtime]) return
  mod.Live2DModel.registerTicker(PIXI.Ticker)
  tickerByRuntime[runtime] = true
}

function ensureSoundDefaults(mod: Live2DModule) {
  mod.config.sound = true
  mod.config.motionSync = true
  if (mod.SoundManager.volume <= 0) mod.SoundManager.volume = 0.85
}

function setParam(model: Live2DModelInstance, id: string, value: number) {
  const core = model.internalModel?.coreModel as
    | {
        setParameterValueById?: (i: string, v: number) => void
        setParamFloat?: (i: string, v: number) => void
      }
    | undefined
  if (core?.setParameterValueById) core.setParameterValueById(id, value)
  else core?.setParamFloat?.(id, value)
}

function canvasPoint(
  app: PIXI.Application,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
) {
  const rect = canvas.getBoundingClientRect()
  const x = ((clientX - rect.left) / Math.max(rect.width, 1)) * app.screen.width
  const y = ((clientY - rect.top) / Math.max(rect.height, 1)) * app.screen.height
  return { x, y }
}

/** 屏幕坐标 → 画布逻辑坐标（窗外光标也能映射） */
function screenToCanvasPoint(
  app: PIXI.Application,
  canvas: HTMLCanvasElement,
  screenX: number,
  screenY: number,
) {
  const rect = canvas.getBoundingClientRect()
  // frameless Electron：screenX/Y 对齐窗口屏幕原点；rect 为视口内偏移
  const canvasScreenLeft = window.screenX + rect.left
  const canvasScreenTop = window.screenY + rect.top
  const x =
    ((screenX - canvasScreenLeft) / Math.max(rect.width, 1)) * app.screen.width
  const y =
    ((screenY - canvasScreenTop) / Math.max(rect.height, 1)) * app.screen.height
  return { x, y }
}

function pickIdleGroup(catalog?: Live2DCatalog | null): string {
  const names = catalog?.motionGroups.map((g) => g.name) ?? []
  const preferred = ['Idle', 'idle', 'Idle2', 'Home', 'home']
  for (const p of preferred) {
    if (names.includes(p)) return p
  }
  return names[0] ?? 'Idle'
}

function pickTapGroups(catalog?: Live2DCatalog | null) {
  const names = catalog?.motionGroups.map((g) => g.name) ?? []
  const head =
    names.find((n) => /tap.*head|touch.*head|head/i.test(n)) ??
    names.find((n) => /tap|touch|flick/i.test(n))
  const body =
    names.find((n) => /tap.*body|touch.*body|body|special/i.test(n)) ??
    names.find((n) => /tap|touch|main|flick/i.test(n))
  return { head, body }
}

/**
 * Cubism2/4 Live2D：加载完整模型包（贴图/动作/声音/表情），
 * 支持 Idle、全屏光标跟随、点击、菜单触发动作与表情。
 */
export function Live2DView({
  modelUrl,
  runtime: runtimeProp,
  catalog,
  speaking,
  blink,
  soundEnabled = true,
  className,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<PIXI.Application | null>(null)
  const modelRef = useRef<Live2DModelInstance | null>(null)
  const speakingRef = useRef(speaking)
  const blinkRef = useRef(blink)
  const idleGroupRef = useRef('Idle')
  const configRef = useRef<Live2DModule['config'] | null>(null)
  speakingRef.current = speaking
  blinkRef.current = blink

  const runtime: Live2DRuntime =
    runtimeProp ?? catalog?.runtime ?? 'cubism4'

  useEffect(() => {
    if (configRef.current) configRef.current.sound = soundEnabled
  }, [soundEnabled])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let mouthPhase = 0
    let idleFallbackTimer = 0
    let offCursor: (() => void) | undefined

    const boot = async () => {
      await ensureCubismCore(runtime)
      const mod = await loadLive2DModule(runtime)
      ensureTicker(mod, runtime)
      ensureSoundDefaults(mod)
      configRef.current = mod.config
      mod.config.sound = soundEnabled
      if (disposed || !hostRef.current) return

      const { Live2DModel, MotionPriority, MotionPreloadStrategy } = mod

      const app = new PIXI.Application({
        backgroundAlpha: 0,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
        resizeTo: host,
      })
      host.innerHTML = ''
      const canvas = app.view as HTMLCanvasElement
      canvas.style.touchAction = 'none'
      host.appendChild(canvas)
      appRef.current = app

      const idleGroup = pickIdleGroup(catalog)
      idleGroupRef.current = idleGroup
      const tapGroups = pickTapGroups(catalog)

      console.info('[Live2DView] loading', runtime, modelUrl)
      const model = await Live2DModel.from(modelUrl, {
        autoInteract: false,
        autoUpdate: true,
        idleMotionGroup: idleGroup,
        motionPreload: MotionPreloadStrategy.IDLE,
        // @ts-expect-error disable crossOrigin for pet-asset:// textures
        crossOrigin: false,
      })
      if (disposed) {
        model.destroy()
        return
      }
      modelRef.current = model
      app.stage.addChild(model)

      const fit = () => {
        const w = app.screen.width
        const h = app.screen.height
        if (w <= 0 || h <= 0) return

        const im = model.internalModel
        const mw = Math.max(im?.width ?? model.width, 0.01)
        const mh = Math.max(im?.height ?? model.height, 0.01)
        const scale = Math.min(w / mw, h / mh) * 0.88

        model.scale.set(scale)
        model.anchor.set(0.5, 1)
        model.position.set(w * 0.5, h - 12)
      }

      fit()
      requestAnimationFrame(fit)
      requestAnimationFrame(() => fit())
      app.ticker.addOnce(fit)

      const playIdle = (index?: number) => {
        try {
          void model.motion(idleGroupRef.current, index, MotionPriority.IDLE)
        } catch {
          /* optional */
        }
      }
      playIdle()

      const playGroup = (group: string, index?: number) => {
        try {
          void model.motion(group, index, MotionPriority.NORMAL).catch(() => {
            playIdle()
          })
        } catch {
          playIdle()
        }
      }

      const playTapMotion = (hitNames: string[]) => {
        const head = hitNames.some((n) => /head/i.test(n))
        const group = head
          ? tapGroups.head ?? idleGroupRef.current
          : tapGroups.body ?? tapGroups.head ?? idleGroupRef.current
        playGroup(group)
      }

      model.on('hit', (hitAreaNames: string[]) => {
        playTapMotion(hitAreaNames)
      })

      const onParamTick = () => {
        const m = modelRef.current
        if (!m || runtime !== 'cubism4') return

        const eye = blinkRef.current ? 0 : 1
        setParam(m, 'ParamEyeLOpen', eye)
        setParam(m, 'ParamEyeROpen', eye)

        if (speakingRef.current) {
          mouthPhase += 0.35
          const mouth = 0.35 + Math.abs(Math.sin(mouthPhase)) * 0.65
          setParam(m, 'ParamMouthOpenY', mouth)
        } else {
          setParam(m, 'ParamMouthOpenY', 0)
        }
      }
      app.ticker.add(onParamTick)

      idleFallbackTimer = window.setInterval(() => {
        const m = modelRef.current
        if (!m) return
        const mgr = m.internalModel?.motionManager
        if (mgr && !mgr.playing) playIdle()
      }, 1200)

      // 全屏光标跟随（主进程轮询屏幕坐标）
      await window.petAPI.setCursorFocusTracking(true)
      offCursor = window.petAPI.onCursorScreenPoint(({ x, y }) => {
        const m = modelRef.current
        if (!m || !appRef.current) return
        const pt = screenToCanvasPoint(appRef.current, canvas, x, y)
        m.focus(pt.x, pt.y)
      })

      const TAP_SLOP = 6
      let press: { x: number; y: number; clientX: number; clientY: number } | null =
        null

      const finishPress = (e: PointerEvent) => {
        if (!press || !modelRef.current || !appRef.current) {
          press = null
          return
        }
        const moved =
          Math.hypot(e.clientX - press.clientX, e.clientY - press.clientY) >
          TAP_SLOP
        if (!moved) {
          const { x, y } = canvasPoint(
            appRef.current,
            canvas,
            e.clientX,
            e.clientY,
          )
          const hits = modelRef.current.hitTest(x, y)
          if (hits.length) {
            modelRef.current.tap(x, y)
          } else {
            playTapMotion(['Body'])
          }
        }
        press = null
      }

      const onPointerDown = (e: PointerEvent) => {
        if (e.button !== 0) return
        if (!modelRef.current || !appRef.current) return
        const { x, y } = canvasPoint(appRef.current, canvas, e.clientX, e.clientY)
        press = { x, y, clientX: e.clientX, clientY: e.clientY }
      }

      const onPointerUp = (e: PointerEvent) => {
        finishPress(e)
      }

      const offPlayMotion = window.petAPI.onPlayMotion((group) => {
        playGroup(group)
      })
      const offPlayExpression = window.petAPI.onPlayExpression((name) => {
        const m = modelRef.current
        if (!m) return
        try {
          void m.expression(name ?? undefined)
        } catch {
          /* optional */
        }
      })

      host.addEventListener('pointerdown', onPointerDown)
      host.addEventListener('pointerup', onPointerUp)
      window.addEventListener('pointerup', onPointerUp)

      const onResize = () => fit()
      window.addEventListener('resize', onResize)
      const ro = new ResizeObserver(() => fit())
      ro.observe(host)

      return () => {
        offCursor?.()
        void window.petAPI.setCursorFocusTracking(false)
        offPlayMotion()
        offPlayExpression()
        host.removeEventListener('pointerdown', onPointerDown)
        host.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('resize', onResize)
        ro.disconnect()
        app.ticker.remove(onParamTick)
        window.clearInterval(idleFallbackTimer)
      }
    }

    let detach: (() => void) | undefined
    void boot()
      .then((cleanup) => {
        detach = cleanup
      })
      .catch((err) => {
        void window.petAPI.setCursorFocusTracking(false)
        const missing = catalog?.missing?.length
          ? `（缺少：${catalog.missing.slice(0, 4).join(', ')}${
              catalog.missing.length > 4 ? '…' : ''
            }）`
          : ''
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[Live2DView]', err)
        if (hostRef.current) {
          hostRef.current.innerHTML = `<div class="live2d-error">${msg}${missing}</div>`
        }
      })

    return () => {
      disposed = true
      offCursor?.()
      void window.petAPI.setCursorFocusTracking(false)
      detach?.()
      window.clearInterval(idleFallbackTimer)
      modelRef.current?.destroy()
      modelRef.current = null
      appRef.current?.destroy(true, { children: true })
      appRef.current = null
      if (host) host.innerHTML = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelUrl, runtime])

  return <div ref={hostRef} className={`live2d-host ${className ?? ''}`} />
}
