function cryptoAsset(
  symbol,
  coingeckoId,
  name,
  sector,
  description,
  krakenPair = `${symbol}EUR`,
  options = {},
) {
  return {
    ticker: `${symbol}/EUR`,
    krakenPair,
    coingeckoId,
    name,
    sector,
    description,
    tradeEnabled: options.tradeEnabled !== false,
    role: options.role || 'operativo',
  }
}

export function normalizeCryptoPair(value = '') {
  return String(value).replace(/[^a-z0-9]/gi, '').toUpperCase()
}

export function getCryptoMappingWarning(meta) {
  if (!meta?.ticker || !meta?.krakenPair) {
    return 'Mapping incompleto: ticker o coppia Kraken mancante.'
  }

  const visiblePair = normalizeCryptoPair(meta.ticker)
  const krakenPair = normalizeCryptoPair(meta.krakenPair)

  if (visiblePair === krakenPair) {
    return null
  }

  return `Mapping verificato: in app vedi ${meta.ticker}, ma Kraken usa ${meta.krakenPair}.`
}

export const CRYPTO_TICKERS = [
  cryptoAsset('BTC', 'bitcoin', 'Bitcoin', 'Riserva digitale', 'Asset digitale decentralizzato con maggiore capitalizzazione e liquidità.', 'XBTEUR'),
  cryptoAsset('ETH', 'ethereum', 'Ethereum', 'Smart contract', 'Rete blockchain programmabile usata per applicazioni decentralizzate.'),
  cryptoAsset('USDC', 'usd-coin', 'USDC', 'Stablecoin', 'Stablecoin ancorata al dollaro: usata come riferimento di liquidità, non per ingressi automatici.', 'USDCEUR', {
    tradeEnabled: false,
    role: 'liquidità',
  }),
  cryptoAsset('BNB', 'binancecoin', 'BNB', 'Exchange ecosystem', 'Token collegato all’ecosistema Binance e a infrastrutture blockchain compatibili.'),
  cryptoAsset('ADA', 'cardano', 'Cardano', 'Smart contract', 'Protocollo blockchain proof-of-stake con sviluppo accademico e modulare.'),
  cryptoAsset('POL', 'polygon-ecosystem-token', 'Polygon (ex MATIC)', 'Layer 2', 'Token dell’ecosistema Polygon, successore operativo di MATIC per scalabilità Ethereum.', 'POLEUR'),
  cryptoAsset('SOL', 'solana', 'Solana', 'Smart contract', 'Blockchain ad alta velocità orientata ad applicazioni e finanza decentralizzata.'),
  cryptoAsset('XRP', 'ripple', 'XRP', 'Pagamenti', 'Asset digitale orientato a trasferimenti rapidi e infrastrutture di pagamento.'),
  cryptoAsset('TRX', 'tron', 'TRON', 'Smart contract', 'Rete blockchain focalizzata su trasferimenti digitali e stablecoin.'),
  cryptoAsset('AVAX', 'avalanche-2', 'Avalanche', 'Smart contract', 'Piattaforma per applicazioni decentralizzate e subnet blockchain.'),
  cryptoAsset('LINK', 'chainlink', 'Chainlink', 'Oracoli', 'Rete di oracoli che collega dati esterni e smart contract.'),
  cryptoAsset('DOT', 'polkadot', 'Polkadot', 'Interoperabilità', 'Rete progettata per connettere blockchain diverse tramite parachain.'),
  cryptoAsset('LTC', 'litecoin', 'Litecoin', 'Pagamenti', 'Criptovaluta storica focalizzata su pagamenti rapidi e costi contenuti.'),
]

export const CRYPTO_LEGACY_TICKERS = [
  cryptoAsset('DOGE', 'dogecoin', 'Dogecoin', 'Legacy monitoraggio', 'Asset rimosso dalla watchlist operativa ma ancora monitorabile per chiudere vecchie posizioni.', 'XDGEUR', {
    tradeEnabled: false,
    role: 'legacy',
  }),
  cryptoAsset('PEPE', 'pepe', 'Pepe', 'Legacy monitoraggio', 'Asset rimosso dalla watchlist operativa ma ancora monitorabile per storico o vecchie posizioni.', 'PEPEEUR', {
    tradeEnabled: false,
    role: 'legacy',
  }),
  cryptoAsset('MATIC', 'matic-network', 'MATIC', 'Legacy monitoraggio', 'Ticker storico di Polygon, mantenuto solo per eventuali vecchie posizioni e letto tramite la coppia POL/EUR.', 'POLEUR', {
    tradeEnabled: false,
    role: 'legacy',
  }),
]

export const CRYPTO_PRICE_TICKERS = [
  ...CRYPTO_TICKERS,
  ...CRYPTO_LEGACY_TICKERS,
]

export function getCryptoMeta(input) {
  if (typeof input === 'object' && input !== null) {
    return input
  }

  return CRYPTO_PRICE_TICKERS.find(
    (item) => item.ticker === input || item.krakenPair === input,
  )
}

export const CRYPTO_UNIVERSE_STATS = {
  total: CRYPTO_TICKERS.length,
  mappedWithKrakenAlias: CRYPTO_TICKERS.filter(getCryptoMappingWarning).length,
}
