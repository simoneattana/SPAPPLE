import { useMemo, useState } from 'react'
import { Loader2, Play, SearchX } from 'lucide-react'
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

const EUROPEAN_TICKERS = ['ENEL.MI', 'ISP.MI', 'RACE.MI', 'STLAM.MI', 'UCG.MI']

const currencyFormatter = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
})

const numberFormatter = new Intl.NumberFormat('it-IT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function isActionableResult(row) {
  return row.pe > 0 && (row.rsi < 30 || row.rsi > 70)
}

function SignalBadge({ rsi }) {
  if (rsi < 30) {
    return <Badge variant="positive">COMPRA (Long)</Badge>
  }

  if (rsi > 70) {
    return <Badge variant="negative">VENDI (Short)</Badge>
  }

  return <Badge>NEUTRALE</Badge>
}

function WatchlistBadge({ row }) {
  if (isActionableResult(row)) {
    return <SignalBadge rsi={row.rsi} />
  }

  return <Badge>NESSUN SEGNALE</Badge>
}

export default function Scanner() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState([])
  const { toast } = useToast()
  const { executeTrade, positions, maxPositions } = useTrading()
  const slotsFull = positions.length >= maxPositions

  const filteredResults = useMemo(
    () => results.filter(isActionableResult),
    [results],
  )

  const handleScan = async () => {
    setLoading(true)
    setError('')
    setResults([])

    try {
      const marketData = await fetchMarketData(EUROPEAN_TICKERS)
      setResults(marketData)
    } catch (apiError) {
      console.error(apiError)
      setError(apiError.message)
      toast({
        title: 'Errore dati: Controlla la connessione o Yahoo Finance',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleExecuteTrade = (row) => {
    const type = row.rsi < 30 ? 'LONG' : 'SHORT'

    try {
      const trade = executeTrade(row.ticker, row.currentPrice, row.atr, type)
      toast({
        title: `Ordine ${type === 'LONG' ? 'Long' : 'Short'} su ${trade.ticker} eseguito`,
      })
    } catch (tradeError) {
      toast({
        title: tradeError.message,
        variant: 'destructive',
      })
    }
  }

  const actionLabel = (row) => {
    if (row.rsi < 30) {
      return 'Acquista (Long)'
    }

    if (row.rsi > 70) {
      return 'Vendi (Short)'
    }

    return 'Nessuna azione'
  }

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
            Analisi EOD su prezzo di chiusura, RSI, ATR e rapporto P/E con dati
            reali da API.
          </p>
        </div>

        <Button onClick={handleScan} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Avvia Scansione Mercato EOD
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
              Sono visibili solo società profittevoli con RSI sotto 30 o sopra
              70.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>{results.length} scansionati</Badge>
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
                <TableHead>Segnale</TableHead>
                <TableHead>Azione</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredResults.map((row) => (
                <TableRow key={row.ticker}>
                  <TableCell className="font-semibold text-white">
                    {row.ticker}
                  </TableCell>
                  <TableCell>{currencyFormatter.format(row.currentPrice)}</TableCell>
                  <TableCell>{numberFormatter.format(row.rsi)}</TableCell>
                  <TableCell>{numberFormatter.format(row.pe)}</TableCell>
                  <TableCell>{numberFormatter.format(row.atr)}</TableCell>
                  <TableCell>
                    <SignalBadge rsi={row.rsi} />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={slotsFull}
                      onClick={() => handleExecuteTrade(row)}
                    >
                      {actionLabel(row)}
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
                  Avvia una scansione EOD. Verranno mostrati solo ticker con P/E
                  positivo e RSI in area estrema.
                </p>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {results.length > 0 ? (
        <Card className="overflow-hidden">
          <CardHeader className="items-center justify-between gap-4 border-b border-slate-800">
            <div>
              <CardTitle>Universo scansionato</CardTitle>
              <p className="mt-2 text-sm text-slate-500">
                Tutti i ticker analizzati con dati reali Yahoo Finance e
                indicatori calcolati localmente.
              </p>
            </div>
            <Badge>{results.length} titoli</Badge>
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
                  <TableHead>Stato</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((row) => (
                  <TableRow key={`universo-${row.ticker}`}>
                    <TableCell className="font-semibold text-white">
                      {row.ticker}
                    </TableCell>
                    <TableCell>
                      {currencyFormatter.format(row.currentPrice)}
                    </TableCell>
                    <TableCell>{numberFormatter.format(row.rsi)}</TableCell>
                    <TableCell>{numberFormatter.format(row.pe)}</TableCell>
                    <TableCell>{numberFormatter.format(row.atr)}</TableCell>
                    <TableCell>
                      <WatchlistBadge row={row} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
