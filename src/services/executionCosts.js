// Costo di un'operazione, lato per lato.
//
// Modello broker: Interactive Brokers, piano Pro Tiered, scelto il 2026-08-11
// dopo il confronto con Directa, Degiro, Fineco e Kraken. Fino al 2026-08-17
// questo file conteneva il listino Directa, che non descriveva piu nessun
// intermediario in uso.
//
// Il costo si compone di cinque voci. Le prime due muovono il prezzo di
// esecuzione, le altre tre sono esborsi in contanti:
//
//   spread      il prezzo peggiora della meta del differenziale denaro-lettera
//   slittamento il prezzo peggiora ancora, per il tempo fra decisione ed esecuzione
//   commissione quanto trattiene il broker
//   cambio      quanto costa convertire la valuta
//   imposte     quanto trattiene lo Stato, che nessun broker puo ridurre
//
// piu una sesta che scatta solo sugli short tenuti oltre la giornata:
//
//   prestito    quanto costa farsi prestare i titoli venduti allo scoperto
//
// ATTENZIONE: due di questi numeri sono ipotesi, non misure. Stanno raccolti
// in ASSUNZIONI e vanno trattati come tali: sono dichiarati nel risultato di
// ogni calcolo perche l'interfaccia possa mostrarli come tali.

// --- Ipotesi dichiarate ------------------------------------------------------

export const ASSUNZIONI = {
  slippage: {
    id: 'slippage',
    valore: 0.05,
    unita: "frazione dell'ATR giornaliero, per lato",
    fonte: null,
    nota: "Nessuna fonte. In simulazione non esistono eseguiti veri con cui confrontarla, quindi non e verificabile finche non si opera davvero. E la voce piu pesante del modello: vale circa meta del costo totale su Europa e USA.",
  },
  prestitoTitoli: {
    id: 'prestito-titoli',
    valore: 0.005,
    unita: 'tasso annuo sul controvalore, solo per posizioni short',
    fonte: null,
    nota: "Stima per titoli facili da reperire. Sui titoli difficili puo essere molte volte tanto. Incide solo se una posizione short resta aperta oltre la giornata: sulle operazioni infragiornaliere vale zero.",
  },
}

export const SLIPPAGE_ATR_RATIO = ASSUNZIONI.slippage.valore
export const BORROW_ANNUAL_RATE = ASSUNZIONI.prestitoTitoli.valore

// --- Spread, per lato --------------------------------------------------------

export const SPREAD_PER_SIDE = {
  asia: 0.0005,
  equities: 0.0003,
  usa: 0.0002,
}

// --- Cambio valuta -----------------------------------------------------------
//
// IBKR converte in due modi. In automatico applica uno 0,03% al cambio, senza
// minimi. In manuale costa lo 0,002% con un minimo di 2 USD per conversione,
// quindi conviene solo sopra i 6.100 EUR circa, dove il minimo smette di pesare.
// Qui si modella la conversione automatica, che e quella che avviene se non si
// gestiscono a mano i saldi in valuta.

export const FX_AUTO_RATE = 0.0003
export const FX_MANUAL_RATE = 0.00002
export const FX_MANUAL_MIN_USD = 2

// --- Imposte di stato --------------------------------------------------------
//
// Non dipendono dal broker: cambiarlo non le riduce.

const IMPOSTE = [
  {
    id: 'tobin-italia',
    suffissi: ['.MI'],
    lato: 'ACQUISTO',
    aliquota: 0.001,
    etichetta: 'Tobin tax italiana',
    nota: 'Imposta italiana sulle transazioni finanziarie: 0,10% sugli acquisti di azioni italiane. Da verificare: per il 2026 e circolata una possibile revisione allo 0,20%.',
    fonte: 'Agenzia delle Entrate, imposta sulle transazioni finanziarie',
  },
  {
    id: 'bollo-hong-kong',
    suffissi: ['.HK'],
    lato: 'ENTRAMBI',
    aliquota: 0.001,
    etichetta: 'Stamp duty di Hong Kong',
    nota: 'Bollo di Hong Kong: 0,10% su entrambi i lati. Su un giro completo vale lo 0,20%, ed e la ragione principale per cui Hong Kong resta il mercato piu caro.',
    fonte: 'HKEX, trading tariffs',
  },
  {
    id: 'imposta-cina',
    suffissi: ['.SS', '.SZ'],
    lato: 'VENDITA',
    aliquota: 0.0005,
    etichetta: 'Imposta cinese sulle vendite',
    nota: 'Stamp duty cinese: 0,05% sulle sole vendite.',
    fonte: 'Shanghai/Shenzhen Stock Connect',
  },
  {
    id: 'sec-usa',
    suffissi: [],
    mercati: ['usa'],
    lato: 'VENDITA',
    aliquota: 0.0000278,
    etichetta: 'SEC fee',
    nota: 'Contributo SEC sulle vendite di titoli americani. Trascurabile ma reale.',
    fonte: 'SEC Section 31 fee',
  },
]

// --- Commissioni IBKR Pro Tiered, per borsa ----------------------------------
//
// Ogni riga porta la sua fonte. I minimi sono in valuta locale e vengono
// convertiti con il cambio del titolo, non con un tasso fisso.

const LISTINO = [
  {
    id: 'ibkr-eu',
    suffissi: ['.MI', '.PA', '.AS', '.BR', '.LS', '.MC', '.ST', '.CO', '.HE', '.OL'],
    etichetta: 'IBKR Europa',
    aliquota: 0.0005,
    minimoNativo: 1.25,
    valutaMinimo: 'EUR',
    nota: '0,05% del controvalore, minimo 1,25 EUR per eseguito.',
    fonte: 'IBKR, commissioni azioni europee (piano Tiered)',
  },
  {
    id: 'ibkr-xetra',
    suffissi: ['.DE', '.F'],
    etichetta: 'IBKR Xetra',
    aliquota: 0.0005,
    minimoNativo: 1.25,
    massimoNativo: 29,
    valutaMinimo: 'EUR',
    nota: '0,05% del controvalore, minimo 1,25 EUR, massimo 29 EUR per eseguito.',
    fonte: 'IBKR, commissioni azioni europee (piano Tiered)',
  },
  {
    id: 'ibkr-six',
    suffissi: ['.SW', '.VX'],
    etichetta: 'IBKR SIX Svizzera',
    aliquota: 0.0005,
    minimoNativo: 1.5,
    valutaMinimo: 'CHF',
    nota: '0,05% del controvalore, minimo 1,50 CHF per eseguito.',
    fonte: 'IBKR, commissioni azioni europee (piano Tiered)',
  },
  {
    id: 'ibkr-hk',
    suffissi: ['.HK'],
    etichetta: 'IBKR Hong Kong',
    aliquota: 0.0005,
    minimoNativo: 18,
    valutaMinimo: 'HKD',
    nota: '0,05% del controvalore, minimo 18 HKD per eseguito.',
    fonte: 'IBKR, commissioni azioni Hong Kong (SEHK)',
  },
  {
    id: 'ibkr-jp',
    suffissi: ['.TSE', '.T'],
    etichetta: 'IBKR Giappone',
    aliquota: 0.0005,
    minimoNativo: 80,
    valutaMinimo: 'JPY',
    nota: '0,05% del controvalore, minimo 80 JPY per eseguito.',
    fonte: 'IBKR, commissioni azioni giapponesi (TSEJ)',
  },
  {
    id: 'ibkr-cn',
    suffissi: ['.SS', '.SZ'],
    etichetta: 'IBKR Cina Stock Connect',
    aliquota: 0.0005,
    minimoNativo: 15,
    valutaMinimo: 'CNH',
    nota: '0,05% del controvalore, minimo 15 CNH per eseguito.',
    fonte: 'IBKR, commissioni Shanghai/Shenzhen Stock Connect',
  },
]

const LISTINO_USA = {
  id: 'ibkr-usa',
  etichetta: 'IBKR Stati Uniti',
  perAzione: 0.0035,
  minimoNativo: 0.35,
  valutaMinimo: 'USD',
  tettoPct: 0.01,
  nota: '0,0035 USD per azione, minimo 0,35 USD, mai oltre l1% del controvalore.',
  fonte: 'IBKR, commissioni azioni USA (piano Tiered)',
}

export const EXECUTION_COST_ASSUMPTIONS = [
  ...LISTINO.map((voce) => ({
    id: voce.id,
    label: voce.etichetta,
    commission: voce.nota,
    sourceLabel: voce.fonte,
    spread: null,
  })),
  {
    id: LISTINO_USA.id,
    label: LISTINO_USA.etichetta,
    commission: LISTINO_USA.nota,
    sourceLabel: LISTINO_USA.fonte,
    spread: '0,02% per lato',
  },
  ...IMPOSTE.map((voce) => ({
    id: voce.id,
    label: voce.etichetta,
    commission: voce.nota,
    sourceLabel: voce.fonte,
    spread: null,
  })),
  {
    id: 'cambio',
    label: 'Cambio valuta',
    commission: `Conversione automatica IBKR: ${(FX_AUTO_RATE * 100).toFixed(2)}% per lato, senza minimi. Si applica solo ai titoli non in euro.`,
    sourceLabel: 'IBKR, currency conversion',
    spread: null,
  },
  {
    id: ASSUNZIONI.slippage.id,
    label: 'Slittamento (ipotesi, non misurato)',
    commission: ASSUNZIONI.slippage.nota,
    sourceLabel: null,
    spread: `${(ASSUNZIONI.slippage.valore * 100).toFixed(0)}% dell'ATR per lato`,
  },
  {
    id: ASSUNZIONI.prestitoTitoli.id,
    label: 'Prestito titoli (ipotesi, non misurato)',
    commission: ASSUNZIONI.prestitoTitoli.nota,
    sourceLabel: null,
    spread: null,
  },
]

function round(value, digits = 4) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    return null
  }

  return Number(number.toFixed(digits))
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

function normalizza(ticker) {
  return String(ticker || '').toUpperCase()
}

function trovaListino(ticker, marketId) {
  const normalizzato = normalizza(ticker)
  const voce = LISTINO.find((riga) =>
    riga.suffissi.some((suffisso) => normalizzato.endsWith(suffisso)),
  )

  if (voce) {
    return voce
  }

  if (marketId === 'usa' || !normalizzato.includes('.')) {
    return LISTINO_USA
  }

  return LISTINO[0]
}

// Il lato dell'operazione in termini di acquisto o vendita, che serve alle
// imposte: un LONG compra all'apertura, uno SHORT compra alla chiusura.
function latoOperazione(type, phase) {
  if (type === 'LONG') {
    return phase === 'OPEN' ? 'ACQUISTO' : 'VENDITA'
  }

  return phase === 'OPEN' ? 'VENDITA' : 'ACQUISTO'
}

function getCommission({ fxToEur, marketId, notionalEur, price, ticker }) {
  const voce = trovaListino(ticker, marketId)
  const cambio = Number.isFinite(Number(fxToEur)) && Number(fxToEur) > 0 ? Number(fxToEur) : 1
  const controvalore = Math.max(Number(notionalEur) || 0, 0)

  if (voce.perAzione) {
    const prezzoEur = Number(price) * cambio
    const quantita = prezzoEur > 0 ? controvalore / prezzoEur : 0
    const minimoEur = voce.minimoNativo * cambio
    const tettoEur = controvalore * voce.tettoPct
    const grezzoEur = quantita * voce.perAzione * cambio
    const commissioneEur = Math.min(Math.max(grezzoEur, minimoEur), tettoEur || Infinity)

    return {
      brokerProfile: voce.etichetta,
      commissionEur: round(commissioneEur),
      commissionNative: round(commissioneEur / cambio),
      note: voce.nota,
      source: voce.fonte,
    }
  }

  // I minimi in valuta diversa da quella del titolo non sono convertibili con
  // il solo cambio disponibile: in quel caso il minimo si applica come se
  // fosse gia in valuta del titolo, ed e un'approssimazione dichiarata.
  const minimoEur = voce.minimoNativo * cambio
  const massimoEur = voce.massimoNativo ? voce.massimoNativo * cambio : Infinity
  const grezzoEur = controvalore * voce.aliquota
  const commissioneEur = Math.min(Math.max(grezzoEur, minimoEur), massimoEur)

  return {
    brokerProfile: voce.etichetta,
    commissionEur: round(commissioneEur),
    commissionNative: round(commissioneEur / cambio),
    note: voce.nota,
    source: voce.fonte,
  }
}

export function getFxCostEur({ currency, notionalEur }) {
  const valuta = String(currency || 'EUR').toUpperCase()

  if (valuta === 'EUR') {
    return { fxCostEur: 0, fxRule: 'Nessuna conversione: il titolo e gia in euro.' }
  }

  const controvalore = Math.max(Number(notionalEur) || 0, 0)

  return {
    fxCostEur: round(controvalore * FX_AUTO_RATE),
    fxRule: `Conversione automatica IBKR, ${(FX_AUTO_RATE * 100).toFixed(2)}% per lato.`,
  }
}

export function getStateTaxEur({ marketId, notionalEur, phase, ticker, type }) {
  const normalizzato = normalizza(ticker)
  const lato = latoOperazione(type, phase)
  const controvalore = Math.max(Number(notionalEur) || 0, 0)

  const voce = IMPOSTE.find((riga) => {
    const perSuffisso = (riga.suffissi || []).some((s) => normalizzato.endsWith(s))
    const perMercato = (riga.mercati || []).includes(marketId)
    return perSuffisso || perMercato
  })

  if (!voce) {
    return { stateTaxEur: 0, stateTaxLabel: null, stateTaxNote: null }
  }

  const dovuta = voce.lato === 'ENTRAMBI' || voce.lato === lato

  return {
    stateTaxEur: dovuta ? round(controvalore * voce.aliquota) : 0,
    stateTaxLabel: voce.etichetta,
    stateTaxNote: voce.nota,
  }
}

export function getBorrowCostEur({ daysHeld = 0, notionalEur, phase, type }) {
  if (type !== 'SHORT' || phase !== 'CLOSE') {
    return { borrowCostEur: 0, borrowRule: null }
  }

  const giorni = Math.max(Number(daysHeld) || 0, 0)

  if (giorni <= 0) {
    return {
      borrowCostEur: 0,
      borrowRule: 'Posizione chiusa in giornata: nessun costo di prestito.',
    }
  }

  const controvalore = Math.max(Number(notionalEur) || 0, 0)

  return {
    borrowCostEur: round((controvalore * BORROW_ANNUAL_RATE * giorni) / 365),
    borrowRule: `Prestito titoli stimato al ${(BORROW_ANNUAL_RATE * 100).toFixed(2)}% annuo per ${giorni} giorni.`,
  }
}

export function applyExecutionCosts({
  atr = 0,
  currency = 'EUR',
  daysHeld = 0,
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
    Number.isFinite(Number(fxToEur)) && Number(fxToEur) > 0 ? Number(fxToEur) : 1
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
    fxToEur: safeFxToEur,
    marketId,
    notionalEur: estimatedNotionalEur,
    price: marketPrice,
    ticker,
  })
  const { fxCostEur, fxRule } = getFxCostEur({
    currency,
    notionalEur: estimatedNotionalEur,
  })
  const { stateTaxEur, stateTaxLabel, stateTaxNote } = getStateTaxEur({
    marketId,
    notionalEur: estimatedNotionalEur,
    phase,
    ticker,
    type,
  })
  const { borrowCostEur, borrowRule } = getBorrowCostEur({
    daysHeld,
    notionalEur: estimatedNotionalEur,
    phase,
    type,
  })

  // feesEur e il numero autorevole: tutto quello che esce di tasca su questo
  // lato. commissionEur resta la sola commissione del broker, perche
  // l'interfaccia la mostra con quel nome.
  const feesEur = round(
    (commission.commissionEur || 0) + fxCostEur + stateTaxEur + borrowCostEur,
  )

  return {
    brokerProfile: commission.brokerProfile,
    commissionEur: commission.commissionEur,
    commissionNative: commission.commissionNative,
    commissionNote: commission.note,
    commissionSource: commission.source,
    currency: currency || 'EUR',
    borrowCostEur,
    borrowRule,
    effectivePrice: round(effectivePrice),
    effectivePriceEur: round(effectivePriceEur),
    feesEur,
    fxCostEur,
    fxRule,
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
    slippageIsAssumption: true,
    slippageNative: round(slippageNative),
    slippageRule: `${(SLIPPAGE_ATR_RATIO * 100).toFixed(0)}% ATR giornaliero per lato (ipotesi, senza fonte)`,
    spreadEur: round(spreadNative * safeFxToEur),
    spreadNative: round(spreadNative),
    spreadPct: round(spreadPct * 100, 4),
    stateTaxEur,
    stateTaxLabel,
    stateTaxNote,
    type,
  }
}

// Il costo in contanti di un lato: commissione, cambio, imposte, prestito.
// Preferire questo a getExecutionCommissionEur ovunque si calcoli un risultato.
export function getExecutionFeesEur(executionCosts) {
  const totale = Number(executionCosts?.feesEur)

  if (Number.isFinite(totale)) {
    return totale
  }

  // Operazioni salvate prima del 2026-08-17 non hanno feesEur.
  const commissione = Number(executionCosts?.commissionEur)

  return Number.isFinite(commissione) ? commissione : 0
}

export function getExecutionCommissionEur(executionCosts) {
  const value = Number(executionCosts?.commissionEur)

  return Number.isFinite(value) ? value : 0
}

export function getPositionOpenCommissionEur(position) {
  return getExecutionFeesEur(position?.executionCosts?.open)
}

function inferMarketIdFromTicker(ticker = '') {
  const normalizedTicker = normalizza(ticker)

  if (
    normalizedTicker.endsWith('.T') ||
    normalizedTicker.endsWith('.TSE') ||
    normalizedTicker.endsWith('.HK') ||
    normalizedTicker.endsWith('.SS') ||
    normalizedTicker.endsWith('.SZ')
  ) {
    return 'asia'
  }

  if (normalizedTicker.includes('.')) {
    return 'equities'
  }

  return 'usa'
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value)

    if (Number.isFinite(number) && number > 0) {
      return number
    }
  }

  return null
}

function roundMoney(value) {
  const number = Number(value)

  return Number.isFinite(number) ? Number(number.toFixed(4)) : null
}

function giorniTenuta(trade) {
  const apertura = new Date(trade?.openedAt || 0).getTime()
  const chiusura = new Date(trade?.exitDate || 0).getTime()

  if (!Number.isFinite(apertura) || !Number.isFinite(chiusura) || chiusura <= apertura) {
    return 0
  }

  return Math.floor((chiusura - apertura) / 86_400_000)
}

export function restateClosedTradeExecutionCosts(trade) {
  if (!trade || typeof trade !== 'object') {
    return trade
  }

  const ticker = trade.ticker || ''
  const marketId =
    trade.marketId ||
    trade.executionCosts?.open?.marketId ||
    trade.executionCosts?.close?.marketId ||
    inferMarketIdFromTicker(ticker)
  const type = trade.type === 'SHORT' ? 'SHORT' : 'LONG'
  const currency =
    trade.currency ||
    trade.executionCosts?.open?.currency ||
    trade.executionCosts?.close?.currency ||
    (marketId === 'usa' ? 'USD' : 'EUR')
  const entryFxToEur = firstFiniteNumber(
    trade.entryFxToEur,
    trade.executionCosts?.open?.fxToEur,
    1,
  )
  const exitFxToEur = firstFiniteNumber(
    trade.exitFxToEur,
    trade.executionCosts?.close?.fxToEur,
    entryFxToEur,
    1,
  )
  const invested = firstFiniteNumber(trade.invested)
  const entrySignalPrice = firstFiniteNumber(
    trade.entrySignalPrice,
    trade.executionCosts?.open?.marketPrice,
    trade.entryPrice,
  )
  const exitSignalPrice = firstFiniteNumber(
    trade.exitSignalPrice,
    trade.executionCosts?.close?.marketPrice,
    trade.exitPrice,
  )
  const atr = firstFiniteNumber(
    trade.atrAtEntry,
    trade.executionCosts?.open?.slippageNative
      ? Number(trade.executionCosts.open.slippageNative) / SLIPPAGE_ATR_RATIO
      : null,
    trade.executionCosts?.close?.slippageNative
      ? Number(trade.executionCosts.close.slippageNative) / SLIPPAGE_ATR_RATIO
      : null,
    0,
  )

  if (!invested || !entrySignalPrice || !exitSignalPrice) {
    return trade
  }

  try {
    const openCosts = applyExecutionCosts({
      atr,
      currency,
      fxToEur: entryFxToEur,
      marketId,
      notionalEur: invested,
      phase: 'OPEN',
      price: entrySignalPrice,
      ticker,
      type,
    })
    const entryPriceEur = Number(openCosts.effectivePriceEur)
    const storedQuantity = firstFiniteNumber(trade.quantity)
    const quantity =
      storedQuantity ||
      (Number.isFinite(entryPriceEur) && entryPriceEur > 0
        ? invested / entryPriceEur
        : null)

    if (!quantity) {
      return trade
    }

    const closeNotionalEur = exitSignalPrice * exitFxToEur * quantity
    const closeCosts = applyExecutionCosts({
      atr,
      currency,
      daysHeld: giorniTenuta(trade),
      fxToEur: exitFxToEur,
      marketId,
      notionalEur: closeNotionalEur,
      phase: 'CLOSE',
      price: exitSignalPrice,
      ticker,
      type,
    })
    const exitPriceEur = Number(closeCosts.effectivePriceEur)
    const grossPnlEur =
      type === 'LONG'
        ? (exitPriceEur - entryPriceEur) * quantity
        : (entryPriceEur - exitPriceEur) * quantity
    const openFeesEur = getExecutionFeesEur(openCosts)
    const closeFeesEur = getExecutionFeesEur(closeCosts)
    const pnlEur = grossPnlEur - openFeesEur - closeFeesEur
    const recoveredCapital = Math.max(invested + grossPnlEur - closeFeesEur, 0)

    return {
      ...trade,
      entryPrice: openCosts.effectivePrice,
      entryPriceEur: roundMoney(entryPriceEur),
      exitPrice: closeCosts.effectivePrice,
      exitPriceEur: roundMoney(exitPriceEur),
      executionCosts: {
        ...(trade.executionCosts || {}),
        open: openCosts,
        close: closeCosts,
      },
      grossPnlEur: roundMoney(grossPnlEur),
      pnlEur: roundMoney(pnlEur),
      quantity: roundMoney(quantity),
      recoveredCapital: roundMoney(recoveredCapital),
      result: pnlEur >= 0 ? 'WIN' : 'LOSS',
      totalCostsEur: roundMoney(openFeesEur + closeFeesEur),
      costModelRestated: true,
    }
  } catch {
    return trade
  }
}
