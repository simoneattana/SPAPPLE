import { useContext } from 'react'
import { TradingContext } from './tradingState'

export function useTrading() {
  const context = useContext(TradingContext)

  if (!context) {
    throw new Error('useTrading deve essere usato dentro TradingProvider')
  }

  return context
}
