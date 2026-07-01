import { Info } from 'lucide-react'
import { cn } from '../../services/utils'

export function InfoTip({ children, className, label = 'Informazione' }) {
  return (
    <span className={cn('group relative inline-flex', className)}>
      <button
        type="button"
        aria-label={label}
        className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-slate-800 bg-slate-950 text-slate-500 transition hover:border-[var(--market-accent-border)] hover:text-[var(--market-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--market-accent)] focus:ring-offset-2 focus:ring-offset-[#050608]"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <span className="pointer-events-none fixed bottom-5 left-4 right-4 z-50 hidden rounded-lg border border-slate-800 bg-[#080a0e] p-3 text-left text-xs normal-case leading-5 tracking-normal text-slate-300 shadow-2xl shadow-black/50 group-hover:block group-focus-within:block sm:absolute sm:bottom-auto sm:left-auto sm:right-0 sm:top-8 sm:w-72">
        {children}
      </span>
    </span>
  )
}
