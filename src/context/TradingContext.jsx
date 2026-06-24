import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchLatestPrice } from '../services/api'
import { TradingContext } from './tradingState'

const SLOT_SIZE = 2000
const MAX_POSITIONS = 5
const STORAGE_KEY = 'spapple_state'

const initialState = {
  capital: 10000,
  vault: 0,
  positions: [],
  history: [],
}

function roundPrice(value) {
  return Number(value.toFixed(4))
}

function loadInitialState() {
  try {
    const storedState = localStorage.getItem(STORAGE_KEY)

    if (!storedState) {
      return initialState
    }

    const parsedState = JSON.parse(storedState)

    const capital = Number(parsedState.capital)
    const vault = Number(parsedState.vault)

    return {
      capital: Number.isFinite(capital) ? capital : initialState.capital,
      vault: Number.isFinite(vault) ? vault : initialState.vault,
      positions: Array.isArray(parsedState.positions)
        ? parsedState.positions
        : initialState.positions,
      history: Array.isArray(parsedState.history)
        ? parsedState.history
        : initialState.history,
    }
  } catch {
    return initialState
  }
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
  const [state, setState] = useState(loadInitialState)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

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

  const runEOD = useCallback(async () => {
    const positionsWithPrices = await Promise.all(
      state.positions.map(async (position) => ({
        position,
        latestPrice: await fetchLatestPrice(position.ticker),
      })),
    )

    setState((current) => {
      let capital = current.capital
      let vault = current.vault
      const activePositions = []
      const closedTrades = []

      current.positions.forEach((position) => {
        const priceData = positionsWithPrices.find(
          (item) => item.position.id === position.id,
        )
        const latestPrice = priceData?.latestPrice
        const updatedPosition = {
          ...position,
          daysHeld: position.daysHeld + 1,
        }

        if (!Number.isFinite(latestPrice)) {
          console.log('Valutazione EOD posizione', updatedPosition)
          activePositions.push(updatedPosition)
          return
        }

        const quantity = position.invested / position.entryPrice
        const long = position.type === 'LONG'
        const pnlEur = long
          ? (latestPrice - position.entryPrice) * quantity
          : (position.entryPrice - latestPrice) * quantity
        const isWin = long
          ? latestPrice >= position.takeProfit
          : latestPrice <= position.takeProfit
        const isLoss = long
          ? latestPrice <= position.stopLoss
          : latestPrice >= position.stopLoss

        console.log('Valutazione EOD posizione', {
          ...updatedPosition,
          latestPrice,
          pnlEur,
          isWin,
          isLoss,
        })

        if (!isWin && !isLoss) {
          activePositions.push(updatedPosition)
          return
        }

        const roundedPnl = roundPrice(pnlEur)

        if (isWin) {
          capital += position.invested
          vault += Math.max(roundedPnl, 0)
        } else {
          capital += Math.max(position.invested - Math.abs(roundedPnl), 0)
        }

        closedTrades.push({
          ticker: position.ticker,
          type: position.type,
          pnlEur: roundedPnl,
          result: isWin ? 'WIN' : 'LOSS',
          exitDate: new Date().toISOString(),
        })
      })

      return {
        ...current,
        capital: roundPrice(capital),
        vault: roundPrice(vault),
        positions: activePositions,
        history: [...closedTrades, ...current.history],
      }
    })
  }, [state.positions])

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
