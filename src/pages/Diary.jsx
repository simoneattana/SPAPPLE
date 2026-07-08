import { useMemo, useState } from 'react'
import {
  BadgeEuro,
  BookOpen,
  Download,
  Filter,
  History,
  PiggyBank,
  Search,
  TrendingDown,
} from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
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

const monthFormatter = new Intl.DateTimeFormat('it-IT', {
  month: 'long',
  year: 'numeric',
})

const EMPTY_ARRAY = []
const MAX_VISIBLE_ROWS = 80
const MAX_VISIBLE_EVENTS = 60

function ResultBadge({ result }) {
  if (result === 'WIN') {
    return <Badge variant="positive">WIN</Badge>
  }

  return <Badge variant="negative">LOSS</Badge>
}

function resultTextColor(result) {
  return result === 'WIN' ? 'text-[var(--market-accent)]' : 'text-[#ef8f8f]'
}

function normalizeDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function monthKey(value) {
  const date = normalizeDate(value)

  if (!date) {
    return 'senza-data'
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function formatDate(value) {
  const date = normalizeDate(value)

  return date ? dateFormatter.format(date) : 'N/D'
}

function exitReasonLabel(reason) {
  const labels = {
    BREAK_EVEN_STOP: 'Stop a pareggio',
    MANUALE: 'Manuale',
    PRE_CLOSE_CAPITAL_PROTECTION: 'Protezione capitale',
    PRE_CLOSE_PROFIT_LOCK: 'Utile pre-chiusura',
    PRE_CLOSE_RISK: 'Rischio pre-chiusura',
    SESSION_PROTECTION: 'Protezione sessione',
    STOP_LOSS: 'Stop loss',
    TAKE_PROFIT: 'Take profit',
    TAKE_PROFIT_MAX: 'Target massimo',
    TRAILING_PROFIT: 'Trailing profit',
  }

  return labels[reason] || reason || 'N/D'
}

function formatMonth(value) {
  const date = normalizeDate(value)

  return date ? monthFormatter.format(date) : 'Senza data'
}

function formatCurrency(value) {
  return Number.isFinite(Number(value))
    ? currencyFormatter.format(Number(value))
    : 'N/D'
}

function calculateRealizedTotals(history = []) {
  const wins = history.filter((trade) => trade.result === 'WIN')
  const losses = history.filter((trade) => trade.result === 'LOSS')
  const grossWins = wins.reduce(
    (sum, trade) => sum + Math.max(Number(trade.pnlEur || 0), 0),
    0,
  )
  const grossLosses = losses.reduce(
    (sum, trade) => sum + Math.abs(Math.min(Number(trade.pnlEur || 0), 0)),
    0,
  )

  return {
    closed: history.length,
    grossLosses,
    grossWins,
    losses: losses.length,
    netPnl: grossWins - grossLosses,
    wins: wins.length,
  }
}

function getMonthOptions(history = [], orders = [], events = []) {
  const values = new Map()
  const dates = [
    ...history.map((trade) => trade.exitDate),
    ...orders.map((order) => order.createdAt),
    ...events.map((event) => event.createdAt),
  ]

  dates.forEach((value) => {
    const key = monthKey(value)

    if (key !== 'senza-data' && !values.has(key)) {
      values.set(key, {
        key,
        label: formatMonth(value),
      })
    }
  })

  return [...values.values()].sort((first, second) =>
    second.key.localeCompare(first.key),
  )
}

function matchText(value, query) {
  if (!query) {
    return true
  }

  return String(value || '').toLowerCase().includes(query.toLowerCase())
}

function tradeMatchesFilters(trade, { month, query, result }) {
  const monthMatches = month === 'all' || monthKey(trade.exitDate) === month
  const resultMatches = result === 'all' || trade.result === result
  const queryMatches =
    matchText(trade.ticker, query) ||
    matchText(trade.type, query) ||
    matchText(trade.exitReason, query)

  return monthMatches && resultMatches && queryMatches
}

function activityLabel(type) {
  const labels = {
    automation: 'Automazione',
    'backend-monitor': 'Monitor backend',
    chiusura: 'Chiusura',
    eod: 'Motore EOD',
    monitor: 'Monitor live',
    order: 'Ordine',
    scan: 'Scansione',
    system: 'Sistema',
  }

  return labels[type] || 'Evento'
}

function buildActivityRecords({ events, history, orders }) {
  const closedTradeRecords = history.map((trade) => ({
    id: `chiusura-${trade.positionId || trade.ticker}-${trade.exitDate}`,
    type: 'chiusura',
    status: trade.result === 'LOSS' ? 'error' : 'done',
    title: `${trade.ticker} chiuso ${trade.type === 'LONG' ? 'Long' : 'Short'}`,
    detail: `P/L ${formatCurrency(trade.pnlEur)} · ${trade.exitReason || 'Motivo non disponibile'}`,
    createdAt: trade.exitDate,
  }))
  const orderRecords = orders.map((order) => ({
    id: `ordine-${order.id}`,
    type: 'order',
    status: order.status === 'RIFIUTATO' ? 'error' : 'done',
    title: `${order.ticker} · ${order.action === 'CLOSE' ? 'Chiusura' : 'Apertura'}`,
    detail: `${order.side || 'N/D'} · ${order.status || 'N/D'} · ${formatCurrency(
      order.notional,
    )}`,
    createdAt: order.createdAt,
  }))
  const eventRecords = events.map((event) => ({
    id: `evento-${event.id}`,
    type: event.type || 'system',
    status: event.status || 'done',
    title: event.title || 'Evento operativo',
    detail: event.detail || 'Dettaglio non disponibile',
    createdAt: event.createdAt,
  }))

  return [...closedTradeRecords, ...orderRecords, ...eventRecords].sort(
    (first, second) =>
      (normalizeDate(second.createdAt)?.getTime() || 0) -
      (normalizeDate(first.createdAt)?.getTime() || 0),
  )
}

function activityMatchesFilters(record, { activityType, month, query }) {
  const monthMatches = month === 'all' || monthKey(record.createdAt) === month
  const typeMatches =
    activityType === 'all' ||
    record.type === activityType ||
    (activityType === 'errori' && record.status === 'error')
  const queryMatches =
    matchText(record.title, query) || matchText(record.detail, query)

  return monthMatches && typeMatches && queryMatches
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

function downloadTradesCsv(trades, marketLabel) {
  const header = [
    'Data uscita',
    'Ticker',
    'Direzione',
    'P/L',
    'Esito',
    'Motivo uscita',
    'Prezzo ingresso',
    'Prezzo uscita',
    'Investito',
    'Capitale rientrato',
  ]
  const rows = trades.map((trade) => [
    trade.exitDate,
    trade.ticker,
    trade.type,
    trade.pnlEur,
    trade.result,
    trade.exitReason,
    trade.entryPrice,
    trade.exitPrice,
    trade.invested,
    trade.recoveredCapital,
  ])
  const csv = [header, ...rows]
    .map((row) => row.map(csvCell).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = `spapple-${marketLabel.toLowerCase().replaceAll(' ', '-')}-chiusure.csv`
  link.click()
  URL.revokeObjectURL(url)
}

export default function Diary({ marketId }) {
  const { activeMarket, markets } = useTrading()
  const effectiveMarket = marketId || activeMarket
  const strategy = getTradingStrategy(effectiveMarket)
  const routeMarketState = markets?.[effectiveMarket] || {}
  const history = Array.isArray(routeMarketState.history)
    ? routeMarketState.history
    : EMPTY_ARRAY
  const orders = Array.isArray(routeMarketState.orders)
    ? routeMarketState.orders
    : EMPTY_ARRAY
  const events = Array.isArray(routeMarketState.events)
    ? routeMarketState.events
    : EMPTY_ARRAY
  const marketLabel = routeMarketState.marketLabel || strategy.label
  const marketCopy = getMarketCopy(effectiveMarket)
  const monthOptions = useMemo(
    () => getMonthOptions(history, orders, events),
    [events, history, orders],
  )
  const [month, setMonth] = useState('all')
  const [result, setResult] = useState('all')
  const [activityType, setActivityType] = useState('all')
  const [query, setQuery] = useState('')
  const filteredTrades = useMemo(
    () =>
      history.filter((trade) =>
        tradeMatchesFilters(trade, { month, query, result }),
      ),
    [history, month, query, result],
  )
  const visibleTrades = filteredTrades.slice(0, MAX_VISIBLE_ROWS)
  const realizedTotals = calculateRealizedTotals(filteredTrades)
  const activityRecords = useMemo(
    () => buildActivityRecords({ events, history, orders }),
    [events, history, orders],
  )
  const filteredActivity = useMemo(
    () =>
      activityRecords.filter((record) =>
        activityMatchesFilters(record, { activityType, month, query }),
      ),
    [activityRecords, activityType, month, query],
  )
  const visibleActivity = filteredActivity.slice(0, MAX_VISIBLE_EVENTS)

  return (
    <div className="flex flex-1 flex-col gap-6">
      <header className="rounded-lg border border-slate-800 bg-[#090b10] p-5 shadow-xl shadow-black/20">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
          Storico operativo · {marketCopy.eyebrow}
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
          Diario e Storico: {marketLabel}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
          Un’unica area per consultare chiusure, ordini ed eventi operativi.
          Filtra per mese, risultato o tipologia per mantenere lo storico
          leggibile anche quando crescerà.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Utili realizzati</CardTitle>
              <p className="mt-2 text-sm text-slate-500">
                Calcolati dalle chiusure vincenti. Gli utili rientrano anche nel capitale operativo.
              </p>
            </div>
            <PiggyBank className="h-6 w-6 text-[var(--market-accent)]" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-[var(--market-accent)]">
              {currencyFormatter.format(realizedTotals.grossWins)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Perdite filtrate</CardTitle>
              <p className="mt-2 text-sm text-slate-500">
                Somma delle perdite nel periodo o filtro selezionato.
              </p>
            </div>
            <TrendingDown className="h-6 w-6 text-[#ef8f8f]" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-[#ef8f8f]">
              {currencyFormatter.format(realizedTotals.grossLosses)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>P/L netto filtrato</CardTitle>
              <p className="mt-2 text-sm text-slate-500">
                Utili meno perdite sulle chiusure visibili.
              </p>
            </div>
            <BadgeEuro
              className={`h-6 w-6 ${
                realizedTotals.netPnl >= 0
                  ? 'text-[var(--market-accent)]'
                  : 'text-[#ef8f8f]'
              }`}
            />
          </CardHeader>
          <CardContent>
            <p
              className={`text-3xl font-semibold ${
                realizedTotals.netPnl >= 0
                  ? 'text-[var(--market-accent)]'
                  : 'text-[#ef8f8f]'
              }`}
            >
              {currencyFormatter.format(realizedTotals.netPnl)}
            </p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="items-center justify-between gap-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Filter className="h-5 w-5 text-[var(--market-accent)]" />
            <div>
              <CardTitle>Filtri consultazione</CardTitle>
              <p className="mt-2 text-sm text-slate-500">
                I filtri valgono sia per le chiusure sia per il registro
                operativo.
              </p>
            </div>
          </div>
          <Badge>{filteredTrades.length} chiusure filtrate</Badge>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            <label className="text-sm text-slate-400">
              <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-slate-600">
                Mese
              </span>
              <select
                className="h-10 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 text-sm text-white outline-none focus:border-[var(--market-accent-border)]"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              >
                <option value="all">Tutti i mesi</option>
                {monthOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm text-slate-400">
              <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-slate-600">
                Esito chiusure
              </span>
              <select
                className="h-10 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 text-sm text-white outline-none focus:border-[var(--market-accent-border)]"
                value={result}
                onChange={(event) => setResult(event.target.value)}
              >
                <option value="all">Tutti</option>
                <option value="WIN">Solo utili</option>
                <option value="LOSS">Solo perdite</option>
              </select>
            </label>

            <label className="text-sm text-slate-400">
              <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-slate-600">
                Tipo attività
              </span>
              <select
                className="h-10 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 text-sm text-white outline-none focus:border-[var(--market-accent-border)]"
                value={activityType}
                onChange={(event) => setActivityType(event.target.value)}
              >
                <option value="all">Tutte</option>
                <option value="chiusura">Chiusure</option>
                <option value="order">Ordini</option>
                <option value="scan">Scansioni</option>
                <option value="monitor">Monitor live</option>
                <option value="backend-monitor">Monitor backend</option>
                <option value="automation">Automazioni</option>
                <option value="errori">Errori</option>
              </select>
            </label>

            <label className="text-sm text-slate-400">
              <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-slate-600">
                Ricerca
              </span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
                <Input
                  className="pl-9"
                  placeholder="Ticker, motivo, evento..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </label>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="items-center justify-between gap-4 border-b border-slate-800">
          <div>
            <CardTitle>Chiusure analizzabili</CardTitle>
            <p className="mt-2 text-sm text-slate-500">
              Tabella compatta per analisi futura. Mostro le prime{' '}
              {MAX_VISIBLE_ROWS} righe filtrate per non rendere la pagina
              ingestibile.
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={filteredTrades.length === 0}
            onClick={() => downloadTradesCsv(filteredTrades, marketLabel)}
          >
            <Download className="h-4 w-4" />
            Esporta CSV
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Data Uscita</TableHead>
                <TableHead>Ticker</TableHead>
                <TableHead>Direzione</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead>P/L</TableHead>
                <TableHead>Esito</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleTrades.map((trade) => (
                <TableRow
                  key={`${trade.positionId || trade.ticker}-${trade.exitDate}`}
                  className="hover:bg-slate-900/55"
                >
                  <TableCell className={resultTextColor(trade.result)}>
                    {formatDate(trade.exitDate)}
                  </TableCell>
                  <TableCell
                    className={`font-semibold ${resultTextColor(trade.result)}`}
                  >
                    {trade.ticker}
                  </TableCell>
                  <TableCell className={resultTextColor(trade.result)}>
                    {trade.type === 'LONG' ? 'Long' : 'Short'}
                  </TableCell>
                  <TableCell className="text-slate-400">
                    {exitReasonLabel(trade.exitReason)}
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

          {filteredTrades.length > MAX_VISIBLE_ROWS ? (
            <div className="border-t border-slate-800 p-4 text-sm text-slate-500">
              Altre {filteredTrades.length - MAX_VISIBLE_ROWS} chiusure sono
              incluse nell’export CSV e consultabili restringendo i filtri.
            </div>
          ) : null}

          {filteredTrades.length === 0 ? (
            <div className="flex min-h-56 items-center justify-center border-t border-slate-800 p-8 text-center">
              <div>
                <BookOpen className="mx-auto h-8 w-8 text-slate-600" />
                <p className="mt-4 font-medium text-white">
                  Nessuna chiusura trovata
                </p>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                  Cambia mese, esito o ricerca per ampliare la consultazione.
                </p>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="items-center justify-between gap-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-[var(--market-accent)]" />
            <div>
              <CardTitle>Registro attività</CardTitle>
              <p className="mt-2 text-sm text-slate-500">
                Sintesi di ordini, eventi automatici, scansioni e chiusure.
              </p>
            </div>
          </div>
          <Badge>{filteredActivity.length} eventi filtrati</Badge>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {visibleActivity.map((record) => {
              const isError = record.status === 'error'

              return (
                <li
                  key={record.id}
                  className="rounded-lg border border-slate-800 bg-slate-950 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p
                        className={`font-semibold ${
                          isError ? 'text-[#ef8f8f]' : 'text-white'
                        }`}
                      >
                        {record.title}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-slate-400">
                        {record.detail}
                      </p>
                      <p className="mt-2 text-xs uppercase tracking-[0.14em] text-slate-600">
                        {formatDate(record.createdAt)}
                      </p>
                    </div>
                    <Badge variant={isError ? 'negative' : 'default'}>
                      {activityLabel(record.type)}
                    </Badge>
                  </div>
                </li>
              )
            })}
          </ol>

          {filteredActivity.length > MAX_VISIBLE_EVENTS ? (
            <p className="mt-4 text-sm text-slate-500">
              Altri {filteredActivity.length - MAX_VISIBLE_EVENTS} eventi sono
              nascosti per mantenere la pagina leggera. Restringi i filtri per
              analizzarli.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
