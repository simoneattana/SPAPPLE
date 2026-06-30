export const marketThemes = {
  equities: {
    id: 'equities',
    label: 'Azioni Europa',
    accent: '#deff9a',
    accentSoft: 'rgba(222, 255, 154, 0.12)',
    accentBorder: 'rgba(222, 255, 154, 0.35)',
    accentHover: '#e7ffb8',
  },
  crypto: {
    id: 'crypto',
    label: 'Crypto',
    accent: '#67e8f9',
    accentSoft: 'rgba(103, 232, 249, 0.12)',
    accentBorder: 'rgba(103, 232, 249, 0.35)',
    accentHover: '#a5f3fc',
  },
}

export function getMarketTheme(marketId = 'equities') {
  return marketThemes[marketId] || marketThemes.equities
}
