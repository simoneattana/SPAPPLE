import { CRYPTO_TICKERS } from '../services/cryptoUniverse.js'

export const CRYPTO_MARKET_ID = 'crypto'

export const cryptoStrategy = {
  id: CRYPTO_MARKET_ID,
  label: 'Criptovalute',
  shortLabel: 'Crypto',
  currency: 'EUR',
  universe: CRYPTO_TICKERS,
  initialCapital: 20000,
  maxPositions: 5,
  reentryCooldownMs: 60 * 60 * 1000,
  reentryCooldownAfterWinMs: 60 * 60 * 1000,
  reentryCooldownAfterLossMs: 6 * 60 * 60 * 1000,
  enabled: true,
  riskLimits: {
    maxDailyOrders: 12,
    maxDailyCapitalPct: 1,
    maxConsecutiveLosses: 3,
  },
  positionSizing: {
    mode: 'percentuale_capitale',
    percent: 0.05,
    min: 100,
    max: 1500,
  },
  rules: {
    profitabilityFilter: 'Non applicabile: il P/E non esiste sulle crypto',
    liquidityFilter: 'Solo crypto liquide con volume e capitalizzazione elevati',
    signalFilter: 'RSI adattato a una watchlist ristretta e mercato 24/7',
    volatilityFilter: 'ATR massimo controllato per cercare piccoli target ricorrenti',
  },
}
