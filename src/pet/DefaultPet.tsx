import type { PetMood } from './types'

type Props = { mood: PetMood }

export function DefaultPet({ mood }: Props) {
  const cheek = mood === 'happy' ? 0.9 : 0.35
  const brow = mood === 'thinking' ? -8 : mood === 'happy' ? 4 : 0

  return (
    <svg
      className="default-pet"
      viewBox="0 0 240 280"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="默认桌宠"
    >
      <defs>
        <linearGradient id="body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7ec8e3" />
          <stop offset="100%" stopColor="#4fa3c7" />
        </linearGradient>
      </defs>
      <ellipse cx="120" cy="168" rx="78" ry="86" fill="url(#body)" />
      <ellipse cx="120" cy="96" rx="62" ry="58" fill="url(#body)" />
      <ellipse cx="78" cy="62" rx="18" ry="28" fill="#4fa3c7" />
      <ellipse cx="162" cy="62" rx="18" ry="28" fill="#4fa3c7" />
      <circle cx="98" cy="98" r="7" fill="#1e2a32" />
      <circle cx="142" cy="98" r="7" fill="#1e2a32" />
      <circle cx="100" cy="96" r="2.2" fill="#fff" />
      <circle cx="144" cy="96" r="2.2" fill="#fff" />
      <path
        d={`M88 ${84 + brow} Q98 ${78 + brow} 108 ${84 + brow}`}
        stroke="#1e2a32"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d={`M132 ${84 + brow} Q142 ${78 + brow} 152 ${84 + brow}`}
        stroke="#1e2a32"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
      <ellipse
        cx="78"
        cy="112"
        rx="12"
        ry="8"
        fill="#ff8fab"
        opacity={cheek}
      />
      <ellipse
        cx="162"
        cy="112"
        rx="12"
        ry="8"
        fill="#ff8fab"
        opacity={cheek}
      />
      <ellipse cx="120" cy="118" rx="7" ry="5" fill="#3d6b7c" />
      <path
        d={
          mood === 'happy'
            ? 'M104 132 Q120 148 136 132'
            : mood === 'thinking'
              ? 'M108 136 Q120 130 132 138'
              : 'M108 136 Q120 142 132 136'
        }
        stroke="#1e2a32"
        strokeWidth="3.5"
        fill="none"
        strokeLinecap="round"
      />
      <ellipse cx="72" cy="188" rx="16" ry="12" fill="#3f90b0" opacity="0.85" />
      <ellipse cx="168" cy="188" rx="16" ry="12" fill="#3f90b0" opacity="0.85" />
    </svg>
  )
}
