import { useCallback, useRef, useState } from 'react'
import { Info } from 'lucide-react'
import { cn } from '../../services/utils'

export function InfoTip({ children, className, label = 'Informazione' }) {
  const buttonRef = useRef(null)
  const [position, setPosition] = useState({ left: 16, top: 16 })

  const updatePosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect()

    if (!rect) {
      return
    }

    const width = window.innerWidth >= 640 ? 384 : window.innerWidth - 32
    const left = Math.min(
      Math.max(16, rect.right - width),
      Math.max(16, window.innerWidth - width - 16),
    )
    const preferredTop = rect.bottom + 8
    const top =
      preferredTop > window.innerHeight - 180
        ? Math.max(16, rect.top - 188)
        : preferredTop

    setPosition({ left, top })
  }, [])

  return (
    <span className={cn('group relative inline-flex', className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        onFocus={updatePosition}
        onMouseEnter={updatePosition}
        className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-slate-800 bg-slate-950 text-slate-500 transition hover:border-[var(--market-accent-border)] hover:text-[var(--market-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--market-accent)] focus:ring-offset-2 focus:ring-offset-[#050608]"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <span
        className="pointer-events-none fixed z-[9999] hidden max-h-[70vh] overflow-auto rounded-lg border border-slate-800 bg-[#080a0e] p-3 text-left text-xs normal-case leading-5 tracking-normal text-slate-300 shadow-2xl shadow-black/50 group-hover:block group-focus-within:block sm:w-96"
        style={{
          left: position.left,
          top: position.top,
          width: 'min(24rem, calc(100vw - 2rem))',
        }}
      >
        {children}
      </span>
    </span>
  )
}
