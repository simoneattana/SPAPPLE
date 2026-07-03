export function getEodhdSymbol(ticker) {
  if (typeof ticker !== 'string') {
    return ticker
  }

  if (ticker.endsWith('.DE')) {
    return ticker.replace(/\.DE$/, '.XETRA')
  }

  return ticker
}
