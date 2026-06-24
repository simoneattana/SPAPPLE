import { cn } from '../../services/utils'

const variants = {
  default: 'border-slate-700 bg-slate-900 text-slate-200',
  positive: 'border-[#deff9a]/40 bg-[#deff9a]/12 text-[#deff9a]',
  negative: 'border-[#ef8f8f]/40 bg-[#ef8f8f]/12 text-[#ef8f8f]',
}

export function Badge({ className, variant = 'default', ...props }) {
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center rounded-lg border px-2.5 text-xs font-semibold uppercase tracking-[0.12em]',
        variants[variant],
        className,
      )}
      {...props}
    />
  )
}
