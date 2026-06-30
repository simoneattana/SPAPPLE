import { EQUITIES_MARKET_ID, equitiesStrategy } from './equities.js'
import { CRYPTO_MARKET_ID, cryptoStrategy } from './crypto.js'

export const DEFAULT_MARKET_ID = EQUITIES_MARKET_ID

export const TRADING_STRATEGIES = {
  [EQUITIES_MARKET_ID]: equitiesStrategy,
  [CRYPTO_MARKET_ID]: cryptoStrategy,
}

export function getTradingStrategy(marketId = DEFAULT_MARKET_ID) {
  return TRADING_STRATEGIES[marketId] || TRADING_STRATEGIES[DEFAULT_MARKET_ID]
}
