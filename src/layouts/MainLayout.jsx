import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  BadgeEuro,
  BookOpen,
  ClipboardList,
  Info,
  LayoutDashboard,
  LogOut,
  Menu,
  Radar,
  Settings,
  X,
} from 'lucide-react'
import { Button } from '../components/ui/Button'
import { SystemSidebar } from '../components/SystemSidebar'
import { useAuth } from '../services/useAuth'
import { useTrading } from '../context/useTrading'
import { getMarketTheme } from '../services/marketTheme'

const relativeTimeFormatter = new Intl.RelativeTimeFormat('it-IT', {
  numeric: 'auto',
})

const marketNavigation = [
  {
    id: 'equities',
    label: 'Europa',
    base: '/europa',
    items: [
      { label: 'Dashboard Europa', to: '/europa/dashboard', icon: LayoutDashboard },
      { label: 'Ordini Europa', to: '/europa/ordini', icon: ClipboardList },
      { label: 'Utili Europa', to: '/europa/utili', icon: BadgeEuro },
      { label: 'Storico Europa', to: '/europa/diario', icon: BookOpen },
    ],
  },
  {
    id: 'usa',
    label: 'USA',
    base: '/usa',
    items: [
      { label: 'Dashboard USA', to: '/usa/dashboard', icon: LayoutDashboard },
      { label: 'Ordini USA', to: '/usa/ordini', icon: ClipboardList },
      { label: 'Utili USA', to: '/usa/utili', icon: BadgeEuro },
      { label: 'Storico USA', to: '/usa/diario', icon: BookOpen },
    ],
  },
  {
    id: 'asia',
    label: 'Asia',
    base: '/asia',
    items: [
      { label: 'Dashboard Asia', to: '/asia/dashboard', icon: LayoutDashboard },
      { label: 'Ordini Asia', to: '/asia/ordini', icon: ClipboardList },
      { label: 'Utili Asia', to: '/asia/utili', icon: BadgeEuro },
      { label: 'Storico Asia', to: '/asia/diario', icon: BookOpen },
    ],
  },
]

const primaryNavigation = [
  { label: 'Scanner mercati', to: '/scanner', icon: Radar },
]

const visibleMarketIds = ['equities', 'usa', 'asia']

const utilityNavigation = [
  { label: 'Cos’è Spapple', to: '/spiegazione', icon: Info },
  { label: 'Impostazioni', to: '/impostazioni', icon: Settings },
]

function BrandHeader({ theme }) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-800/80 pb-6">
      <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--market-accent-border)] bg-[var(--market-accent-soft)]">
        <BarChart3 className="h-5 w-5 text-[var(--market-accent)]" />
      </div>
      <div>
        <p className="text-lg font-semibold tracking-[0.22em] text-white">
          SPAPPLE
        </p>
        <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
          {theme.label}
        </p>
      </div>
    </div>
  )
}

function NavigationContent({ routeMarket, onNavigate }) {
  return (
    <>
      <div className="rounded-lg border border-[var(--market-accent-border)] bg-[var(--market-accent-soft)] p-2">
        <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--market-accent)]">
          Regia unica
        </p>
        <div className="flex flex-col gap-1">
          {primaryNavigation.map((item) => {
            const Icon = item.icon

            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  [
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
                    isActive
                      ? 'bg-[var(--market-accent)] text-slate-950 shadow-lg shadow-[var(--market-accent-soft)]'
                      : 'text-slate-300 hover:bg-slate-900 hover:text-white',
                  ].join(' ')
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            )
          })}
        </div>
      </div>

      {marketNavigation.map((section) => (
        <div
          key={section.id}
          className={
            routeMarket === section.id
              ? 'rounded-lg border border-[var(--market-accent-border)] bg-[var(--market-accent-soft)] p-2'
              : 'rounded-lg border border-slate-800/70 p-2'
          }
        >
          <p
            className={
              routeMarket === section.id
                ? 'px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--market-accent)]'
                : 'px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600'
            }
          >
            {section.label}
          </p>
          <div className="flex flex-col gap-1">
            {section.items.map((item) => {
              const Icon = item.icon

              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    [
                      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
                      isActive
                        ? 'bg-[var(--market-accent)] text-slate-950 shadow-lg shadow-[var(--market-accent-soft)]'
                        : 'text-slate-400 hover:bg-slate-900 hover:text-white',
                    ].join(' ')
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </NavLink>
              )
            })}
          </div>
        </div>
      ))}

      <div className="mt-1 flex flex-col gap-1 border-t border-slate-800 pt-4">
        {utilityNavigation.map((item) => {
          const Icon = item.icon

          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={({ isActive }) =>
                [
                  'flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition',
                  isActive
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:bg-slate-900 hover:text-white',
                ].join(' ')
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          )
        })}
      </div>

      <SystemSidebar />
    </>
  )
}

function formatRelativeSync(value) {
  if (!value) {
    return 'mai'
  }

  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000)

  if (!Number.isFinite(seconds)) {
    return 'mai'
  }

  if (Math.abs(seconds) < 60) {
    return relativeTimeFormatter.format(seconds, 'second')
  }

  return relativeTimeFormatter.format(Math.round(seconds / 60), 'minute')
}

function SyncStatusBar() {
  const { syncMeta } = useTrading()
  const live = syncMeta?.status === 'live' && !syncMeta?.isStale
  const stale = syncMeta?.isStale || syncMeta?.status === 'stale'
  const error = syncMeta?.status === 'errore'
  const label = error
    ? 'Errore sync'
    : stale
      ? 'Dati da aggiornare'
      : live
        ? 'Dati live'
        : 'Sincronizzazione'
  const dotClass = error
    ? 'bg-red-300'
    : stale
      ? 'bg-amber-300'
      : live
        ? 'bg-[var(--market-accent)]'
        : 'bg-slate-400'

  return (
    <div className="mb-5 rounded-lg border border-slate-800 bg-slate-950/70 px-4 py-3 text-xs text-slate-400">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
          <span className="font-semibold text-slate-200">{label}</span>
          <span className="hidden text-slate-600 sm:inline">·</span>
          <span>{syncMeta?.mode === 'realtime' ? 'Realtime' : 'Polling 3s'}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>Rev. #{syncMeta?.stateRevision || 0}</span>
          <span>Ultimo sync: {formatRelativeSync(syncMeta?.lastSyncedAt)}</span>
          <span className="text-slate-500">{syncMeta?.message}</span>
        </div>
      </div>
    </div>
  )
}

export default function MainLayout() {
  const { logout } = useAuth()
  const { activeMarket } = useTrading()
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const scannerMarket = new URLSearchParams(location.search).get('mercato')
  const routeMarket = location.pathname.startsWith('/usa')
    ? 'usa'
    : location.pathname.startsWith('/asia')
      ? 'asia'
      : location.pathname.startsWith('/scanner')
        ? visibleMarketIds.includes(scannerMarket)
          ? scannerMarket
          : visibleMarketIds.includes(activeMarket)
            ? activeMarket
            : 'equities'
        : location.pathname.startsWith('/europa') ||
            location.pathname.startsWith('/azioni')
          ? 'equities'
          : visibleMarketIds.includes(activeMarket)
            ? activeMarket
            : 'equities'
  const theme = getMarketTheme(routeMarket)
  const navigate = useNavigate()
  const styleVars = {
    '--market-accent': theme.accent,
    '--market-accent-soft': theme.accentSoft,
    '--market-accent-border': theme.accentBorder,
    '--market-accent-hover': theme.accentHover,
  }

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  return (
    <div className="min-h-screen bg-[#050608] text-slate-100" style={styleVars}>
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-72 border-r border-slate-800/80 bg-[#080a0e]/95 px-5 py-6 shadow-2xl shadow-black/30 lg:flex lg:flex-col">
        <BrandHeader theme={theme} />

        <nav className="mt-8 flex flex-1 flex-col gap-5 overflow-y-auto pr-1">
          <NavigationContent routeMarket={routeMarket} />
        </nav>

        <Button variant="ghost" className="justify-start" onClick={handleLogout}>
          <LogOut className="h-4 w-4" />
          Esci
        </Button>
      </aside>

      {mobileMenuOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Chiudi menu"
            className="absolute inset-0 bg-black/70"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-[min(22rem,calc(100vw-2rem))] flex-col border-r border-slate-800 bg-[#080a0e] px-5 py-5 shadow-2xl shadow-black/50">
            <div className="flex items-start justify-between gap-4">
              <BrandHeader theme={theme} />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Chiudi menu"
                onClick={() => setMobileMenuOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <nav className="mt-6 flex flex-1 flex-col gap-5 overflow-y-auto pr-1">
              <NavigationContent
                routeMarket={routeMarket}
                onNavigate={() => setMobileMenuOpen(false)}
              />
            </nav>

            <Button
              variant="ghost"
              className="mt-5 justify-start"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4" />
              Esci
            </Button>
          </aside>
        </div>
      ) : null}

      <main className="min-h-screen lg:pl-72">
        <div className="mx-auto flex min-h-screen w-full max-w-[104rem] flex-col px-4 py-4 sm:px-7 lg:px-10 lg:py-8">
          <div className="sticky top-0 z-30 -mx-4 mb-5 flex items-center justify-between border-b border-slate-800 bg-[#050608]/95 px-4 py-4 backdrop-blur sm:-mx-7 sm:px-7 lg:hidden">
            <div>
              <p className="text-base font-semibold tracking-[0.2em] text-white">
                SPAPPLE
              </p>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                {theme.label}
              </p>
            </div>
            <Button
              variant="ghost"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Apri menu"
            >
              <Menu className="h-4 w-4" />
              Menu
            </Button>
          </div>
          <SyncStatusBar />
          <div className="min-w-0 flex-1">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  )
}
