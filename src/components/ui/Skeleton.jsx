import { cn } from '../../services/utils'

export function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn('animate-pulse rounded-lg bg-slate-800/70', className)}
      {...props}
    />
  )
}
