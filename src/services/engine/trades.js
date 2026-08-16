// Segnali, geometria delle operazioni e regole di uscita.
//
// Fino al 2026-08-16 buildTrade esisteva in due versioni con firme diverse.
// Quella backend ricalcolava la direzione al proprio interno con
// `row.rsi < 30 ? 'LONG' : 'SHORT'`, cioe soglie fisse su tutti i mercati e
// nessun caso "nessun segnale": su Asia, dove le soglie sono 35 e 65, un titolo
// a RSI 31 e un LONG e veniva aperto SHORT. Qui la direzione arriva sempre da
// fuori, decisa una volta sola da getSignalType.

import { getCryptoSignalType } from '../cryptoRules.js'
import { convertToBaseCurrency } from '../currency.js'
import { applyExecutionCosts } from '../executionCosts.js'
import { getMarketCloseGuardLabel } from '../marketHours.js'
import { getTickerCurrency } from '../marketUniverse.js'
import { getEquitySignalType } from '../tradingRules.js'
import { getTradingStrategy } from '../../strategies/index.js'
import { MAX_POSITIONS } from './constants.js'
import { roundPrice, roundQuantity } from './format.js'

export function getSignalType(row, strategy) {
  if (strategy?.id === 'crypto') {
    return getCryptoSignalType(row)
  }

  return getEquitySignalType(row)
}

export function getStrategyMaxPositions(strategy) {
  return Number.isFinite(Number(strategy.maxPositions))
    ? Number(strategy.maxPositions)
    : MAX_POSITIONS
}

export function getMarketCurrencyData(ticker, price, atr, marketData = {}) {
  const currency = marketData?.currency || getTickerCurrency(ticker)
  const fxToEur = Number(marketData?.fxToEur)
  const entryFxToEur = Number.isFinite(fxToEur) && fxToEur > 0 ? fxToEur : 1
  const entryPriceEur =
    Number(marketData?.currentPriceEur) ||
    convertToBaseCurrency(price, entryFxToEur) ||
    price
  const atrAtEntryEur =
    Number(marketData?.atrEur) || convertToBaseCurrency(atr, entryFxToEur) || atr

  return {
    currency,
    entryFxToEur,
    entryPriceEur,
    atrAtEntryEur,
    fxPair: marketData?.fxPair || null,
    fxProvider: marketData?.fxProvider || null,
  }
}

export function buildTrade({
  ticker,
  price,
  atr,
  type,
  invested,
  profile = null,
  strategy = getTradingStrategy(),
  order = null,
  marketData = {},
}) {
  const atrPct = (atr / price) * 100
  const isCrypto = strategy.id === 'crypto'
  const targetPct = isCrypto ? (atrPct < 4 ? 0.45 : 0.65) : atrPct < 1.5 ? 0.35 : 0.6
  const maxTargetPct = isCrypto ? targetPct : atrPct < 1.5 ? 0.8 : 1.2
  const trailingPct = isCrypto ? null : atrPct < 1.5 ? 0.2 : 0.3
  const stopMultiplier = isCrypto ? 1.8 : atrPct < 1.5 ? 1.2 : 1.5
  const long = type === 'LONG'
  const openedAt = new Date().toISOString()
  const currencyData = getMarketCurrencyData(ticker, price, atr, marketData)
  const openExecutionCosts = applyExecutionCosts({
    atr,
    currency: currencyData.currency,
    fxToEur: currencyData.entryFxToEur,
    marketId: strategy.id,
    notionalEur: invested,
    phase: 'OPEN',
    price,
    ticker,
    type,
  })
  const entryPrice = Number(openExecutionCosts.effectivePrice)
  const entryPriceEur =
    Number(openExecutionCosts.effectivePriceEur) || currencyData.entryPriceEur
  const quantity = roundQuantity(invested / entryPriceEur)
  const stopLoss = roundPrice(
    long ? entryPrice - atr * stopMultiplier : entryPrice + atr * stopMultiplier,
  )

  return {
    id: `${ticker}-${type}-${Date.now()}`,
    marketId: strategy.id,
    marketLabel: strategy.label,
    ticker,
    profile,
    type,
    openOrderId: order?.id || null,
    openedAt,
    currency: currencyData.currency,
    entryFxToEur: currencyData.entryFxToEur,
    entryPriceEur: roundPrice(entryPriceEur),
    entrySignalPrice: roundPrice(price),
    entrySignalPriceEur: roundPrice(currencyData.entryPriceEur),
    atrAtEntryEur: roundPrice(currencyData.atrAtEntryEur),
    fxPair: currencyData.fxPair,
    fxProvider: currencyData.fxProvider,
    entryPrice: roundPrice(entryPrice),
    executionCosts: {
      open: openExecutionCosts,
    },
    atrAtEntry: roundPrice(atr),
    takeProfit: roundPrice(
      long ? entryPrice * (1 + targetPct / 100) : entryPrice * (1 - targetPct / 100),
    ),
    finalTakeProfit: roundPrice(
      long
        ? entryPrice * (1 + maxTargetPct / 100)
        : entryPrice * (1 - maxTargetPct / 100),
    ),
    stopLoss,
    initialStopLoss: stopLoss,
    profitLockArmed: false,
    favorablePrice: roundPrice(entryPrice),
    daysHeld: 0,
    invested: roundPrice(invested),
    quantity,
    targetPct,
    maxTargetPct,
    trailingPct,
  }
}

export function evaluateProfitExit(position, latestPrice) {
  const long = position.type === 'LONG'
  const trailingPct = Number(position.trailingPct)
  const hasDynamicProfit = Number.isFinite(trailingPct) && trailingPct > 0
  const takeProfit = Number(position.takeProfit)
  const finalTakeProfit = Number(position.finalTakeProfit || position.takeProfit)

  if (!hasDynamicProfit) {
    return {
      exitReason: 'TAKE_PROFIT',
      isWin: long ? latestPrice >= takeProfit : latestPrice <= takeProfit,
      monitoredFields: {},
    }
  }

  const previousFavorablePrice = Number.isFinite(Number(position.favorablePrice))
    ? Number(position.favorablePrice)
    : Number(position.entryPrice)
  const favorablePrice = long
    ? Math.max(previousFavorablePrice, latestPrice)
    : Math.min(previousFavorablePrice, latestPrice)
  const profitLockReached = long ? latestPrice >= takeProfit : latestPrice <= takeProfit
  const profitLockArmed = Boolean(position.profitLockArmed) || profitLockReached
  const trailingStopPrice = profitLockArmed
    ? long
      ? favorablePrice * (1 - trailingPct / 100)
      : favorablePrice * (1 + trailingPct / 100)
    : null
  const maxTargetReached = long
    ? latestPrice >= finalTakeProfit
    : latestPrice <= finalTakeProfit
  const trailingTriggered =
    profitLockArmed &&
    Number.isFinite(Number(trailingStopPrice)) &&
    (long ? latestPrice <= trailingStopPrice : latestPrice >= trailingStopPrice)

  return {
    exitReason: maxTargetReached ? 'TAKE_PROFIT_MAX' : 'TRAILING_PROFIT',
    isWin: maxTargetReached || trailingTriggered,
    monitoredFields: {
      profitLockArmed,
      favorablePrice: roundPrice(favorablePrice),
      trailingStopPrice: Number.isFinite(Number(trailingStopPrice))
        ? roundPrice(trailingStopPrice)
        : null,
    },
  }
}

export function getProtectedStopLoss(position, profitExit) {
  const trailingPct = Number(position.trailingPct)
  const hasDynamicStop = Number.isFinite(trailingPct) && trailingPct > 0
  const currentStopLoss = Number(position.stopLoss)

  if (!hasDynamicStop || !Number.isFinite(currentStopLoss)) {
    return currentStopLoss
  }

  const profitLockArmed =
    Boolean(position.profitLockArmed) ||
    Boolean(profitExit?.monitoredFields?.profitLockArmed)

  if (!profitLockArmed) {
    return currentStopLoss
  }

  const entryPrice = Number(position.entryPrice)

  if (!Number.isFinite(entryPrice)) {
    return currentStopLoss
  }

  return position.type === 'LONG'
    ? Math.max(currentStopLoss, entryPrice)
    : Math.min(currentStopLoss, entryPrice)
}

export function getCloseReasonText(exitReason, source = 'monitor', strategy = null) {
  const prefix =
    source === 'backend-monitor' ? 'Chiusura automatica backend' : 'Chiusura automatica'

  if (exitReason === 'STOP_LOSS') {
    return `${prefix}: stop loss raggiunto.`
  }

  if (exitReason === 'BREAK_EVEN_STOP') {
    return `${prefix}: stop a pareggio raggiunto.`
  }

  if (exitReason === 'PRE_CLOSE_PROFIT_LOCK') {
    return `${prefix}: protezione pre-chiusura, utile consolidato.`
  }

  if (exitReason === 'PRE_CLOSE_CAPITAL_PROTECTION') {
    return `${prefix}: protezione pre-chiusura, capitale protetto.`
  }

  if (exitReason === 'PRE_CLOSE_RISK' || exitReason === 'SESSION_PROTECTION') {
    return `${prefix}: protezione ${getMarketCloseGuardLabel(strategy)} attivata.`
  }

  if (exitReason === 'TRAILING_PROFIT') {
    return `${prefix}: trailing profit attivato.`
  }

  return `${prefix}: target profit raggiunto.`
}
