import { useMemo, useState } from 'react'
import { ClipboardList, PlugZap } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { InfoTip } from '../components/ui/InfoTip'
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

const numberFormatter = new Intl.NumberFormat('it-IT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 8,
})

const dateTimeFormatter = new Intl.DateTimeFormat('it-IT', {
  dateStyle: 'short',
  timeStyle: 'short',
})

const filters = [
  { value: 'all', label: 'Tutti' },
  { value: 'OPEN', label: 'Aperture' },
  { value: 'CLOSE', label: 'Chiusure' },
  { value: 'ESEGUITO', label: 'Eseguiti' },
  { value: 'RIFIUTATO', label: 'Rifiutati' },
]

const EMPTY_ARRAY = []

function formatCurrency(value) {
  return Number.isFinite(Number(value))
    ? currencyFormatter.format(Number(value))
    : 'N/D'
}

function formatNumber(value) {
  return Number.isFinite(Number(value))
    ? numberFormatter.format(Number(value))
    : 'N/D'
}

function formatDate(value) {
  return value ? dateTimeFormatter.format(new Date(value)) : 'N/D'
}

function sideLabel(side) {
  const labels = {
    BUY: 'Compra',
    SELL: 'Vendi',
    SELL_SHORT: 'Apri short',
    BUY_TO_COVER: 'Chiudi short',
  }

  return labels[side] || side || 'N/D'
}

function sourceLabel(source) {
  const labels = {
    automation: 'Pilota',
    'backend-monitor': 'Backend',
    eod: 'EOD',
    'live-monitor': 'Monitor live',
    manual: 'Manuale',
    'legacy-backfill': 'Storico ricostruito',
  }

  return labels[source] || source || 'Sistema'
}

function orderVariant(order) {
  if (order.status === 'RIFIUTATO') {
    return 'negative'
  }

  if (order.status === 'ESEGUITO') {
    return 'positive'
  }

  return 'default'
}

function OrderCostTip({ order }) {
  const costs = order.executionCosts

  if (!costs) {
    return null
  }

  return (
    <InfoTip label="Dettaglio costi ordine">
      <div className="space-y-2">
        <p className="font-semibold text-white">Prezzo eseguito realistico</p>
        <p>Prezzo segnale: {costs.marketPrice}</p>
        <p>Prezzo eseguito: {costs.effectivePrice}</p>
        <p>Spread: {formatCurrency(costs.spreadEur)}</p>
        <p>Slippage: {formatCurrency(costs.slippageEur)}</p>
        <p>Commissione broker: {formatCurrency(costs.commissionEur)}</p>
        <p className="text-slate-500">{costs.commissionNote}</p>
      </div>
    </InfoTip>
  )
}

export default function Orders({ marketId }) {
  const { activeMarket, markets } = useTrading()
  const effectiveMarket = marketId || activeMarket
  const strategy = getTradingStrategy(effectiveMarket)
  const marketState = markets?.[effectiveMarket] || {}
  const orders = Array.isArray(marketState.orders) ? marketState.orders : EMPTY_ARRAY
  const marketCopy = getMarketCopy(effectiveMarket)
  const executionMode = marketState.executionMode || 'simulation'
  const [activeFilter, setActiveFilter] = useState('all')

  const filteredOrders = useMemo(() => {
    if (activeFilter === 'all') {
      return orders
    }

    return orders.filter(
      (order) => order.action === activeFilter || order.status === activeFilter,
    )
  }, [activeFilter, orders])

  const executedCount = orders.filter((order) => order.status === 'ESEGUITO').length
  const rejectedCount = orders.filter((order) => order.status === 'RIFIUTATO').length

  return (
    <div className="flex flex-1 flex-col gap-7">
      <header className="rounded-lg border border-slate-800 bg-[#090b10] p-5 shadow-xl shadow-black/20">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
              Registro ordini · {marketCopy.eyebrow}
            </p>
            <h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
              Ordini {strategy.label}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Audit broker-ready degli ordini simulati. Qui vedi cosa Spapple
              avrebbe inviato a un broker o exchange reale.
            </p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-[var(--market-accent-border)] bg-[var(--market-accent-soft)]">
            <ClipboardList className="h-6 w-6 text-[var(--market-accent)]" />
          </div>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Modalità</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <PlugZap className="h-4 w-4 text-[var(--market-accent)]" />
              <p className="text-xl font-semibold text-[var(--market-accent)]">
                {executionMode === 'simulation' ? 'Simulazione' : executionMode}
              </p>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              Broker attuale: simulationBroker.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Ordini eseguiti</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-[var(--market-accent)]">
              {executedCount}
            </p>
            <p className="mt-2 text-sm text-slate-500">
              Aperture e chiusure simulate correttamente.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Ordini rifiutati</CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={
                rejectedCount > 0
                  ? 'text-2xl font-semibold text-[#ef8f8f]'
                  : 'text-2xl font-semibold text-white'
              }
            >
              {rejectedCount}
            </p>
            <p className="mt-2 text-sm text-slate-500">
              Blocchi rischio, kill switch o limiti operativi.
            </p>
          </CardContent>
        </Card>
      </section>

      <Card className="overflow-hidden">
        <CardHeader className="flex-col gap-4 border-b border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Registro operativo</CardTitle>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Ogni riga contiene stato ordine, prezzo eseguito, quantità e
              motivo operativo.
            </p>
          </div>
          <Badge>{filteredOrders.length} ordini</Badge>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {filters.map((filter) => (
              <Button
                key={filter.value}
                size="sm"
                variant={activeFilter === filter.value ? 'default' : 'ghost'}
                onClick={() => setActiveFilter(filter.value)}
              >
                {filter.label}
              </Button>
            ))}
          </div>
        </CardContent>
        {filteredOrders.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Data</TableHead>
                <TableHead>Ticker</TableHead>
                <TableHead>Azione</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead>Fonte</TableHead>
                <TableHead>Prezzo</TableHead>
                <TableHead>Quantità</TableHead>
                <TableHead>Importo</TableHead>
                <TableHead>Motivo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>{formatDate(order.createdAt)}</TableCell>
                  <TableCell className="font-semibold text-white">
                    {order.ticker}
                  </TableCell>
                  <TableCell>{sideLabel(order.side)}</TableCell>
                  <TableCell>
                    <Badge variant={orderVariant(order)}>{order.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <p>{sourceLabel(order.source)}</p>
                      {order.source === 'legacy-backfill' ? (
                        <Badge
                          variant={
                            order.dataQuality === 'incomplete'
                              ? 'negative'
                              : 'default'
                          }
                        >
                          {order.dataQuality === 'incomplete'
                            ? 'Dato incompleto'
                            : 'Backfill'}
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{formatNumber(order.executedPrice)}</span>
                      <OrderCostTip order={order} />
                    </div>
                  </TableCell>
                  <TableCell>{formatNumber(order.quantity)}</TableCell>
                  <TableCell>{formatCurrency(order.notional)}</TableCell>
                  <TableCell>
                    <p className="min-w-64 text-sm leading-6 text-slate-400">
                      {order.reason || 'Nessun dettaglio disponibile'}
                    </p>
                    {order.dataQuality === 'incomplete' ? (
                      <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-[#ef8f8f]">
                        Dato legacy incompleto: non invento prezzo o P/L.
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-slate-600">
                      ID {order.id}
                    </p>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <CardContent className="flex min-h-72 items-center justify-center text-center">
            <div>
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-slate-800 bg-slate-950">
                <ClipboardList className="h-5 w-5 text-slate-500" />
              </div>
              <p className="mt-4 font-medium text-white">
                Nessun ordine trovato
              </p>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                Avvia una scansione o apri una posizione: gli ordini simulati
                appariranno qui.
              </p>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  )
}
