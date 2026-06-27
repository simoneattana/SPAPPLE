import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpenText, Loader2, Play, SearchX } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { Skeleton } from '../components/ui/Skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/Table'
import { useToast } from '../components/ui/useToast'
import { useTrading } from '../context/useTrading'
import { fetchMarketData } from '../services/api'

const EUROPEAN_TICKERS = [
  'ENEL.MI',
  'ISP.MI',
  'RACE.MI',
  'STLAM.MI',
  'UCG.MI',
  'ENI.MI',
  'TIT.MI',
  'G.MI',
  'PRY.MI',
  'MONC.MI',
  'LDO.MI',
  'BAMI.MI',
  'BPE.MI',
  'SRG.MI',
  'TRN.MI',
  'AIR.PA',
  'OR.PA',
  'MC.PA',
  'TTE.PA',
  'SAN.PA',
  'BNP.PA',
  'AI.PA',
  'RMS.PA',
  'CS.PA',
  'DG.PA',
  'RI.PA',
  'SU.PA',
  'CAP.PA',
  'EN.PA',
  'ACA.PA',
  'SAP.DE',
  'SIE.DE',
  'ALV.DE',
  'DTE.DE',
  'MBG.DE',
  'BMW.DE',
  'VOW3.DE',
  'BAS.DE',
  'BAYN.DE',
  'MUV2.DE',
  'ADS.DE',
  'DHL.DE',
  'DBK.DE',
  'IFX.DE',
  'RWE.DE',
  'ASML.AS',
  'ADYEN.AS',
  'INGA.AS',
  'PHIA.AS',
  'HEIA.AS',
  'AKZA.AS',
  'WKL.AS',
  'NN.AS',
  'SAN.MC',
  'BBVA.MC',
  'IBE.MC',
  'ITX.MC',
  'REP.MC',
  'TEF.MC',
  'FER.MC',
  'CABK.MC',
  'NESN.SW',
  'NOVN.SW',
  'ROG.SW',
  'UBSG.SW',
  'ZURN.SW',
  'SIKA.SW',
  'ABBN.SW',
  'GIVN.SW',
  'VOLV-B.ST',
  'ERIC-B.ST',
  'HM-B.ST',
  'INVE-B.ST',
  'ATCO-A.ST',
  'NOVO-B.CO',
  'MAERSK-B.CO',
  'DSV.CO',
  'NDA-FI.HE',
  'KNEBV.HE',
  'EQNR.OL',
]

const glossaryItems = [
  {
    term: 'Take Profit',
    description: 'Prezzo target: se viene raggiunto, il sistema chiude in utile.',
  },
  {
    term: 'Stop Loss',
    description: 'Prezzo di sicurezza: se viene raggiunto, il sistema chiude per limitare la perdita.',
  },
  {
    term: 'RSI',
    description: 'Indicatore di temperatura: sotto 30 segnala possibile rimbalzo, sopra 70 possibile eccesso.',
  },
  {
    term: 'Long',
    description: 'Posizione al rialzo: guadagna se il prezzo sale dopo l’ingresso.',
  },
  {
    term: 'Short',
    description: 'Posizione aperta al ribasso: non vendi un titolo che possiedi, simuli un’operazione che guadagna se il prezzo scende.',
  },
  {
    term: 'ATR',
    description: 'Misura la volatilità media e aiuta a calibrare target e stop loss.',
  },
  {
    term: 'P/E',
    description: 'Rapporto prezzo/utili: se è assente o non positivo, il titolo viene scartato.',
  },
]

const currencyFormatter = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
})

const numberFormatter = new Intl.NumberFormat('it-IT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function isActionableResult(row) {
  return row.status === 'ok' && row.pe > 0 && (row.rsi < 30 || row.rsi > 70)
}

function isRejectedResult(row) {
  return row.status !== 'ok' || !isActionableResult(row)
}

function formatCurrency(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value))
    ? currencyFormatter.format(value)
    : 'Non disponibile'
}

function formatNumber(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value))
    ? numberFormatter.format(value)
    : 'Non disponibile'
}

function StrategyBadge({ rsi }) {
  if (rsi < 30) {
    return <Badge variant="positive">LONG / RIALZO</Badge>
  }

  if (rsi > 70) {
    return <Badge variant="negative">SHORT / RIBASSO</Badge>
  }

  return <Badge>NEUTRALE</Badge>
}

function StrategyCell({ row }) {
  const isLong = row.rsi < 30

  return (
    <div className="min-w-48">
      <StrategyBadge rsi={row.rsi} />
      <p className="mt-2 text-xs leading-5 text-slate-500">
        {isLong
          ? 'Apre una posizione che guadagna se il prezzo sale.'
          : 'Apre una posizione che guadagna se il prezzo scende.'}
      </p>
    </div>
  )
}

function ReasonCell({ row }) {
  if (row.rsi < 30) {
    return (
      <p className="min-w-56 text-sm leading-6 text-slate-400">
        RSI sotto 30: il titolo risulta molto venduto e il sistema cerca un
        possibile rimbalzo.
      </p>
    )
  }

  return (
    <p className="min-w-56 text-sm leading-6 text-slate-400">
      RSI sopra 70: il titolo risulta molto comprato e il sistema cerca una
      possibile discesa.
    </p>
  )
}

function WatchlistBadge({ row }) {
  if (row.status !== 'ok') {
    return <Badge variant="negative">SCARTATO</Badge>
  }

  if (isActionableResult(row)) {
    return <StrategyBadge rsi={row.rsi} />
  }

  return <Badge>NESSUN SEGNALE</Badge>
}

export default function Scanner() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const autoScanStarted = useRef(false)
  const { toast } = useToast()
  const {
    automationEnabled,
    executeAutomatedTrades,
    executeTrade,
    lastScanAt,
    lastScanResults,
    positions,
    maxPositions,
    recordScanComplete,
    recordScanError,
    recordScanStart,
  } = useTrading()
  const [results, setResults] = useState(lastScanResults || [])
  const slotsFull = positions.length >= maxPositions

  const filteredResults = useMemo(
    () => results.filter(isActionableResult),
    [results],
  )
  const rejectedResults = useMemo(
    () => results.filter(isRejectedResult),
    [results],
  )

  useEffect(() => {
    setResults(lastScanResults || [])
  }, [lastScanResults])

  const scanIsFromToday = useMemo(() => {
    if (!lastScanAt) {
      return false
    }

    return new Date(lastScanAt).toDateString() === new Date().toDateString()
  }, [lastScanAt])

  const handleScan = useCallback(async ({ automatic = false } = {}) => {
    setLoading(true)
    setError('')
    recordScanStart(EUROPEAN_TICKERS.length)

    try {
      const marketData = await fetchMarketData(EUROPEAN_TICKERS)
      const actionableRows = marketData.filter(isActionableResult)

      setResults(marketData)
      recordScanComplete({
        scannedCount: marketData.length,
        signalCount: actionableRows.length,
        results: marketData,
      })

      if (automationEnabled && actionableRows.length > 0) {
        const { openedTrades } = executeAutomatedTrades(actionableRows)

        toast({
          title:
            openedTrades.length > 0
              ? `Pilota automatico: ${openedTrades.length} posizioni aperte`
              : 'Pilota automatico: nessuna posizione aperta',
        })
      } else if (automatic) {
        toast({
          title: 'Scansione automatica aggiornata',
        })
      }
    } catch (apiError) {
      console.error(apiError)
      setError(apiError.message)
      recordScanError(apiError.message)
      toast({
        title: 'Errore dati: Controlla la connessione o Yahoo Finance',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [
    automationEnabled,
    executeAutomatedTrades,
    recordScanComplete,
    recordScanError,
    recordScanStart,
    toast,
  ])

  useEffect(() => {
    const shouldAutoScan =
      !autoScanStarted.current && (!lastScanResults?.length || !scanIsFromToday)

    if (!shouldAutoScan) {
      return
    }

    autoScanStarted.current = true
    handleScan({ automatic: true })
  }, [handleScan, lastScanResults?.length, scanIsFromToday])

  const handleExecuteTrade = (row) => {
    const type = row.rsi < 30 ? 'LONG' : 'SHORT'

    try {
      const trade = executeTrade(row.ticker, row.currentPrice, row.atr, type)
      toast({
        title: `Posizione ${type === 'LONG' ? 'Long' : 'Short'} su ${trade.ticker} aperta`,
      })
    } catch (tradeError) {
      toast({
        title: tradeError.message,
        variant: 'destructive',
      })
    }
  }

  const isTickerAlreadyOpen = (ticker) =>
    positions.some((position) => position.ticker === ticker)

  return (
    <div className="flex flex-1 flex-col gap-7">
      <header className="flex flex-col gap-5 rounded-lg border border-slate-800 bg-[#090b10] p-5 shadow-xl shadow-black/20 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
            Scanner quantitativo
          </p>
          <h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
            Scanner di Mercato
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Analisi EOD automatica su 80 titoli europei. I risultati restano
            visibili dall’ultima scansione e puoi aggiornarli manualmente.
          </p>
        </div>

        <Button onClick={() => handleScan()} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Aggiorna Scansione Mercato EOD
        </Button>
      </header>

      {loading ? (
        <Card>
          <CardHeader>
            <CardTitle>Scansione mercato in corso...</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-4/5" />
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-[#ef8f8f]/35 bg-[#ef8f8f]/10 p-4 text-sm text-[#ef8f8f]">
          Errore dati: Controlla la connessione o Yahoo Finance
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader className="items-center justify-between gap-4 border-b border-slate-800">
          <div>
            <CardTitle>Risultati filtrati</CardTitle>
            <p className="mt-2 text-sm text-slate-500">
              Sono visibili solo società profittevoli con RSI estremo. La
              strategia indica se Spapple cerca rialzo o ribasso.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>{results.length} scansionati</Badge>
            <Badge>{rejectedResults.length} scartati</Badge>
            <Badge>{filteredResults.length} segnali</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Ticker</TableHead>
                <TableHead>Prezzo Chiusura</TableHead>
                <TableHead>RSI (14)</TableHead>
                <TableHead>P/E</TableHead>
                <TableHead>Volatilità (ATR)</TableHead>
                <TableHead>Strategia suggerita</TableHead>
                <TableHead>Perché</TableHead>
                <TableHead>Azione</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredResults.map((row) => (
                <TableRow key={row.ticker}>
                  <TableCell className="font-semibold text-white">
                    {row.ticker}
                  </TableCell>
                  <TableCell>{formatCurrency(row.currentPrice)}</TableCell>
                  <TableCell>{formatNumber(row.rsi)}</TableCell>
                  <TableCell>{formatNumber(row.pe)}</TableCell>
                  <TableCell>{formatNumber(row.atr)}</TableCell>
                  <TableCell>
                    <StrategyCell row={row} />
                  </TableCell>
                  <TableCell>
                    <ReasonCell row={row} />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={slotsFull || isTickerAlreadyOpen(row.ticker)}
                      onClick={() => handleExecuteTrade(row)}
                    >
                      {isTickerAlreadyOpen(row.ticker)
                        ? 'Già in portafoglio'
                        : 'Apri posizione'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {!loading && filteredResults.length === 0 ? (
            <div className="flex min-h-72 items-center justify-center border-t border-slate-800 p-8 text-center">
              <div>
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-slate-800 bg-slate-950">
                  <SearchX className="h-5 w-5 text-slate-500" />
                </div>
                <p className="mt-4 font-medium text-white">
                  Nessun segnale operativo disponibile
                </p>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                  Se l’aggiornamento automatico non ha trovato segnali, puoi
                  usare il bottone manuale per ripetere la scansione EOD.
                </p>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="items-center justify-between gap-4 border-b border-slate-800">
          <div>
            <CardTitle>Diagnostica della scansione</CardTitle>
            <p className="mt-2 text-sm text-slate-500">
              Tutti gli 80 ticker europei analizzati, inclusi quelli scartati e
              il motivo della decisione.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>{results.length} titoli</Badge>
            <Badge>{filteredResults.length} ammessi</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {results.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Ticker</TableHead>
                  <TableHead>Prezzo Chiusura</TableHead>
                  <TableHead>RSI (14)</TableHead>
                  <TableHead>P/E</TableHead>
                  <TableHead>Volatilità (ATR)</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((row) => (
                  <TableRow key={`universo-${row.ticker}`}>
                    <TableCell className="font-semibold text-white">
                      {row.ticker}
                    </TableCell>
                    <TableCell>{formatCurrency(row.currentPrice)}</TableCell>
                    <TableCell>{formatNumber(row.rsi)}</TableCell>
                    <TableCell>{formatNumber(row.pe)}</TableCell>
                    <TableCell>{formatNumber(row.atr)}</TableCell>
                    <TableCell>
                      <WatchlistBadge row={row} />
                    </TableCell>
                    <TableCell className="min-w-72 text-sm leading-6 text-slate-400">
                      {row.reason}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex min-h-56 items-center justify-center p-8 text-center">
              <div>
                <p className="font-medium text-white">
                  Diagnostica pronta per la prossima scansione
                </p>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                  Dopo l’avvio vedrai per ogni ticker se è stato ammesso,
                  scartato per RSI neutrale, scartato per P/E o escluso per dati
                  non disponibili.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="items-start gap-3 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#deff9a]/30 bg-[#deff9a]/10">
              <BookOpenText className="h-5 w-5 text-[#deff9a]" />
            </div>
            <div>
              <CardTitle>Legenda veloce</CardTitle>
              <p className="mt-2 text-sm text-slate-500">
                I termini principali che userai per leggere Scanner e
                Portafoglio.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 pt-5 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          {glossaryItems.map((item) => (
            <div
              key={item.term}
              className="rounded-lg border border-slate-800 bg-slate-950 p-4"
            >
              <p className="text-sm font-semibold text-white">{item.term}</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {item.description}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
