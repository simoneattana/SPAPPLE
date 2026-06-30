export const CRYPTO_MARKET_ID = 'crypto'

export const cryptoStrategy = {
  id: CRYPTO_MARKET_ID,
  label: 'Criptovalute',
  shortLabel: 'Crypto',
  currency: 'EUR',
  universe: [],
  initialCapital: 0,
  maxPositions: 3,
  enabled: false,
  positionSizing: {
    mode: 'percentuale_capitale',
    percent: 0.05,
    min: 100,
    max: 1500,
  },
  rules: {
    profitabilityFilter: 'Non applicabile: il P/E non esiste sulle crypto',
    liquidityFilter: 'Volume minimo e market cap minima obbligatori',
    signalFilter: 'RSI estremo adattato a mercato 24/7',
    volatilityFilter: 'ATR e rischio più restrittivi rispetto alle azioni',
  },
}

