import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  BookOpen,
  ClipboardList,
  History,
  Info,
  LayoutDashboard,
  LogOut,
  Menu,
  Radar,
  Settings,
  Wallet,
  X,
} from 'lucide-react'
import { Button } from '../components/ui/Button'
import { SystemSidebar } from '../components/SystemSidebar'
import { useAuth } from '../services/useAuth'
import { useTrading } from '../context/useTrading'
import { getMarketTheme } from '../services/marketTheme'

const marketNavigation = [
  {
    id: 'equities',
    label: 'Area Azioni',
    base: '/azioni',
    items: [
      { label: 'Dashboard Azioni', to: '/azioni/dashboard', icon: LayoutDashboard },
      { label: 'Scanner Azioni', to: '/azioni/scanner', icon: Radar },
      { label: 'Portafoglio Azioni', to: '/azioni/portafoglio', icon: Wallet },
      { label: 'Ordini Azioni', to: '/azioni/ordini', icon: ClipboardList },
      { label: 'Diario Azioni', to: '/azioni/diario', icon: BookOpen },
      { label: 'Storico Azioni', to: '/azioni/storico', icon: History },
    ],
  },
  {
    id: 'crypto',
    label: 'Area Crypto',
    base: '/crypto',
    items: [
      { label: 'Dashboard Crypto', to: '/crypto/dashboard', icon: LayoutDashboard },
      { label: 'Scanner Crypto', to: '/crypto/scanner', icon: Radar },
      { label: 'Portafoglio Crypto', to: '/crypto/portafoglio', icon: Wallet },
      { label: 'Ordini Crypto', to: '/crypto/ordini', icon: ClipboardList },
      { label: 'Diario Crypto', to: '/crypto/diario', icon: BookOpen },
      { label: 'Storico Crypto', to: '/crypto/storico', icon: History },
    ],
  },
]

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
    </>
  )
}

export default function MainLayout() {
  const { logout } = useAuth()
  const { activeMarket } = useTrading()
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const routeMarket = location.pathname.startsWith('/crypto')
    ? 'crypto'
    : location.pathname.startsWith('/azioni')
      ? 'equities'
      : activeMarket
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
          <div className="grid min-w-0 flex-1 gap-7 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <Outlet />
            <SystemSidebar />
          </div>
        </div>
      </main>
    </div>
  )
}
