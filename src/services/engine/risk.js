// Governo del rischio: limiti, perdite consecutive, pause e blocchi in apertura.
//
// La copia backend, fino al 2026-08-16, dopo N perdite consecutive restituiva
// "Blocco prudenziale attivo" per sempre: il contatore si azzera solo con
// un'operazione non perdente in testa allo storico, che pero non poteva piu
// aprirsi. Qui vale la versione a gradini e a tempo, che riparte da sola.

import {
  DEFAULT_REENTRY_COOLDOWN_MS,
  DEFAULT_RISK_LIMITS,
  EXECUTION_MODE,
  RISK_CAUTION_LOSSES,
  RISK_CAUTION_SIZE_MULTIPLIER,
  RISK_HARD_STOP_LOSSES,
  RISK_RECOVERY_LOSSES,
  RISK_RECOVERY_MAX_OPENINGS,
  RISK_RECOVERY_SIZE_MULTIPLIER,
} from './constants.js'
import { formatCooldownDuration, isSameDay } from './format.js'
import { calculatePositionSize } from '../positionSizing.js'
import {
  getMarketCloseGuardLabel,
  getMarketScanStartLabel,
  getNextMarketScanAt,
  isMarketCloseGuardActive,
  isMarketScanBlocked,
} from '../marketHours.js'

export function getRiskLimits(strategy, riskLimits = {}) {
  return {
    ...DEFAULT_RISK_LIMITS,
    ...(riskLimits || {}),
    ...(strategy?.riskLimits || {}),
  }
}

export function getConsecutiveLosses(history = []) {
  let losses = 0

  for (const trade of history) {
    if (trade.result === 'LOSS') {
      losses += 1
      continue
    }

    break
  }

  return losses
}

export function getLatestClosedLoss(history = []) {
  return history.find((trade) => {
    const pnl = Number(trade?.pnlEur)

    return (
      trade?.exitDate && (trade.result === 'LOSS' || (Number.isFinite(pnl) && pnl < 0))
    )
  })
}

export function getReentryCooldownMs(strategy, latestClosedTrade) {
  const pnlEur = Number(latestClosedTrade?.pnlEur)
  const isLoss =
    latestClosedTrade?.result === 'LOSS' || (Number.isFinite(pnlEur) && pnlEur < 0)
  const isWin =
    latestClosedTrade?.result === 'WIN' || (Number.isFinite(pnlEur) && pnlEur >= 0)
  const dynamicCooldownMs = isLoss
    ? strategy?.reentryCooldownAfterLossMs
    : isWin
      ? strategy?.reentryCooldownAfterWinMs
      : null

  if (Number.isFinite(Number(dynamicCooldownMs))) {
    return Number(dynamicCooldownMs)
  }

  if (Number.isFinite(Number(strategy?.reentryCooldownMs))) {
    return Number(strategy.reentryCooldownMs)
  }

  return DEFAULT_REENTRY_COOLDOWN_MS
}

export function getTickerCooldownReason(marketState, ticker, strategy) {
  if (!ticker) {
    return null
  }

  const latestClosedTrade = (marketState.history || []).find(
    (trade) => trade?.ticker === ticker && trade?.exitDate,
  )

  if (!latestClosedTrade) {
    return null
  }

  const cooldownMs = getReentryCooldownMs(strategy, latestClosedTrade)

  if (cooldownMs <= 0) {
    return null
  }

  const closedAt = new Date(latestClosedTrade.exitDate).getTime()
  const remainingMs = closedAt + cooldownMs - Date.now()

  if (!Number.isFinite(closedAt) || remainingMs <= 0) {
    return null
  }

  return `${ticker} è in pausa operativa dopo l’ultima chiusura. Nuova apertura consentita tra circa ${formatCooldownDuration(
    remainingMs,
  )}.`
}

export function getRiskGovernorState(marketState, strategy, date = new Date()) {
  const history = marketState.history || []
  const consecutiveLosses = getConsecutiveLosses(history)
  const latestLoss = getLatestClosedLoss(history)
  const maxConsecutiveLosses =
    getRiskLimits(strategy, marketState.riskLimits).maxConsecutiveLosses ||
    RISK_RECOVERY_LOSSES

  if (consecutiveLosses < RISK_CAUTION_LOSSES || !latestLoss) {
    return {
      consecutiveLosses,
      maxOpenings: Infinity,
      mode: 'normal',
      sizeMultiplier: 1,
    }
  }

  const latestLossDate = new Date(latestLoss.exitDate)

  if (!Number.isFinite(latestLossDate.getTime())) {
    return {
      consecutiveLosses,
      maxOpenings: Infinity,
      mode: 'normal',
      sizeMultiplier: 1,
    }
  }

  if (consecutiveLosses >= RISK_HARD_STOP_LOSSES) {
    const firstRestart = getNextMarketScanAt(strategy, latestLossDate)
    const restartAt = getNextMarketScanAt(
      strategy,
      new Date(firstRestart.getTime() + 60_000),
    )

    if (date < restartAt) {
      return {
        consecutiveLosses,
        message: `Blocco forte rischio: ${consecutiveLosses} perdite consecutive. Ripartenza prevista alla seconda sessione utile.`,
        mode: 'hard_stop',
        pauseUntil: restartAt,
        sizeMultiplier: 0,
      }
    }
  }

  if (consecutiveLosses >= maxConsecutiveLosses) {
    const restartAt = getNextMarketScanAt(strategy, latestLossDate)

    if (date < restartAt) {
      return {
        consecutiveLosses,
        message: `Pausa rischio attiva: ${consecutiveLosses} perdite consecutive. Ripartenza alla prossima sessione utile.`,
        mode: 'paused',
        pauseUntil: restartAt,
        sizeMultiplier: 0,
      }
    }

    return {
      consecutiveLosses,
      maxOpenings: RISK_RECOVERY_MAX_OPENINGS,
      message: `Modalità recupero: ${consecutiveLosses} perdite consecutive. Apro al massimo 1 posizione con size ridotta.`,
      mode: 'recovery',
      sizeMultiplier: RISK_RECOVERY_SIZE_MULTIPLIER,
    }
  }

  return {
    consecutiveLosses,
    maxOpenings: Infinity,
    message: `Prudenza attiva: ${consecutiveLosses} perdite consecutive. Size ridotta al 75%.`,
    mode: 'caution',
    sizeMultiplier: RISK_CAUTION_SIZE_MULTIPLIER,
  }
}

export function getRiskAdjustedPositionSize(capital, sizing, riskState) {
  const baseSize = calculatePositionSize(capital, sizing)
  const multiplier = Number.isFinite(Number(riskState?.sizeMultiplier))
    ? Number(riskState.sizeMultiplier)
    : 1

  return Math.max(0, baseSize * multiplier)
}

export function getOpeningOrderBlockReason(marketState, notional, strategy) {
  const riskLimits = getRiskLimits(strategy, marketState.riskLimits)
  const riskState = getRiskGovernorState(marketState, strategy)

  if (marketState.executionMode !== EXECUTION_MODE) {
    return 'Modalità operativa non supportata: al momento Spapple può eseguire solo ordini simulati.'
  }

  if (marketState.killSwitchEnabled) {
    return 'Kill switch attivo: nuove aperture bloccate.'
  }

  if (riskState.mode === 'paused' || riskState.mode === 'hard_stop') {
    return riskState.message
  }

  if (marketState.pendingTicker) {
    if (isMarketCloseGuardActive(strategy, new Date(), marketState.pendingTicker)) {
      return `${marketState.pendingTicker}: protezione ${getMarketCloseGuardLabel(
        strategy,
        marketState.pendingTicker,
      )} attiva. Nuove aperture bloccate fino alla prossima seduta.`
    }

    if (isMarketScanBlocked(strategy, new Date(), marketState.pendingTicker)) {
      return `${marketState.pendingTicker}: borsa di riferimento chiusa. Nuove aperture consentite solo da ${getMarketScanStartLabel(
        strategy,
      )}.`
    }
  }

  if (isMarketCloseGuardActive(strategy)) {
    return `Protezione azionaria ${getMarketCloseGuardLabel(strategy)} attiva: nuove aperture bloccate fino alla prossima seduta.`
  }

  if (marketState.pendingTicker) {
    const cooldownReason = getTickerCooldownReason(
      marketState,
      marketState.pendingTicker,
      strategy,
    )

    if (cooldownReason) {
      return cooldownReason
    }
  }

  const todaysOpeningOrders = (marketState.orders || [])
    .filter((order) => isSameDay(order.createdAt))
    .filter((order) => order.action === 'OPEN' && order.status === 'ESEGUITO')

  if (todaysOpeningOrders.length >= riskLimits.maxDailyOrders) {
    return `Limite giornaliero raggiunto: massimo ${riskLimits.maxDailyOrders} aperture eseguite al giorno.`
  }

  const dailyCapitalLimit =
    Number(strategy.initialCapital || 0) * Number(riskLimits.maxDailyCapitalPct)
  const dailyAllocated = todaysOpeningOrders.reduce(
    (sum, order) => sum + Number(order.notional || 0),
    0,
  )

  if (
    Number.isFinite(dailyCapitalLimit) &&
    dailyCapitalLimit > 0 &&
    dailyAllocated + Number(notional || 0) > dailyCapitalLimit
  ) {
    return `Limite capitale giornaliero superato: massimo ${Math.round(
      riskLimits.maxDailyCapitalPct * 100,
    )}% del capitale iniziale del mercato.`
  }

  return null
}
