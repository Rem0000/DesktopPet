import { useEffect, useRef, useState, type ComponentType, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { PetMood } from './types'
import type { Live2DSession } from '../live2d/session'
type Live2DViewProps = {
  modelUrl: string
  runtime?: import('../live2d/session').Live2DRuntime
  catalog?: import('../live2d/session').Live2DCatalog | null
  speaking: boolean
  blink: boolean
  soundEnabled?: boolean
  className?: string
}

type Props = {
  live2d: Live2DSession | null
  mood: PetMood
  speaking: boolean
  soundEnabled?: boolean
  onDrag: (dx: number, dy: number) => void
  onContextMenu?: () => void
}

/** 超过该像素位移才视为拖窗口，短按留给 Live2D 点击互动 */
const DRAG_THRESHOLD = 6

export function PetStage({
  live2d,
  mood,
  speaking,
  soundEnabled = true,
  onDrag,
  onContextMenu,
}: Props) {
  const [blink, setBlink] = useState(false)
  const [Live2DView, setLive2DView] = useState<ComponentType<Live2DViewProps> | null>(
    null,
  )
  const [live2dError, setLive2dError] = useState<string | null>(null)
  const dragRef = useRef<{
    x: number
    y: number
    originX: number
    originY: number
    dragging: boolean
  } | null>(null)

  useEffect(() => {
    let timer = 0
    let blinkOff = 0

    const schedule = () => {
      const wait = 2200 + Math.random() * 3200
      timer = window.setTimeout(() => {
        setBlink(true)
        blinkOff = window.setTimeout(() => {
          setBlink(false)
          schedule()
        }, 140)
      }, wait)
    }

    schedule()
    return () => {
      window.clearTimeout(timer)
      window.clearTimeout(blinkOff)
    }
  }, [])

  useEffect(() => {
    if (!live2d) {
      setLive2DView(null)
      setLive2dError(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        // cubism 包在 import 时就会检查对应全局 Core
        const runtime = live2d.runtime ?? live2d.catalog?.runtime ?? 'cubism4'
        const { ensureCubismCore } = await import('../live2d/ensureCubismCore')
        await ensureCubismCore(runtime)
        if (cancelled) return
        const m = await import('../live2d/Live2DView')
        if (!cancelled) setLive2DView(() => m.Live2DView)
      } catch (err) {
        if (!cancelled) {
          setLive2dError(err instanceof Error ? err.message : String(err))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [live2d])

  const showLive2d = Boolean(live2d && Live2DView && !live2dError)

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button === 2) return
    if ((e.target as HTMLElement).closest('.chrome, .chat-panel')) return
    dragRef.current = {
      x: e.screenX,
      y: e.screenY,
      originX: e.screenX,
      originY: e.screenY,
      dragging: false,
    }
    if (!showLive2d) {
      e.currentTarget.setPointerCapture(e.pointerId)
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragRef.current
    if (!state) return

    if (showLive2d && !state.dragging) {
      const total = Math.hypot(e.screenX - state.originX, e.screenY - state.originY)
      if (total < DRAG_THRESHOLD) return
      state.dragging = true
      state.x = e.screenX
      state.y = e.screenY
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      return
    }

    if (showLive2d && !state.dragging) return

    const dx = e.screenX - state.x
    const dy = e.screenY - state.y
    dragRef.current = { ...state, x: e.screenX, y: e.screenY }
    onDrag(dx, dy)
  }

  const onPointerUp = () => {
    dragRef.current = null
  }

  const handleContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    if ((e.target as HTMLElement).closest('.chat-panel')) return
    onContextMenu?.()
  }

  return (
    <div
      className={`pet-stage mood-${mood} ${speaking ? 'speaking' : ''} ${blink ? 'blinking' : ''} ${showLive2d ? 'live2d-mode' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={handleContextMenu}
    >
      <div className="pet-body">
        {showLive2d && live2d && Live2DView ? (
          <Live2DView
            modelUrl={live2d.modelUrl}
            runtime={live2d.runtime ?? live2d.catalog?.runtime}
            catalog={live2d.catalog}
            speaking={speaking}
            blink={blink}
            soundEnabled={soundEnabled}
            className="pet-skin live2d-skin"
          />
        ) : live2dError ? (
          <div className="live2d-error">{live2dError}</div>
        ) : live2d ? (
          <div className="live2d-loading">模型加载中…</div>
        ) : (
          <div className="live2d-loading">正在准备桌宠…</div>
        )}
      </div>
    </div>
  )
}
