import { CRYPTO_TICKERS } from '../services/cryptoUniverse.js'

export const CRYPTO_MARKET_ID = 'crypto'

export const cryptoStrategy = {
  id: CRYPTO_MARKET_ID,
  label: 'Criptovalute',
  shortLabel: 'Crypto',
  currency: 'EUR',
  universe: CRYPTO_TICKERS,
  initialCapital: 10000,
  maxPositions: 3,
  enabled: true,
  positionSizing: {
    mode: 'percentuale_capitale',
    percent: 0.05,
    min: 100,
    max: 1500,
  },
  rules: {
    profitabilityFilter: 'Non applicabile: il P/E non esiste sulle crypto',
    liquidityFilter: 'Liquidità giornaliera minima obbligatoria',
    signalFilter: 'RSI estremo adattato a mercato 24/7',
    volatilityFilter: 'ATR massimo più largo ma controllato',
  },
}
