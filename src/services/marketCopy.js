const marketCopies = {
  equities: {
    label: 'Azioni Europa',
    eyebrow: 'Mercato azionario',
    assetSingular: 'titolo',
    assetPlural: 'titoli',
    assetType: 'societa',
    provider: 'EODHD / Yahoo Finance',
    scanMode: 'EOD',
    scanDescription:
      'Analisi su azioni europee con P/E positivo, prezzo di chiusura, RSI e ATR.',
    diagnosticDescription:
      'Dopo l’avvio vedrai per ogni titolo se è stato ammesso, scartato per RSI neutrale, scartato per P/E o escluso per dati non disponibili.',
    glossary: [
      {
        term: 'P/E',
        description:
          'Rapporto prezzo/utili: se è assente o non positivo, il titolo viene scartato.',
      },
      {
        term: 'Take Profit',
        description:
          'Prezzo target: se viene raggiunto, il sistema chiude in utile.',
      },
      {
        term: 'Stop Loss',
        description:
          'Prezzo di sicurezza: se viene raggiunto, il sistema chiude per limitare la perdita.',
      },
      {
        term: 'RSI',
        description:
          'Indicatore di temperatura: sotto 30 segnala possibile rimbalzo, sopra 70 possibile eccesso.',
      },
      {
        term: 'ATR',
        description:
          'Misura la volatilità media e aiuta a calibrare target e stop loss.',
      },
      {
        term: 'Short',
        description:
          'Posizione al ribasso: simula un’operazione che guadagna se il prezzo scende.',
      },
    ],
  },
  crypto: {
    label: 'Crypto',
    eyebrow: 'Mercato crypto',
    assetSingular: 'asset crypto',
    assetPlural: 'asset crypto',
    assetType: 'crypto',
    provider: 'Kraken',
    scanMode: '24/7',
    budgetReason:
      'Budget iniziale separato di 20.000€: non deriva dalle azioni e serve a misurare la strategia crypto senza contaminare il capitale azionario.',
    scanDescription:
      'Analisi su coppie crypto/EUR liquide con dati Kraken, RSI e ATR. Il P/E non esiste sulle crypto.',
    diagnosticDescription:
      'Dopo l’avvio vedrai per ogni asset crypto se è stato ammesso, scartato per RSI neutrale, scartato per liquidità o escluso per dati Kraken non disponibili.',
    glossary: [
      {
        term: 'Liquidità',
        description:
          'Filtro sul volume giornaliero in euro: evita asset troppo sottili o difficili da simulare.',
      },
      {
        term: 'Take Profit Crypto',
        description:
          'Target dinamico più ampio rispetto alle azioni, perché le crypto oscillano di più.',
      },
      {
        term: 'Stop Loss Crypto',
        description:
          'Soglia di sicurezza calibrata con ATR e più larga rispetto alle azioni.',
      },
      {
        term: 'RSI',
        description:
          'Indicatore di eccesso: sotto 30 cerca rimbalzo, sopra 70 cerca correzione.',
      },
      {
        term: 'ATR',
        description:
          'Misura la volatilità crypto e decide se il pilota può aprire la posizione.',
      },
      {
        term: 'Mercato 24/7',
        description:
          'Le crypto non chiudono la sera: il monitor può controllare prezzi in modo continuativo.',
      },
    ],
  },
  usa: {
    label: 'Borsa USA',
    eyebrow: 'Mercato azionario USA',
    assetSingular: 'titolo USA',
    assetPlural: 'titoli USA',
    assetType: 'societa',
    provider: 'EODHD',
    scanMode: 'NYSE / Nasdaq',
    budgetReason:
      'Budget separato in euro, con prezzi operativi in USD e controvalore EUR calcolato tramite Forex EODHD.',
    scanDescription:
      'Analisi su azioni USA con P/E positivo, prezzo in USD, cambio EUR, RSI e ATR.',
    diagnosticDescription:
      'Dopo l’avvio vedrai per ogni titolo USA se è stato ammesso, scartato per RSI neutrale, scartato per P/E o escluso per dati non disponibili.',
    glossary: [
      {
        term: 'Prezzo USD',
        description:
          'Prezzo originale del titolo nel mercato USA. Il controvalore in euro viene calcolato a fianco.',
      },
      {
        term: 'Cambio EUR',
        description:
          'Tasso Forex EODHD usato per convertire USD in euro.',
      },
      {
        term: 'P/E',
        description:
          'Rapporto prezzo/utili: se è assente o non positivo, il titolo viene scartato.',
      },
      {
        term: 'RSI',
        description:
          'Indicatore di temperatura: su Tokyo e Hong Kong sotto 35 segnala possibile rimbalzo, sopra 65 possibile eccesso. Il pilota automatico resta più selettivo.',
      },
      {
        term: 'ATR',
        description:
          'Misura la volatilità media e aiuta a calibrare target e stop loss.',
      },
    ],
  },
  asia: {
    label: 'Borse Asia',
    eyebrow: 'Mercato azionario Asia',
    assetSingular: 'titolo asiatico',
    assetPlural: 'titoli asiatici',
    assetType: 'societa',
    provider: 'EODHD',
    scanMode: 'Asia',
    budgetReason:
      'Budget separato in euro, con prezzi in valuta locale e controvalore EUR calcolato tramite Forex EODHD.',
    scanDescription:
      'Analisi su azioni asiatiche con P/E positivo, prezzo in valuta locale, cambio EUR, RSI e ATR.',
    diagnosticDescription:
      'Dopo l’avvio vedrai per ogni titolo asiatico se è stato ammesso, scartato per RSI neutrale, scartato per P/E o escluso per dati non disponibili.',
    glossary: [
      {
        term: 'Valuta locale',
        description:
          'Il titolo resta espresso nella valuta del mercato, ad esempio JPY per Tokyo o HKD per Hong Kong.',
      },
      {
        term: 'Cambio EUR',
        description:
          'Tasso Forex EODHD usato per convertire la valuta locale in euro.',
      },
      {
        term: 'P/E',
        description:
          'Rapporto prezzo/utili: se è assente o non positivo, il titolo viene scartato.',
      },
      {
        term: 'RSI',
        description:
          'Indicatore di temperatura: sotto 30 segnala possibile rimbalzo, sopra 70 possibile eccesso.',
      },
      {
        term: 'ATR',
        description:
          'Misura la volatilità media e aiuta a calibrare target e stop loss.',
      },
    ],
  },
}

export function getMarketCopy(marketId = 'equities') {
  return marketCopies[marketId] || marketCopies.equities
}
