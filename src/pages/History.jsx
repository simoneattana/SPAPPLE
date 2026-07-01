import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Bot,
  CalendarDays,
  CheckCircle2,
  Clock3,
  History as HistoryIcon,
  Radio,
  Repeat2,
} from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { useTrading } from '../context/useTrading'
import { getMarketCopy } from '../services/marketCopy'
import { getTradingStrategy } from '../strategies'

function getFilterOptions(activeMarket) {
  return [
    { value: 'all', label: 'Tutte' },
    { value: 'order', label: 'Ordini broker-ready' },
    { value: 'scan', label: 'Scansioni' },
    { value: 'trade', label: 'Trade legacy' },
    { value: 'monitor', label: 'Monitor live' },
    { value: 'backend-monitor', label: 'Monitor backend' },
    {
      value: 'eod',
      label: activeMarket === 'crypto' ? 'Controllo mercato' : 'Motore EOD',
    },
    { value: 'automation', label: 'Automazioni' },
    { value: 'risk', label: 'Rischio' },
    { value: 'closed-trade', label: 'Trade chiusi' },
    { value: 'error', label: 'Errori' },
  ]
}

const dateTimeFormatter = new Intl.DateTimeFormat('it-IT', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

const monthFormatter = new Intl.DateTimeFormat('it-IT', {
  month: 'long',
  year: 'numeric',
})

const currencyFormatter = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
})

const EMPTY_ARRAY = []

function normalizeDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function monthKey(value) {
  const date = normalizeDate(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function formatCurrency(value) {
  return Number.isFinite(Number(value))
    ? currencyFormatter.format(Number(value))
    : 'N/D'
}

function eventLabel(type, activeMarket = 'equities') {
  const labels = {
    automation: 'Automazione',
    'backend-monitor': 'Monitor backend',
    'closed-trade': 'Trade chiuso',
    eod: activeMarket === 'crypto' ? 'Controllo mercato' : 'Motore EOD',
    monitor: 'Monitor live',
    order: 'Ordine broker-ready',
    risk: 'Controllo rischio',
    scan: 'Scansione',
    system: 'Sistema',
    trade: 'Ordine',
  }

  return labels[type] || 'Evento'
}

function eventIcon(type, status) {
  if (status === 'error') {
    return AlertTriangle
  }

  const icons = {
    automation: Bot,
    'backend-monitor': Bot,
    'closed-trade': Repeat2,
    eod: Clock3,
    monitor: Radio,
    order: CheckCircle2,
    risk: AlertTriangle,
    scan: Radio,
    trade: CheckCircle2,
  }

  return icons[type] || HistoryIcon
}

function eventVariant(record) {
  if (record.status === 'error' || record.result === 'LOSS') {
    return 'negative'
  }

  if (
    record.status === 'attention' ||
    record.status === 'working' ||
    record.result === 'WIN'
  ) {
    return 'positive'
  }

  return 'default'
}

function eventColor(record) {
  if (record.status === 'error' || record.result === 'LOSS') {
    return 'text-[#ef8f8f]'
  }

  if (
    record.status === 'attention' ||
    record.status === 'working' ||
    record.result === 'WIN'
  ) {
    return 'text-[var(--market-accent)]'
  }

  return 'text-slate-300'
}

function matchesFilter(record, filter) {
  if (filter === 'all') {
    return true
  }

  if (filter === 'error') {
    return record.status === 'error' || record.result === 'LOSS'
  }

  return record.type === filter
}

function buildClosedTradeRecord(trade) {
  return {
    id: `closed-${trade.ticker}-${trade.exitDate}`,
    type: 'closed-trade',
    status: trade.result === 'WIN' ? 'done' : 'error',
    result: trade.result,
    title: `Trade ${trade.result === 'WIN' ? 'chiuso in profitto' : 'chiuso in perdita'}`,
    detail: `${trade.ticker} ${
      trade.type === 'LONG' ? 'Long' : 'Short'
    } - P/L ${formatCurrency(trade.pnlEur)}.${
      trade.dataQuality === 'incomplete'
        ? ' Dato legacy incompleto: prezzo o P/L non disponibili.'
        : ''
    }`,
    createdAt: trade.exitDate,
  }
}

function buildOrderRecord(order) {
  const sourceDetail =
    order.source === 'legacy-backfill'
      ? order.dataQuality === 'incomplete'
        ? ' Storico ricostruito con dati incompleti.'
        : ' Storico ricostruito.'
      : ''

  return {
    id: `order-record-${order.id}`,
    type: 'order',
    status: order.status === 'RIFIUTATO' ? 'error' : 'done',
    title:
      order.status === 'RIFIUTATO'
        ? 'Ordine simulato rifiutato'
        : order.action === 'CLOSE'
          ? 'Ordine di chiusura simulato'
          : 'Ordine di apertura simulato',
    detail: `${order.ticker} - ${order.side || 'N/D'} - ${
      order.status || 'N/D'
    }. ${order.reason || ''}${sourceDetail}`,
    createdAt: order.createdAt,
  }
}

function groupByMonth(records) {
  return records.reduce((groups, record) => {
    const key = monthKey(record.createdAt)

    if (!groups[key]) {
      groups[key] = []
    }

    groups[key].push(record)
    return groups
  }, {})
}

function HistoryItem({ record, activeMarket }) {
  const Icon = eventIcon(record.type, record.status)
  const color = eventColor(record)

  return (
    <li className="rounded-lg border border-slate-800 bg-slate-950 p-4">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-[#090b10]">
          <Icon className={`h-5 w-5 ${color}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className={`text-sm font-semibold ${color}`}>
                {record.title}
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                {record.detail}
              </p>
            </div>
            <Badge variant={eventVariant(record)}>
              {eventLabel(record.type, activeMarket)}
            </Badge>
          </div>
          <p className="mt-3 text-xs uppercase tracking-[0.14em] text-slate-600">
            {dateTimeFormatter.format(normalizeDate(record.createdAt))}
          </p>
        </div>
      </div>
    </li>
  )
}

export default function History({ marketId }) {
  const { activeMarket, markets } = useTrading()
  const effectiveMarket = marketId || activeMarket
  const strategy = getTradingStrategy(effectiveMarket)
  const routeMarketState = markets?.[effectiveMarket] || {}
  const events = Array.isArray(routeMarketState.events)
    ? routeMarketState.events
    : EMPTY_ARRAY
  const history = Array.isArray(routeMarketState.history)
    ? routeMarketState.history
    : EMPTY_ARRAY
  const orders = Array.isArray(routeMarketState.orders)
    ? routeMarketState.orders
    : EMPTY_ARRAY
  const marketLabel = routeMarketState.marketLabel || strategy.label
  const [activeFilter, setActiveFilter] = useState('all')
  const marketCopy = getMarketCopy(effectiveMarket)
  const filterOptions = getFilterOptions(effectiveMarket)

  const records = useMemo(() => {
    const eventRecords = events.map((event) => ({
      ...event,
      type: event.type || 'system',
      createdAt: event.createdAt || new Date().toISOString(),
    }))
    const closedTradeRecords = history.map(buildClosedTradeRecord)
    const orderRecords = orders.map(buildOrderRecord)

    return [...eventRecords, ...orderRecords, ...closedTradeRecords].sort(
      (first, second) =>
        normalizeDate(second.createdAt).getTime() -
        normalizeDate(first.createdAt).getTime(),
    )
  }, [events, history, orders])

  const filteredRecords = useMemo(
    () => records.filter((record) => matchesFilter(record, activeFilter)),
    [activeFilter, records],
  )

  const monthlyGroups = useMemo(
    () => groupByMonth(filteredRecords),
    [filteredRecords],
  )
  const monthKeys = Object.keys(monthlyGroups).sort().reverse()

  return (
    <div className="flex flex-1 flex-col gap-7">
      <header className="rounded-lg border border-slate-800 bg-[#090b10] p-5 shadow-xl shadow-black/20">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
              Registro operativo · {marketCopy.eyebrow}
            </p>
            <h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
              Storico: {marketLabel}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Archivio separato delle attività del mercato {marketLabel},
              organizzato per mese e filtrabile per tipologia di azione.
            </p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-[var(--market-accent-border)] bg-[var(--market-accent-soft)]">
            <HistoryIcon className="h-6 w-6 text-[var(--market-accent)]" />
          </div>
        </div>
      </header>

      <Card>
        <CardHeader className="flex-col gap-4 border-b border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Filtra attività</CardTitle>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Usa i filtri per isolare ordini, scansioni, automazioni,
              controlli o problemi rilevati.
            </p>
          </div>
          <Badge>{filteredRecords.length} eventi</Badge>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {filterOptions.map((option) => (
              <Button
                key={option.value}
                size="sm"
                variant={activeFilter === option.value ? 'default' : 'ghost'}
                onClick={() => setActiveFilter(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {monthKeys.length > 0 ? (
        <div className="space-y-5">
          {monthKeys.map((key) => {
            const firstRecord = monthlyGroups[key][0]

            return (
              <section
                key={key}
                className="rounded-lg border border-slate-800 bg-[#090b10] shadow-xl shadow-black/20"
              >
                <div className="flex items-center justify-between gap-4 border-b border-slate-800 p-5">
                  <div className="flex items-center gap-3">
                    <CalendarDays className="h-5 w-5 text-[var(--market-accent)]" />
                    <h2 className="text-lg font-semibold capitalize text-white">
                      {monthFormatter.format(normalizeDate(firstRecord.createdAt))}
                    </h2>
                  </div>
                  <Badge>{monthlyGroups[key].length} eventi</Badge>
                </div>
                <ol className="space-y-3 p-5">
                  {monthlyGroups[key].map((record) => (
                    <HistoryItem
                      key={record.id}
                      activeMarket={effectiveMarket}
                      record={record}
                    />
                  ))}
                </ol>
              </section>
            )
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="flex min-h-72 items-center justify-center text-center">
            <div>
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-slate-800 bg-slate-950">
                <HistoryIcon className="h-5 w-5 text-slate-500" />
              </div>
              <p className="mt-4 font-medium text-white">
                Nessuna attività trovata
              </p>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                Cambia filtro oppure esegui una scansione per generare nuovi
                eventi nello storico.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
