function cryptoAsset(
  symbol,
  coingeckoId,
  name,
  sector,
  description,
  krakenPair = `${symbol}EUR`,
) {
  return {
    ticker: `${symbol}/EUR`,
    krakenPair,
    coingeckoId,
    name,
    sector,
    description,
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
  cryptoAsset('SOL', 'solana', 'Solana', 'Smart contract', 'Blockchain ad alta velocità orientata ad applicazioni e finanza decentralizzata.'),
  cryptoAsset('XRP', 'ripple', 'XRP', 'Pagamenti', 'Asset digitale orientato a trasferimenti rapidi e infrastrutture di pagamento.'),
  cryptoAsset('BNB', 'binancecoin', 'BNB', 'Exchange ecosystem', 'Token collegato all’ecosistema Binance e a infrastrutture blockchain compatibili.'),
  cryptoAsset('DOGE', 'dogecoin', 'Dogecoin', 'Pagamenti', 'Asset digitale ad alta notorietà e volatilità, nato come meme coin.', 'XDGEUR'),
  cryptoAsset('ADA', 'cardano', 'Cardano', 'Smart contract', 'Protocollo blockchain proof-of-stake con sviluppo accademico e modulare.'),
  cryptoAsset('TRX', 'tron', 'TRON', 'Smart contract', 'Rete blockchain focalizzata su trasferimenti digitali e stablecoin.'),
  cryptoAsset('AVAX', 'avalanche-2', 'Avalanche', 'Smart contract', 'Piattaforma per applicazioni decentralizzate e subnet blockchain.'),
  cryptoAsset('LINK', 'chainlink', 'Chainlink', 'Oracoli', 'Rete di oracoli che collega dati esterni e smart contract.'),
  cryptoAsset('DOT', 'polkadot', 'Polkadot', 'Interoperabilità', 'Rete progettata per connettere blockchain diverse tramite parachain.'),
  cryptoAsset('BCH', 'bitcoin-cash', 'Bitcoin Cash', 'Pagamenti', 'Fork di Bitcoin orientato a transazioni on-chain a basso costo.'),
  cryptoAsset('LTC', 'litecoin', 'Litecoin', 'Pagamenti', 'Criptovaluta storica focalizzata su pagamenti rapidi e costi contenuti.'),
  cryptoAsset('UNI', 'uniswap', 'Uniswap', 'DeFi', 'Token di governance collegato a uno dei principali exchange decentralizzati.'),
  cryptoAsset('AAVE', 'aave', 'Aave', 'DeFi', 'Protocollo decentralizzato per prestiti e liquidità crypto.'),
  cryptoAsset('XLM', 'stellar', 'Stellar', 'Pagamenti', 'Rete per pagamenti e trasferimenti cross-border a basso costo.'),
  cryptoAsset('ETC', 'ethereum-classic', 'Ethereum Classic', 'Smart contract', 'Blockchain proof-of-work nata dalla rete storica Ethereum.'),
  cryptoAsset('ATOM', 'cosmos', 'Cosmos', 'Interoperabilità', 'Ecosistema blockchain modulare basato su comunicazione tra chain.'),
  cryptoAsset('ALGO', 'algorand', 'Algorand', 'Smart contract', 'Blockchain proof-of-stake orientata a scalabilità e finalità rapida.'),
  cryptoAsset('FIL', 'filecoin', 'Filecoin', 'Storage decentralizzato', 'Rete decentralizzata per archiviazione dati e infrastruttura Web3.'),
  cryptoAsset('ICP', 'internet-computer', 'Internet Computer', 'Infrastruttura', 'Protocollo orientato a calcolo decentralizzato e applicazioni on-chain.'),
  cryptoAsset('NEAR', 'near', 'NEAR Protocol', 'Smart contract', 'Blockchain layer 1 orientata a scalabilità e sviluppo applicativo.'),
  cryptoAsset('ARB', 'arbitrum', 'Arbitrum', 'Layer 2', 'Soluzione layer 2 per scalare Ethereum con costi inferiori.'),
  cryptoAsset('OP', 'optimism', 'Optimism', 'Layer 2', 'Ecosistema layer 2 Ethereum basato su optimistic rollup.'),
  cryptoAsset('INJ', 'injective-protocol', 'Injective', 'DeFi', 'Blockchain focalizzata su finanza decentralizzata e mercati on-chain.'),
  cryptoAsset('SUI', 'sui', 'Sui', 'Smart contract', 'Blockchain layer 1 orientata a prestazioni elevate e oggetti digitali.'),
  cryptoAsset('APT', 'aptos', 'Aptos', 'Smart contract', 'Blockchain layer 1 nata per applicazioni scalabili e finalità rapida.'),
  cryptoAsset('SEI', 'sei-network', 'Sei', 'Trading infrastructure', 'Blockchain ottimizzata per scambi, mercati e applicazioni finanziarie.'),
  cryptoAsset('TIA', 'celestia', 'Celestia', 'Modular blockchain', 'Rete modulare per disponibilità dati e infrastrutture blockchain.'),
  cryptoAsset('FET', 'fetch-ai', 'Fetch.ai', 'AI crypto', 'Token collegato a infrastrutture AI e agenti decentralizzati.'),
  cryptoAsset('RENDER', 'render-token', 'Render', 'GPU network', 'Rete decentralizzata per rendering e calcolo GPU.'),
  cryptoAsset('GRT', 'the-graph', 'The Graph', 'Data indexing', 'Protocollo per indicizzazione e interrogazione di dati blockchain.'),
  cryptoAsset('LDO', 'lido-dao', 'Lido DAO', 'Liquid staking', 'Protocollo di liquid staking e governance collegata.'),
  cryptoAsset('COMP', 'compound-governance-token', 'Compound', 'DeFi', 'Protocollo decentralizzato per prestiti e mercati monetari.'),
  cryptoAsset('SNX', 'havven', 'Synthetix', 'Derivati DeFi', 'Protocollo DeFi per asset sintetici e liquidità derivata.'),
  cryptoAsset('CRV', 'curve-dao-token', 'Curve DAO', 'DeFi', 'Token di governance collegato a pool di liquidità e stable swap.'),
  cryptoAsset('DYDX', 'dydx-chain', 'dYdX', 'Derivati DeFi', 'Infrastruttura per trading decentralizzato di derivati.'),
  cryptoAsset('ENS', 'ethereum-name-service', 'Ethereum Name Service', 'Identità Web3', 'Protocollo per nomi leggibili e identità su Ethereum.'),
  cryptoAsset('MANA', 'decentraland', 'Decentraland', 'Metaverso', 'Token collegato a mondi virtuali e asset digitali.'),
  cryptoAsset('SAND', 'the-sandbox', 'The Sandbox', 'Gaming', 'Token dell’ecosistema gaming e mondi virtuali The Sandbox.'),
  cryptoAsset('AXS', 'axie-infinity', 'Axie Infinity', 'Gaming', 'Token collegato a gaming Web3 e governance di ecosistema.'),
  cryptoAsset('CHZ', 'chiliz', 'Chiliz', 'Fan token', 'Infrastruttura per fan token e sport entertainment.'),
  cryptoAsset('GALA', 'gala', 'Gala', 'Gaming', 'Ecosistema crypto legato a gaming e intrattenimento digitale.'),
  cryptoAsset('ENJ', 'enjincoin', 'Enjin Coin', 'Gaming', 'Token collegato a NFT, gaming e beni digitali.'),
  cryptoAsset('BAT', 'basic-attention-token', 'Basic Attention Token', 'Advertising', 'Token collegato a pubblicità digitale e browser Brave.'),
  cryptoAsset('ZEC', 'zcash', 'Zcash', 'Privacy', 'Criptovaluta orientata alla privacy e transazioni schermate.'),
  cryptoAsset('DASH', 'dash', 'Dash', 'Pagamenti', 'Criptovaluta storica orientata a pagamenti rapidi.'),
  cryptoAsset('XMR', 'monero', 'Monero', 'Privacy', 'Asset digitale focalizzato su privacy e fungibilità.'),
  cryptoAsset('FLOW', 'flow', 'Flow', 'NFT e gaming', 'Blockchain orientata ad applicazioni consumer, NFT e gaming.'),
  cryptoAsset('KSM', 'kusama', 'Kusama', 'Interoperabilità', 'Rete sperimentale collegata all’ecosistema Polkadot.'),
  cryptoAsset('QTUM', 'qtum', 'Qtum', 'Smart contract', 'Blockchain che combina modelli Bitcoin e smart contract.'),
  cryptoAsset('EGLD', 'elrond-erd-2', 'MultiversX', 'Smart contract', 'Blockchain ad alte prestazioni per applicazioni digitali.'),
  cryptoAsset('APE', 'apecoin', 'ApeCoin', 'NFT ecosystem', 'Token collegato a community NFT e iniziative Web3.'),
  cryptoAsset('PEPE', 'pepe', 'Pepe', 'Meme coin', 'Meme coin molto volatile e ad alto rischio operativo.'),
  cryptoAsset('SHIB', 'shiba-inu', 'Shiba Inu', 'Meme coin', 'Asset meme ad alta notorietà e volatilità.'),
  cryptoAsset('BONK', 'bonk', 'Bonk', 'Meme coin', 'Meme coin dell’ecosistema Solana con forte volatilità.'),
  cryptoAsset('WIF', 'dogwifcoin', 'dogwifhat', 'Meme coin', 'Meme coin Solana ad alta volatilità e liquidità variabile.'),
  cryptoAsset('FLOKI', 'floki', 'Floki', 'Meme coin', 'Asset meme con ecosistema marketing e utilità Web3.'),
  cryptoAsset('JUP', 'jupiter-exchange-solana', 'Jupiter', 'DeFi', 'Token collegato all’aggregatore DeFi dell’ecosistema Solana.'),
  cryptoAsset('PYTH', 'pyth-network', 'Pyth Network', 'Oracoli', 'Rete di oracoli per dati finanziari e mercati on-chain.'),
  cryptoAsset('RUNE', 'thorchain', 'THORChain', 'DeFi cross-chain', 'Protocollo per liquidità e scambi cross-chain.'),
  cryptoAsset('XTZ', 'tezos', 'Tezos', 'Smart contract', 'Blockchain proof-of-stake con governance on-chain.'),
  cryptoAsset('MINA', 'mina-protocol', 'Mina', 'Zero knowledge', 'Blockchain leggera basata su prove crittografiche compatte.'),
  cryptoAsset('KAVA', 'kava', 'Kava', 'DeFi', 'Ecosistema DeFi e layer 1 compatibile con più ambienti.'),
  cryptoAsset('IMX', 'immutable-x', 'Immutable', 'Gaming', 'Infrastruttura layer 2 per gaming Web3 e NFT.'),
  cryptoAsset('STRK', 'starknet', 'Starknet', 'Layer 2', 'Layer 2 Ethereum basato su prove zero knowledge.'),
  cryptoAsset('STX', 'blockstack', 'Stacks', 'Bitcoin layer', 'Protocollo per smart contract e applicazioni collegate a Bitcoin.'),
  cryptoAsset('WLD', 'worldcoin-wld', 'Worldcoin', 'Identità digitale', 'Token collegato a identità digitale e rete globale.'),
  cryptoAsset('TAO', 'bittensor', 'Bittensor', 'AI crypto', 'Rete decentralizzata focalizzata su modelli e servizi AI.'),
  cryptoAsset('HBAR', 'hedera-hashgraph', 'Hedera', 'Enterprise blockchain', 'Rete pubblica orientata a casi d’uso enterprise.'),
  cryptoAsset('VET', 'vechain', 'VeChain', 'Supply chain', 'Blockchain focalizzata su supply chain e tracciabilità.'),
  cryptoAsset('ONDO', 'ondo-finance', 'Ondo', 'Real world assets', 'Protocollo collegato a tokenizzazione di asset finanziari reali.'),
  cryptoAsset('PENDLE', 'pendle', 'Pendle', 'DeFi yield', 'Protocollo DeFi per mercati sul rendimento futuro.'),
  cryptoAsset('JASMY', 'jasmycoin', 'JasmyCoin', 'Data economy', 'Token collegato a gestione dati e infrastrutture IoT.'),
  cryptoAsset('LRC', 'loopring', 'Loopring', 'Layer 2', 'Protocollo layer 2 per scambi e pagamenti su Ethereum.'),
  cryptoAsset('ANKR', 'ankr', 'Ankr', 'Infrastruttura', 'Infrastruttura Web3 per nodi, RPC e servizi blockchain.'),
  cryptoAsset('1INCH', '1inch', '1inch', 'DeFi', 'Aggregatore decentralizzato per scambi e liquidità.'),
  cryptoAsset('BAL', 'balancer', 'Balancer', 'DeFi', 'Protocollo AMM per pool di liquidità programmabili.'),
  cryptoAsset('BAND', 'band-protocol', 'Band Protocol', 'Oracoli', 'Rete di oracoli decentralizzati per dati esterni.'),
  cryptoAsset('KNC', 'kyber-network-crystal', 'Kyber Network', 'DeFi', 'Protocollo per liquidità e scambi decentralizzati.'),
  cryptoAsset('YFI', 'yearn-finance', 'yearn.finance', 'DeFi yield', 'Protocollo DeFi per strategie automatizzate di rendimento.'),
  cryptoAsset('SUSHI', 'sushi', 'Sushi', 'DeFi', 'Exchange decentralizzato e suite di prodotti DeFi.'),
  cryptoAsset('RPL', 'rocket-pool', 'Rocket Pool', 'Liquid staking', 'Protocollo decentralizzato per staking Ethereum.'),
  cryptoAsset('LPT', 'livepeer', 'Livepeer', 'Video infrastructure', 'Rete decentralizzata per transcodifica e infrastruttura video.'),
  cryptoAsset('API3', 'api3', 'API3', 'Oracoli', 'Rete per API decentralizzate e dati on-chain.'),
  cryptoAsset('OCEAN', 'ocean-protocol', 'Ocean Protocol', 'Data economy', 'Protocollo per dati, AI e marketplace decentralizzati.'),
  cryptoAsset('ZRX', '0x', '0x Protocol', 'DeFi', 'Protocollo per scambi decentralizzati e infrastrutture di liquidità.'),
  cryptoAsset('COTI', 'coti', 'COTI', 'Pagamenti', 'Infrastruttura per pagamenti digitali e reti finanziarie.'),
  cryptoAsset('CRO', 'crypto-com-chain', 'Cronos', 'Exchange ecosystem', 'Token dell’ecosistema Cronos e Crypto.com.'),
]

export const CRYPTO_UNIVERSE_STATS = {
  total: CRYPTO_TICKERS.length,
  mappedWithKrakenAlias: CRYPTO_TICKERS.filter(getCryptoMappingWarning).length,
}
