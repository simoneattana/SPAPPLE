export const BASE_CURRENCY = 'EUR'

const currencyFormatters = new Map()
const numberFormatter = new Intl.NumberFormat('it-IT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})

function normalizeCurrency(currency = BASE_CURRENCY) {
  return String(currency || BASE_CURRENCY).toUpperCase()
}

export function getCurrencyFormatter(currency = BASE_CURRENCY) {
  const normalizedCurrency = normalizeCurrency(currency)

  if (!currencyFormatters.has(normalizedCurrency)) {
    currencyFormatters.set(
      normalizedCurrency,
      new Intl.NumberFormat('it-IT', {
        style: 'currency',
        currency: normalizedCurrency,
      }),
    )
  }

  return currencyFormatters.get(normalizedCurrency)
}

export function formatCurrencyAmount(value, currency = BASE_CURRENCY) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    return 'Non disponibile'
  }

  return getCurrencyFormatter(currency).format(number)
}

export function formatFxRate(value) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    return 'Non disponibile'
  }

  return numberFormatter.format(number)
}

export function convertToBaseCurrency(value, fxToEur = 1) {
  const amount = Number(value)
  const rate = Number(fxToEur)

  if (!Number.isFinite(amount) || !Number.isFinite(rate) || rate <= 0) {
    return null
  }

  return amount * rate
}

export async function fetchFxRateToEur(currency = BASE_CURRENCY) {
  const normalizedCurrency = normalizeCurrency(currency)

  if (normalizedCurrency === BASE_CURRENCY) {
    return {
      from: BASE_CURRENCY,
      to: BASE_CURRENCY,
      pair: 'EUREUR.FOREX',
      rate: 1,
      inverted: false,
      provider: 'EODHD',
    }
  }

  const response = await fetch(
    `/api/eodhd/forex?from=${encodeURIComponent(
      normalizedCurrency,
    )}&to=${BASE_CURRENCY}`,
  )
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.error || `${normalizedCurrency}/EUR non disponibile`)
  }

  const rate = Number(data.rate)

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`${normalizedCurrency}/EUR non valido`)
  }

  return {
    ...data,
    from: normalizedCurrency,
    to: BASE_CURRENCY,
    rate,
  }
}
