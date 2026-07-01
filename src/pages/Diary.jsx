import { BookOpen, PiggyBank } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/Table'
import { useTrading } from '../context/useTrading'
import { getMarketCopy } from '../services/marketCopy'
import { getTradingStrategy } from '../strategies'

const currencyFormatter = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
})

const dateFormatter = new Intl.DateTimeFormat('it-IT', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function ResultBadge({ result }) {
  if (result === 'WIN') {
    return <Badge variant="positive">WIN</Badge>
  }

  return <Badge variant="negative">LOSS</Badge>
}

function resultTextColor(result) {
  return result === 'WIN' ? 'text-[var(--market-accent)]' : 'text-[#ef8f8f]'
}

function formatCurrency(value) {
  return Number.isFinite(Number(value))
    ? currencyFormatter.format(Number(value))
    : 'N/D'
}

export default function Diary({ marketId }) {
  const { activeMarket, markets } = useTrading()
  const effectiveMarket = marketId || activeMarket
  const strategy = getTradingStrategy(effectiveMarket)
  const routeMarketState = markets?.[effectiveMarket] || {}
  const history = Array.isArray(routeMarketState.history)
    ? routeMarketState.history
    : []
  const vault = Number.isFinite(Number(routeMarketState.vault))
    ? Number(routeMarketState.vault)
    : 0
  const marketLabel = routeMarketState.marketLabel || strategy.label
  const marketCopy = getMarketCopy(effectiveMarket)

  return (
    <div className="flex flex-1 flex-col gap-7">
      <header className="rounded-lg border border-slate-800 bg-[#090b10] p-5 shadow-xl shadow-black/20">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
          Diario trading · {marketCopy.eyebrow}
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
          Storico Operazioni: {marketLabel}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
          Archivio separato delle posizioni chiuse sul mercato {marketLabel},
          con risultato e P/L.
        </p>
      </header>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Salvadanaio Totale</CardTitle>
            <p className="mt-2 text-sm text-slate-500">
              Solo profitti realizzati da operazioni vincenti.
            </p>
          </div>
          <PiggyBank className="h-6 w-6 text-[var(--market-accent)]" />
        </CardHeader>
        <CardContent>
          <p className="text-4xl font-semibold text-[var(--market-accent)]">
            {currencyFormatter.format(vault)}
          </p>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="items-center justify-between gap-4 border-b border-slate-800">
          <div>
            <CardTitle>Operazioni chiuse</CardTitle>
            <p className="mt-2 text-sm text-slate-500">
              Diario ordinato dalla chiusura più recente.
            </p>
          </div>
          <Badge>{history.length} operazioni</Badge>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Data Uscita</TableHead>
                <TableHead>Ticker</TableHead>
                <TableHead>Direzione</TableHead>
                <TableHead>P/L (€)</TableHead>
                <TableHead>Esito</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((trade) => (
                <TableRow
                  key={`${trade.ticker}-${trade.exitDate}`}
                  className="hover:bg-slate-900/55"
                >
                  <TableCell className={resultTextColor(trade.result)}>
                    {dateFormatter.format(new Date(trade.exitDate))}
                  </TableCell>
                  <TableCell
                    className={`font-semibold ${resultTextColor(trade.result)}`}
                  >
                    {trade.ticker}
                  </TableCell>
                  <TableCell className={resultTextColor(trade.result)}>
                    {trade.type === 'LONG' ? 'Long' : 'Short'}
                  </TableCell>
                  <TableCell className={resultTextColor(trade.result)}>
                    {formatCurrency(trade.pnlEur)}
                  </TableCell>
                  <TableCell>
                    <ResultBadge result={trade.result} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {history.length === 0 ? (
            <div className="flex min-h-72 items-center justify-center border-t border-slate-800 p-8 text-center">
              <div>
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-slate-800 bg-slate-950">
                  <BookOpen className="h-5 w-5 text-slate-500" />
                </div>
                <p className="mt-4 font-medium text-white">
                  Nessuna operazione chiusa
                </p>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                  Il diario si popolerà quando il sistema chiuderà una
                  posizione su take profit o stop loss nel mercato attivo.
                </p>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
