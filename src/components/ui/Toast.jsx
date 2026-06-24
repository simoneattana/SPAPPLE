import { useMemo, useState } from 'react'
import { CircleAlert, CircleCheck, X } from 'lucide-react'
import { cn } from '../../services/utils'
import { Button } from './Button'
import { ToastContext } from './toastState'

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const toast = ({ title, description, variant = 'default' }) => {
    const id = crypto.randomUUID()
    setToasts((current) => [...current, { id, title, description, variant }])
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id))
    }, 4200)
  }

  const dismiss = (id) => {
    setToasts((current) => current.filter((item) => item.id !== id))
  }

  const value = useMemo(() => ({ toast }), [])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed right-4 top-4 z-50 flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-3">
        {toasts.map((item) => {
          const destructive = item.variant === 'destructive'
          const Icon = destructive ? CircleAlert : CircleCheck

          return (
            <div
              key={item.id}
              className={cn(
                'rounded-lg border bg-[#090b10] p-4 shadow-2xl shadow-black/40',
                destructive
                  ? 'border-[#ef8f8f]/40 text-[#ef8f8f]'
                  : 'border-[#deff9a]/35 text-[#deff9a]',
              )}
            >
              <div className="flex gap-3">
                <Icon className="mt-0.5 h-5 w-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-white">{item.title}</p>
                  {item.description ? (
                    <p className="mt-1 text-sm text-slate-400">{item.description}</p>
                  ) : null}
                </div>
                <Button
                  aria-label="Chiudi notifica"
                  className="h-8 w-8 shrink-0"
                  size="icon"
                  variant="ghost"
                  onClick={() => dismiss(item.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
