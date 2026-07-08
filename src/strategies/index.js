import { EQUITIES_MARKET_ID, equitiesStrategy } from './equities.js'
import { CRYPTO_MARKET_ID, cryptoStrategy } from './crypto.js'
import { ASIA_MARKET_ID, asiaStrategy } from './asia.js'
import { USA_MARKET_ID, usaStrategy } from './usa.js'

export const DEFAULT_MARKET_ID = EQUITIES_MARKET_ID

export const TRADING_STRATEGIES = {
  [EQUITIES_MARKET_ID]: equitiesStrategy,
  [CRYPTO_MARKET_ID]: cryptoStrategy,
  [USA_MARKET_ID]: usaStrategy,
  [ASIA_MARKET_ID]: asiaStrategy,
}

export function getTradingStrategy(marketId = DEFAULT_MARKET_ID) {
  return TRADING_STRATEGIES[marketId] || TRADING_STRATEGIES[DEFAULT_MARKET_ID]
}
