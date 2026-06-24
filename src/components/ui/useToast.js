import { useContext } from 'react'
import { ToastContext } from './toastState'

export function useToast() {
  const context = useContext(ToastContext)

  if (!context) {
    throw new Error('useToast deve essere usato dentro ToastProvider')
  }

  return context
}
