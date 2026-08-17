import { useEffect, useMemo, useState } from 'react'
import {
  BadgeEuro,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  PiggyBank,
  TrendingDown,
} from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { InfoTip } from '../components/ui/InfoTip'
import { useTrading } from '../context/useTrading'
import { getMarketCopy } from '../services/marketCopy'
import { restateClosedTradeExecutionCosts } from '../services/executionCosts'
import { Campione, NotaModello } from '../components/EtichetteDati'
import {
  calculateRealizedTotals,
  calculateSampleSize,
  filterTradesByMonthKey,
  groupTradesByDay,
  normalizeTradeDate,
} from '../services/profitStats'
import { getTradingStrategy } from '../strategies'

const currencyFormatter = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
})

const monthFormatter = new Intl.DateTimeFormat('it-IT', {
  month: 'long',
  year: 'numeric',
})

const weekdayLabels = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']
const EMPTY_ARRAY = []

function getCurrentMonthKey() {
  const today = new Date()

  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
}

function getRecentMonthKeysFromDate(anchorDate, count = 3) {
  const anchor = anchorDate || new Date()

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(anchor.getFullYear(), anchor.getMonth() - index, 1)

    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  })
}

function getLatestTradeDate(history = []) {
  return history.reduce((latestDate, trade) => {
    const tradeDate = normalizeTradeDate(trade.exitDate)

    if (!tradeDate) {
      return latestDate
    }

    if (!latestDate || tradeDate.getTime() > latestDate.getTime()) {
      return tradeDate
    }

    return latestDate
  }, null)
}

function parseMonthKey(key) {
  const [year, month] = String(key || getCurrentMonthKey())
    .split('-')
    .map(Number)

  return new Date(year, month - 1, 1)
}

function formatMonthKey(key) {
  return monthFormatter.format(parseMonthKey(key))
}

function formatCurrency(value) {
  return Number.isFinite(Number(value))
    ? currencyFormatter.format(Number(value))
    : 'N/D'
}

function buildCalendarDays(monthKey, tradesByDay) {
  const firstDay = parseMonthKey(monthKey)
  const year = firstDay.getFullYear()
  const month = firstDay.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstWeekday = (firstDay.getDay() + 6) % 7
  const cells = []

  for (let index = 0; index < firstWeekday; index += 1) {
    cells.push({ type: 'empty', key: `empty-${index}` })
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(
      day,
    ).padStart(2, '0')}`
    const trades = tradesByDay[key] || []

    cells.push({
      day,
      key,
      totals: calculateRealizedTotals(trades),
      trades,
      type: 'day',
    })
  }

  return cells
}

function MetricCard({ accent = 'text-white', icon: Icon, info, label, value }) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 pb-2">
        <div className="flex items-center gap-2">
          <CardTitle>{label}</CardTitle>
          {info ? <InfoTip>{info}</InfoTip> : null}
        </div>
        {Icon ? <Icon className={`h-5 w-5 ${accent}`} /> : null}
      </CardHeader>
      <CardContent>
        <p className={`text-2xl font-semibold ${accent}`}>{value}</p>
      </CardContent>
    </Card>
  )
}

export default function Profits({ marketId }) {
  const { activeMarket, markets } = useTrading()
  const effectiveMarket = marketId || activeMarket
  const strategy = getTradingStrategy(effectiveMarket)
  const routeMarketState = markets?.[effectiveMarket] || {}
  const history = Array.isArray(routeMarketState.history)
    ? routeMarketState.history
    : EMPTY_ARRAY
  const displayHistory = useMemo(
    () => history.map((trade) => restateClosedTradeExecutionCosts(trade)),
    [history],
  )
  const marketLabel = routeMarketState.marketLabel || strategy.label
  const marketCopy = getMarketCopy(effectiveMarket)
  const latestTradeDate = useMemo(
    () => getLatestTradeDate(displayHistory),
    [displayHistory],
  )
  const availableMonths = useMemo(
    () => getRecentMonthKeysFromDate(latestTradeDate || new Date(), 3),
    [latestTradeDate],
  )
  const [selectedMonth, setSelectedMonth] = useState(availableMonths[0])
  const selectedMonthIndex = availableMonths.indexOf(selectedMonth)

  useEffect(() => {
    if (!availableMonths.includes(selectedMonth)) {
      setSelectedMonth(availableMonths[0])
    }
  }, [availableMonths, selectedMonth])
  const selectedMonthTrades = useMemo(
    () => filterTradesByMonthKey(displayHistory, selectedMonth),
    [displayHistory, selectedMonth],
  )
  const selectedMonthTotals = calculateRealizedTotals(selectedMonthTrades)
  const campioneMese = calculateSampleSize(selectedMonthTrades, effectiveMarket)
  const tradesByDay = useMemo(
    () => groupTradesByDay(selectedMonthTrades),
    [selectedMonthTrades],
  )
  const calendarDays = useMemo(
    () => buildCalendarDays(selectedMonth, tradesByDay),
    [selectedMonth, tradesByDay],
  )
  const daySummaries = Object.entries(tradesByDay).map(([key, trades]) => ({
    key,
    totals: calculateRealizedTotals(trades),
  }))
  const bestDay = [...daySummaries].sort(
    (first, second) => second.totals.netPnl - first.totals.netPnl,
  )[0]
  const worstDay = [...daySummaries].sort(
    (first, second) => first.totals.netPnl - second.totals.netPnl,
  )[0]
  const positiveDays = daySummaries.filter((day) => day.totals.netPnl > 0).length
  const negativeDays = daySummaries.filter((day) => day.totals.netPnl < 0).length

  const goToPreviousMonth = () => {
    if (selectedMonthIndex < availableMonths.length - 1) {
      setSelectedMonth(availableMonths[selectedMonthIndex + 1])
    }
  }

  const goToNextMonth = () => {
    if (selectedMonthIndex > 0) {
      setSelectedMonth(availableMonths[selectedMonthIndex - 1])
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <header className="rounded-lg border border-slate-800 bg-[#090b10] p-5 shadow-xl shadow-black/20">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
          Utili · {marketCopy.eyebrow}
        </p>
        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white sm:text-3xl">
              Calendario Utili: {marketLabel}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Vista mensile semplice: ogni giorno mostra utili realizzati e P/L
              netto delle chiusure registrate. Mantiene la lettura operativa
              sul mese corrente e sui due mesi precedenti.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              disabled={selectedMonthIndex >= availableMonths.length - 1}
              onClick={goToPreviousMonth}
              aria-label="Mese precedente"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                Mese dell’anno
              </span>
              <select
                className="h-10 rounded-lg border border-slate-800 bg-slate-950 px-3 text-sm font-semibold capitalize text-white outline-none focus:border-[var(--market-accent-border)]"
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(event.target.value)}
              >
                {availableMonths.map((month) => (
                  <option key={month} value={month}>
                    {formatMonthKey(month)}
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="icon"
              variant="ghost"
              disabled={selectedMonthIndex <= 0}
              onClick={goToNextMonth}
              aria-label="Mese successivo"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Campione campione={campioneMese} />
          <NotaModello />
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={PiggyBank}
          label="Utili mese"
          value={formatCurrency(selectedMonthTotals.grossWins)}
          accent="text-[var(--market-accent)]"
          info="Somma dei soli profitti realizzati nel mese selezionato."
        />
        <MetricCard
          icon={TrendingDown}
          label="Perdite mese"
          value={formatCurrency(selectedMonthTotals.grossLosses)}
          accent={selectedMonthTotals.grossLosses > 0 ? 'text-[#ef8f8f]' : 'text-white'}
          info="Somma delle perdite realizzate nel mese selezionato."
        />
        <MetricCard
          icon={BadgeEuro}
          label="P/L netto mese"
          value={formatCurrency(selectedMonthTotals.netPnl)}
          accent={
            selectedMonthTotals.netPnl >= 0
              ? 'text-[var(--market-accent)]'
              : 'text-[#ef8f8f]'
          }
          info="Utili meno perdite nel mese selezionato."
        />
        <MetricCard
          icon={CalendarDays}
          label="Giorni attivi"
          value={`${positiveDays} positivi / ${negativeDays} negativi`}
          info="Conta solo i giorni con almeno una chiusura."
        />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Giorno migliore</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-[var(--market-accent)]">
              {bestDay ? formatCurrency(bestDay.totals.netPnl) : 'N/D'}
            </p>
            <p className="mt-2 text-sm text-slate-500">
              {bestDay ? bestDay.key : 'Nessuna chiusura nel mese selezionato'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Giorno peggiore</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-[#ef8f8f]">
              {worstDay ? formatCurrency(worstDay.totals.netPnl) : 'N/D'}
            </p>
            <p className="mt-2 text-sm text-slate-500">
              {worstDay ? worstDay.key : 'Nessuna chiusura nel mese selezionato'}
            </p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="items-center justify-between gap-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-[var(--market-accent)]" />
            <CardTitle className="capitalize">
              Calendario {formatMonthKey(selectedMonth)}
            </CardTitle>
          </div>
          <Badge>{selectedMonthTotals.closed} chiusure</Badge>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-7 gap-2">
            {weekdayLabels.map((label) => (
              <div
                key={label}
                className="px-2 py-1 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600"
              >
                {label}
              </div>
            ))}
            {calendarDays.map((cell) => {
              if (cell.type === 'empty') {
                return <div key={cell.key} className="min-h-28 rounded-lg" />
              }

              const hasTrades = cell.trades.length > 0
              const netPositive = cell.totals.netPnl >= 0

              return (
                <div
                  key={cell.key}
                  className={`min-h-28 rounded-lg border p-3 ${
                    hasTrades
                      ? 'border-[var(--market-accent-border)] bg-[var(--market-accent-soft)]'
                      : 'border-slate-800 bg-slate-950'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-white">{cell.day}</p>
                    {hasTrades ? <Badge>{cell.trades.length}</Badge> : null}
                  </div>
                  {hasTrades ? (
                    <div className="mt-3 space-y-2">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                          Utili
                        </p>
                        <p className="text-sm font-semibold text-[var(--market-accent)]">
                          {formatCurrency(cell.totals.grossWins)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                          P/L
                        </p>
                        <p
                          className={`text-sm font-semibold ${
                            netPositive
                              ? 'text-[var(--market-accent)]'
                              : 'text-[#ef8f8f]'
                          }`}
                        >
                          {formatCurrency(cell.totals.netPnl)}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-6 text-xs text-slate-600">Nessuna chiusura</p>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
