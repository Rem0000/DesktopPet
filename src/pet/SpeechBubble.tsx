import { useEffect, useRef } from 'react'

type TailSide = 'bl' | 'br'

type Props = {
  text: string
  tail: TailSide
  onDismiss: () => void
  durationMs?: number
}

export function SpeechBubble({ text, tail, onDismiss, durationMs = 10_000 }: Props) {
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  useEffect(() => {
    if (!durationMs || !Number.isFinite(durationMs) || durationMs <= 0) return
    const timer = window.setTimeout(() => onDismissRef.current(), durationMs)
    return () => window.clearTimeout(timer)
  }, [text, durationMs])

  return (
    <button
      type="button"
      className={`speech-bubble tail-${tail}`}
      onClick={onDismiss}
      aria-label="关闭提醒"
    >
      <span className="speech-bubble-text">{text}</span>
    </button>
  )
}
