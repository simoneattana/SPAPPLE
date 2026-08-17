// Economia di un'operazione Spapple, sotto il listino IBKR Pro Tiered.
// Tutto in percentuale del controvalore, andata e ritorno.

const HKD_EUR = 0.11
const USD_EUR = 0.92

// spread applicato dal modello attuale, per lato
const SPREAD = { equities: 0.0003, usa: 0.0002, asia: 0.0005 }
const SLIPPAGE_ATR_RATIO = 0.05 // 5% dell'ATR giornaliero, per lato

function commissioneIbkr(mercato, notionalEur) {
  switch (mercato) {
    case 'xetra':
      return Math.min(Math.max(notionalEur * 0.0005, 1.25), 29)
    case 'six':
      return Math.max(notionalEur * 0.0005, 1.6) // CHF 1,50
    case 'milano':
      return Math.max(notionalEur * 0.0005, 1.25)
    case 'usa':
      // minimo 0,35 USD per eseguito: su posizioni piccole domina sempre
      return 0.35 * USD_EUR
    case 'hongkong':
      return Math.max(notionalEur * 0.0005, 18 * HKD_EUR)
    case 'tokyo':
      return Math.max(notionalEur * 0.0005, 80 * 0.0058) // JPY 80
    default:
      return notionalEur * 0.0005
  }
}

// imposte di stato, andata e ritorno, in percentuale
const IMPOSTE = {
  milano: 0.001, // Tobin 0,10% sugli acquisti
  hongkong: 0.002, // bollo 0,10% su entrambi i lati
  xetra: 0,
  six: 0,
  usa: 0.0000278, // SEC sulle vendite, trascurabile
  tokyo: 0,
}

const GRUPPO = {
  milano: 'equities',
  xetra: 'equities',
  six: 'equities',
  usa: 'usa',
  hongkong: 'asia',
  tokyo: 'asia',
}

function costoGiro({ mercato, notionalEur, atrPct, fx }) {
  const gruppo = GRUPPO[mercato]
  const commissione = (commissioneIbkr(mercato, notionalEur) * 2) / notionalEur
  const spread = SPREAD[gruppo] * 2
  const slippage = (atrPct / 100) * SLIPPAGE_ATR_RATIO * 2
  const imposte = IMPOSTE[mercato]
  const cambio =
    fx === 'nessuno'
      ? 0
      : fx === 'auto'
        ? 0.0003 * 2
        : (2 * USD_EUR * 2) / notionalEur // manuale, minimo 2 USD per lato

  return {
    commissione,
    spread,
    slippage,
    imposte,
    cambio,
    totale: commissione + spread + slippage + imposte + cambio,
  }
}

const pct = (x) => (x * 100).toFixed(3) + '%'

console.log('COSTO DI UN GIRO COMPLETO, IBKR, posizione da 3.000 EUR, ATR 1,5%\n')
console.log(
  ['mercato'.padEnd(12), 'commis.'.padStart(8), 'spread'.padStart(8), 'slipp.'.padStart(8), 'imposte'.padStart(8), 'cambio'.padStart(8), 'TOTALE'.padStart(9)].join(' '),
)
const casi = [
  ['xetra', 'nessuno'],
  ['milano', 'nessuno'],
  ['six', 'auto'],
  ['usa', 'auto'],
  ['hongkong', 'auto'],
  ['tokyo', 'auto'],
]
for (const [mercato, fx] of casi) {
  const c = costoGiro({ mercato, notionalEur: 3000, atrPct: 1.5, fx })
  console.log(
    [
      mercato.padEnd(12),
      pct(c.commissione).padStart(8),
      pct(c.spread).padStart(8),
      pct(c.slippage).padStart(8),
      pct(c.imposte).padStart(8),
      pct(c.cambio).padStart(8),
      pct(c.totale).padStart(9),
    ].join(' '),
  )
}

console.log('\nCONFRONTO CON IL MODELLO ATTUALE (Directa): 0,850% misurato sulle 25 operazioni')

console.log('\n\nGEOMETRIA: quanto deve andare bene per non perdere\n')
console.log(
  ['profilo'.padEnd(26), 'target'.padStart(8), 'stop'.padStart(9), 'rapporto'.padStart(9), 'vittorie necessarie'.padStart(20)].join(' '),
)
const profili = [
  ['Azioni, ATR 1,0%', 0.35, 1.2 * 1.0],
  ['Azioni, ATR 1,4%', 0.35, 1.2 * 1.4],
  ['Azioni, ATR 2,0%', 0.6, 1.5 * 2.0],
  ['Azioni, ATR 3,0%', 0.6, 1.5 * 3.0],
  ['Target massimo, ATR 1,0%', 0.8, 1.2 * 1.0],
  ['Target massimo, ATR 2,0%', 1.2, 1.5 * 2.0],
]
for (const [nome, target, stop] of profili) {
  const rapporto = stop / target
  const necessarie = (stop / (stop + target)) * 100
  console.log(
    [
      nome.padEnd(26),
      (target.toFixed(2) + '%').padStart(8),
      (stop.toFixed(2) + '%').padStart(9),
      ('1 : ' + rapporto.toFixed(1)).padStart(9),
      (necessarie.toFixed(0) + '%').padStart(20),
    ].join(' '),
  )
}
console.log('\nvittorie misurate sulle 25 operazioni reali: 24%')

console.log('\n\nGEOMETRIE ALTERNATIVE, a parita di ATR 1,5%\n')
console.log(['proposta'.padEnd(30), 'target'.padStart(8), 'stop'.padStart(8), 'vittorie necessarie'.padStart(20)].join(' '))
const alternative = [
  ['attuale: 0,6% / 1,5 ATR', 0.6, 2.25],
  ['stop stretto: 0,6% / 0,4 ATR', 0.6, 0.6],
  ['simmetrica: 1 ATR / 1 ATR', 1.5, 1.5],
  ['swing: 2 ATR / 1 ATR', 3.0, 1.5],
  ['swing largo: 3 ATR / 1,5 ATR', 4.5, 2.25],
]
for (const [nome, target, stop] of alternative) {
  const necessarie = (stop / (stop + target)) * 100
  console.log(
    [
      nome.padEnd(30),
      (target.toFixed(2) + '%').padStart(8),
      (stop.toFixed(2) + '%').padStart(8),
      (necessarie.toFixed(0) + '%').padStart(20),
    ].join(' '),
  )
}

console.log('\n\nEFFETTO DELLA DIMENSIONE sui costi fissi (Hong Kong, ATR 1,5%, cambio manuale)\n')
for (const size of [1500, 3000, 6000, 12000, 25000]) {
  const c = costoGiro({ mercato: 'hongkong', notionalEur: size, atrPct: 1.5, fx: 'manuale' })
  console.log(`  ${String(size).padStart(6)} EUR  ->  ${pct(c.totale)}`)
}
