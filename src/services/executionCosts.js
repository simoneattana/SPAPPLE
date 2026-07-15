export const SLIPPAGE_ATR_RATIO = 0.05

export const SPREAD_PER_SIDE = {
  asia: 0.0005,
  equities: 0.0003,
  usa: 0.0002,
}

export const EXECUTION_COST_ASSUMPTIONS = [
  {
    commission: 'Italia: 1,9 per mille min 1,50 EUR, max 18 EUR. Germania/Cboe Europa: 0,025% min 9,50 EUR. Svizzera: 0,03% min 20 CHF.',
    id: 'equities',
    label: 'Europa',
    sourceLabel: 'Directa, pagina commissioni',
    sourceUrl: 'https://www.directa.it/commissioni',
    spread: '0,03% per lato',
  },
  {
    commission: '9 USD per ordine',
    id: 'usa',
    label: 'USA',
    sourceLabel: 'Directa, pagina commissioni',
    sourceUrl: 'https://www.directa.it/commissioni',
    spread: '0,02% per lato',
  },
  {
    commission: '0,15% del controvalore, min 10 EUR',
    id: 'asia',
    label: 'Asia',
    sourceLabel: 'Stima prudenziale interna Spapple',
    spread: '0,05% per lato',
  },
]

function round(value, digits = 4) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    return null
  }

  return Number(number.toFixed(digits))
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function getSpreadPct(marketId) {
  return SPREAD_PER_SIDE[marketId] || SPREAD_PER_SIDE.equities
}

function getAdverseDirection(type, phase) {
  if (type === 'LONG') {
    return phase === 'OPEN' ? 1 : -1
  }

  return phase === 'OPEN' ? -1 : 1
}

function getEquityCommissionProfile(ticker = '') {
  const normalizedTicker = String(ticker).toUpperCase()

  if (normalizedTicker.endsWith('.MI')) {
    return {
      brokerProfile: 'Directa Italia variabile MTA',
      maxEur: 18,
      minNative: 1.5,
      rate: 0.0019,
      note: 'Italia MTA: 1,9 per mille del controvalore, minimo 1,5 EUR, massimo 18 EUR per eseguito.',
    }
  }

  if (normalizedTicker.endsWith('.DE')) {
    return {
      brokerProfile: 'Directa Germania Xetra',
      minNative: 9.5,
      rate: 0.00025,
      note: 'Germania Xetra: 0,025% del controvalore, minimo 9,5 EUR per eseguito.',
    }
  }

  if (normalizedTicker.endsWith('.SW')) {
    return {
      brokerProfile: 'Directa Svizzera SIX',
      minNative: 20,
      rate: 0.0003,
      note: 'Svizzera SIX: 0,03% del controvalore, minimo 20 CHF per eseguito.',
    }
  }

  return {
    brokerProfile: 'Directa Europa Cboe',
    minNative: 9.5,
    rate: 0.00025,
    note: 'Europa Cboe: 0,025% del controvalore, minimo 9,5 EUR per eseguito.',
  }
}

function getCommission({ currency, fxToEur, marketId, notionalEur, ticker }) {
  const safeNotionalEur = Number.isFinite(Number(notionalEur))
    ? Math.max(Number(notionalEur), 0)
    : 0
  const safeFxToEur =
    Number.isFinite(Number(fxToEur)) && Number(fxToEur) > 0
      ? Number(fxToEur)
      : 1

  if (marketId === 'usa') {
    const native = 9

    return {
      brokerProfile: 'Directa USA fisso prudente',
      commissionEur: round(native * safeFxToEur),
      commissionNative: round(native),
      currency: currency || 'USD',
      note: 'Commissione fissa prudenziale di 9 USD per eseguito.',
    }
  }

  if (marketId === 'equities') {
    const profile = getEquityCommissionProfile(ticker)
    const minEur = profile.minNative * safeFxToEur
    const rawEur = safeNotionalEur * profile.rate
    const cappedEur = Number.isFinite(Number(profile.maxEur))
      ? Math.min(Math.max(rawEur, minEur), Number(profile.maxEur))
      : Math.max(rawEur, minEur)

    return {
      brokerProfile: profile.brokerProfile,
      commissionEur: round(cappedEur),
      commissionNative: round(cappedEur / safeFxToEur),
      currency: currency || 'EUR',
      note: profile.note,
    }
  }

  if (marketId === 'asia') {
    const eur = Math.max(safeNotionalEur * 0.0015, 10)

    return {
      brokerProfile: 'Asia stima prudente',
      commissionEur: round(eur),
      commissionNative: round(eur / safeFxToEur),
      currency: currency || 'EUR',
      note: 'Stima prudente: 0,15% del controvalore, minimo 10 EUR.',
    }
  }

  const eur = clamp(safeNotionalEur * 0.0019, 1.5, 18)

  return {
    brokerProfile: 'Directa variabile Italia',
    commissionEur: round(eur),
    commissionNative: round(eur / safeFxToEur),
    currency: currency || 'EUR',
    note: 'Profilo variabile: 1,9 per mille, minimo 1,5 EUR, massimo 18 EUR.',
  }
}

export function applyExecutionCosts({
  atr = 0,
  currency = 'EUR',
  fxToEur = 1,
  marketId = 'equities',
  notionalEur = null,
  phase,
  price,
  ticker = '',
  type,
}) {
  const marketPrice = Number(price)

  if (!Number.isFinite(marketPrice) || marketPrice <= 0) {
    throw new Error('Prezzo di esecuzione non valido')
  }

  const safeAtr = Number.isFinite(Number(atr)) && Number(atr) > 0 ? Number(atr) : 0
  const safeFxToEur =
    Number.isFinite(Number(fxToEur)) && Number(fxToEur) > 0
      ? Number(fxToEur)
      : 1
  const spreadPct = getSpreadPct(marketId)
  const spreadNative = marketPrice * spreadPct
  const slippageNative = safeAtr * SLIPPAGE_ATR_RATIO
  const pricePenaltyNative = spreadNative + slippageNative
  const direction = getAdverseDirection(type, phase)
  const effectivePrice = Math.max(marketPrice + direction * pricePenaltyNative, 0.0001)
  const effectivePriceEur = effectivePrice * safeFxToEur
  const estimatedNotionalEur =
    Number.isFinite(Number(notionalEur)) && Number(notionalEur) > 0
      ? Number(notionalEur)
      : effectivePriceEur
  const commission = getCommission({
    currency,
    fxToEur: safeFxToEur,
    marketId,
    notionalEur: estimatedNotionalEur,
    ticker,
  })

  return {
    brokerProfile: commission.brokerProfile,
    commissionEur: commission.commissionEur,
    commissionNative: commission.commissionNative,
    commissionNote: commission.note,
    currency: commission.currency,
    effectivePrice: round(effectivePrice),
    effectivePriceEur: round(effectivePriceEur),
    fxToEur: round(safeFxToEur, 8),
    marketId,
    marketPrice: round(marketPrice),
    marketPriceEur: round(marketPrice * safeFxToEur),
    notionalEur: round(estimatedNotionalEur),
    phase,
    pricePenaltyEur: round(pricePenaltyNative * safeFxToEur),
    pricePenaltyNative: round(pricePenaltyNative),
    sideEffect: direction > 0 ? 'prezzo aumentato' : 'prezzo ridotto',
    slippageEur: round(slippageNative * safeFxToEur),
    slippageNative: round(slippageNative),
    slippageRule: '5% ATR giornaliero per lato',
    spreadEur: round(spreadNative * safeFxToEur),
    spreadNative: round(spreadNative),
    spreadPct: round(spreadPct * 100, 4),
    type,
  }
}

export function getExecutionCommissionEur(executionCosts) {
  const value = Number(executionCosts?.commissionEur)

  return Number.isFinite(value) ? value : 0
}

export function getPositionOpenCommissionEur(position) {
  return getExecutionCommissionEur(position?.executionCosts?.open)
}
