import { useCallback, useEffect, useState } from 'react'
import { PetStage } from './pet/PetStage'
import { SpeechBubble } from './pet/SpeechBubble'
import type { PetMood } from './pet/types'
import type { Live2DSessionPayload } from '../electron/preload'
import {
  loadLive2DSession,
  saveLive2DSession,
  type Live2DSession,
} from './live2d/session'

function sessionFromPayload(session: Live2DSessionPayload): Live2DSession {
  return {
    ...session,
    runtime: session.runtime ?? session.catalog?.runtime,
  }
}

export default function App() {
  const [live2d, setLive2d] = useState<Live2DSession | null>(null)
  const [busy, setBusy] = useState(false)
  const [mood, setMood] = useState<PetMood>('idle')
  const [speaking, setSpeaking] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [bubble, setBubble] = useState<{
    text: string
    durationMs: number
    tail: 'bl' | 'br'
  } | null>(null)

  const persistLive2d = useCallback((session: Live2DSession | null) => {
    setLive2d(session)
    saveLive2DSession(session)
    void window.petAPI.setActiveLive2DDir(session?.outDir ?? null)
  }, [])

  const dismissBubble = useCallback(() => {
    setBubble(null)
    setSpeaking(false)
    setMood('idle')
    void window.petAPI.dismissSpeechBubble()
  }, [])

  const applyDefaultLive2D = useCallback(async () => {
    const session = await window.petAPI.applyDefaultLive2D()
    if (!session) return false
    persistLive2d(sessionFromPayload(session))
    return true
  }, [persistLive2d])

  // 启动时恢复上次模型；失败或无记录则回退默认包
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const saved = loadLive2DSession()
      if (saved?.model3Path) {
        try {
          const refreshed = await window.petAPI.refreshLive2DSession({
            model3Path: saved.model3Path,
            outDir: saved.outDir,
          })
          if (cancelled) return
          if (refreshed) {
            let packageId = saved.packageId
            if (!packageId) {
              packageId =
                (await window.petAPI.resolvePackageId(refreshed.dir)) ??
                undefined
            }
            persistLive2d({
              modelUrl: refreshed.modelUrl,
              model3Path: refreshed.model3Path,
              outDir: refreshed.dir,
              packageId,
              source: 'imported',
              catalog: refreshed.catalog,
              runtime: refreshed.runtime,
            })
            return
          }
        } catch {
          /* fall through to default */
        }
      }
      if (!cancelled) {
        await applyDefaultLive2D()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [persistLive2d, applyDefaultLive2D])

  const importLive2D = useCallback(async () => {
    setBusy(true)
    try {
      const picked = await window.petAPI.openLive2DModel('folder')
      if (!picked) return
      let packageId =
        (await window.petAPI.resolvePackageId(picked.dir)) ?? undefined
      persistLive2d({
        modelUrl: picked.modelUrl,
        model3Path: picked.model3Path,
        outDir: picked.dir,
        packageId,
        source: 'imported',
        catalog: picked.catalog,
        runtime: picked.runtime,
      })
      void window.petAPI.notifyLibraryChanged()
    } catch (err) {
      console.error('[import Live2D]', err)
    } finally {
      setBusy(false)
    }
  }, [persistLive2d])

  useEffect(() => {
    const offL2Import = window.petAPI.onRequestLive2DImport(() => {
      void importLive2D()
    })
    const offSession = window.petAPI.onLive2DSession((session) => {
      persistLive2d(sessionFromPayload(session))
    })
    const offExitL2d = window.petAPI.onExitLive2D(() => {
      void window.petAPI.setCursorFocusTracking(false)
      void applyDefaultLive2D()
    })
    const offSound = window.petAPI.onSetSound((enabled) => {
      setSoundEnabled(enabled)
    })
    const offAgentState = window.petAPI.onAgentState((state) => {
      setMood(state === 'thinking' ? 'thinking' : state === 'speaking' ? 'happy' : 'idle')
      setSpeaking(state === 'speaking')
    })
    const offBubble = window.petAPI.onSpeechBubble((payload) => {
      void (async () => {
        const tail = await window.petAPI.getBubbleTailSide()
        setBubble({
          text: payload.text,
          durationMs: payload.durationMs ?? 10_000,
          tail,
        })
        setSpeaking(true)
        setMood('happy')
      })()
    })
    return () => {
      offL2Import()
      offSession()
      offExitL2d()
      offSound()
      offAgentState()
      offBubble()
    }
  }, [persistLive2d, importLive2D, applyDefaultLive2D])

  const showPetMenu = useCallback(() => {
    void window.petAPI.showContextMenu({
      busy,
      hasLive2d: true,
      soundEnabled,
      motionGroups: live2d?.catalog?.motionGroups,
      expressions: live2d?.catalog?.expressions,
      activeModelDir: live2d?.outDir,
    })
  }, [busy, live2d, soundEnabled])

  return (
    <div className={`app ${live2d ? 'live2d-active' : ''}`}>
      <PetStage
        live2d={live2d}
        mood={mood}
        speaking={speaking}
        soundEnabled={soundEnabled}
        onDrag={(dx, dy) => window.petAPI.dragMove(dx, dy)}
        onContextMenu={showPetMenu}
      />
      {bubble ? (
        <SpeechBubble
          text={bubble.text}
          tail={bubble.tail}
          durationMs={bubble.durationMs}
          onDismiss={dismissBubble}
        />
      ) : null}
    </div>
  )
}
