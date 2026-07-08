export function getEodhdSymbol(ticker) {
  if (typeof ticker !== 'string') {
    return ticker
  }

  if (ticker.endsWith('.DE')) {
    return ticker.replace(/\.DE$/, '.XETRA')
  }

  return ticker
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
