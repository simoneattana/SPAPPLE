import { cn } from '../../services/utils'

export function Card({ className, ...props }) {
  return (
    <article
      className={cn(
        'rounded-lg border border-slate-800 bg-[#090b10] shadow-xl shadow-black/20',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }) {
  return <div className={cn('flex p-5 pb-3', className)} {...props} />
}

export function CardTitle({ className, ...props }) {
  return (
    <h3
      className={cn('text-sm font-medium leading-5 text-slate-400', className)}
      {...props}
    />
  )
}

export function CardContent({ className, ...props }) {
  return <div className={cn('p-5 pt-2', className)} {...props} />
}
