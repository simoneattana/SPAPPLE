// Costanti condivise dal motore. Prima del 2026-08-16 vivevano duplicate in
// api/_tradingEngine.js e src/context/TradingContext.jsx.

export const EXECUTION_MODE = 'simulation'

export const MAX_POSITIONS = 5

export const EQUITIES_SCAN_INTERVAL_MS = 15 * 60_000
export const CRYPTO_SCAN_INTERVAL_MS = 5 * 60_000

export const ORDER_RETENTION_MS = 60 * 24 * 60 * 60 * 1000
export const MAX_ORDER_AUDIT_RECORDS = 180
export const ACTIVITY_LOG_LIMIT = 14

export const DEFAULT_RISK_LIMITS = {
  maxDailyOrders: 20,
  maxDailyCapitalPct: 1,
  maxConsecutiveLosses: 3,
}

export const DEFAULT_REENTRY_COOLDOWN_MS = 6 * 60 * 60 * 1000

// Governo del rischio a gradini. Sostituisce il blocco permanente che il
// backend applicava dopo N perdite consecutive e da cui non usciva mai.
export const RISK_CAUTION_LOSSES = 2
export const RISK_RECOVERY_LOSSES = 3
export const RISK_HARD_STOP_LOSSES = 5
export const RISK_CAUTION_SIZE_MULTIPLIER = 0.75
export const RISK_RECOVERY_SIZE_MULTIPLIER = 0.5
export const RISK_RECOVERY_MAX_OPENINGS = 1

export function getMarketScanIntervalMs(marketId) {
  return marketId === 'crypto' ? CRYPTO_SCAN_INTERVAL_MS : EQUITIES_SCAN_INTERVAL_MS
}
