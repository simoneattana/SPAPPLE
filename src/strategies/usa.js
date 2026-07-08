import { US_TICKERS } from '../services/marketUniverse.js'
import {
  MAX_POSITION_SIZE,
  MIN_POSITION_SIZE,
  POSITION_SIZE_PERCENT,
} from '../services/positionSizing.js'

export const USA_MARKET_ID = 'usa'

export const usaStrategy = {
  id: USA_MARKET_ID,
  label: 'Borsa USA',
  shortLabel: 'USA',
  currency: 'USD',
  baseCurrency: 'EUR',
  universe: US_TICKERS,
  initialCapital: 30000,
  maxPositions: 8,
  reentryCooldownMs: 24 * 60 * 60 * 1000,
  positionSizing: {
    mode: 'percentuale_capitale',
    percent: POSITION_SIZE_PERCENT,
    min: MIN_POSITION_SIZE,
    max: MAX_POSITION_SIZE,
  },
  rules: {
    profitabilityFilter: 'P/E positivo',
    signalFilter: 'RSI sotto 30 o sopra 70',
    volatilityFilter: 'ATR massimo per pilota automatico',
    currencyPolicy: 'Prezzi in USD con controvalore EUR da EODHD Forex',
  },
}
