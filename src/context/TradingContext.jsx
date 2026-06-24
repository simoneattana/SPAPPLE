import { useCallback, useMemo, useState } from 'react'
import { TradingContext } from './tradingState'

const SLOT_SIZE = 2000
const MAX_POSITIONS = 5

const initialState = {
  capital: 10000,
  vault: 0,
  positions: [],
  history: [],
}

function roundPrice(value) {
  return Number(value.toFixed(4))
}

function buildTrade(ticker, price, atr, type) {
  const atrPct = (atr / price) * 100
  const targetPct = atrPct < 1.5 ? 0.3 : 0.5
  const long = type === 'LONG'

  return {
    id: `${ticker}-${type}-${Date.now()}`,
    ticker,
    type,
    entryPrice: roundPrice(price),
    atrAtEntry: roundPrice(atr),
    takeProfit: roundPrice(
      long ? price * (1 + targetPct / 100) : price * (1 - targetPct / 100),
    ),
    stopLoss: roundPrice(long ? price - atr * 1.5 : price + atr * 1.5),
    daysHeld: 0,
    invested: SLOT_SIZE,
    targetPct,
  }
}

export function TradingProvider({ children }) {
  const [state, setState] = useState(initialState)

  const executeTrade = useCallback((ticker, price, atr, type) => {
    if (!['LONG', 'SHORT'].includes(type)) {
      throw new Error('Tipo ordine non valido')
    }

    if (state.positions.length >= MAX_POSITIONS) {
      throw new Error('Slot operativi esauriti')
    }

    if (state.capital < SLOT_SIZE) {
      throw new Error('Capitale operativo insufficiente')
    }

    const trade = buildTrade(ticker, price, atr, type)

    setState((current) => ({
      ...current,
      capital: current.capital - SLOT_SIZE,
      positions: [...current.positions, trade],
    }))

    return trade
  }, [state.capital, state.positions.length])

  const runEOD = useCallback(() => {
    setState((current) => {
      const positions = current.positions.map((position) => {
        const updatedPosition = {
          ...position,
          daysHeld: position.daysHeld + 1,
        }

        console.log('Valutazione EOD posizione', updatedPosition)
        return updatedPosition
      })

      return {
        ...current,
        positions,
      }
    })
  }, [])

  const value = useMemo(
    () => ({
      ...state,
      executeTrade,
      runEOD,
      slotSize: SLOT_SIZE,
      maxPositions: MAX_POSITIONS,
    }),
    [executeTrade, runEOD, state],
  )

  return (
    <TradingContext.Provider value={value}>{children}</TradingContext.Provider>
  )
}
