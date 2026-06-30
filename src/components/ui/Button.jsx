import { cn } from '../../services/utils'

const sizes = {
  default: 'h-11 px-4 py-2',
  sm: 'h-9 px-3 py-2',
  icon: 'h-10 w-10 p-0',
}

const variants = {
  default:
    'bg-[var(--market-accent)] text-slate-950 shadow-lg shadow-[var(--market-accent-soft)] hover:bg-[var(--market-accent-hover)]',
  ghost:
    'border border-slate-800 bg-transparent text-slate-400 hover:bg-slate-900 hover:text-white',
}

export function Button({
  className,
  variant = 'default',
  size = 'default',
  type = 'button',
  ...props
}) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[var(--market-accent)] focus:ring-offset-2 focus:ring-offset-[#050608]',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-55',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  )
}
