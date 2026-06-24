import { cn } from '../../services/utils'

export function Input({ className, ...props }) {
  return (
    <input
      className={cn(
        'h-11 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-[#deff9a]/70 focus:ring-2 focus:ring-[#deff9a]/20',
        className,
      )}
      {...props}
    />
  )
}
