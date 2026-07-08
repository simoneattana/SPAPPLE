export function getEodhdSymbol(ticker) {
  if (typeof ticker !== 'string') {
    return ticker
  }

  if (ticker.endsWith('.DE')) {
    return ticker.replace(/\.DE$/, '.XETRA')
  }

  return ticker
}

const EODHD_UNSUPPORTED_SUFFIXES = ['.MI', '.TSE']

export function shouldUseEodhdForTicker(ticker) {
  if (typeof ticker !== 'string') {
    return true
  }

  const normalizedTicker = ticker.toUpperCase()

  return !EODHD_UNSUPPORTED_SUFFIXES.some((suffix) =>
    normalizedTicker.endsWith(suffix),
  )
}

export function getYahooSymbol(ticker) {
  if (typeof ticker !== 'string') {
    return ticker
  }

  if (ticker.endsWith('.US')) {
    return ticker.replace(/\.US$/, '')
  }

  if (ticker.endsWith('.TSE')) {
    return ticker.replace(/\.TSE$/, '.T')
  }

  return ticker
}
