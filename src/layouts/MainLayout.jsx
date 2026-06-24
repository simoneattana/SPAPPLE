import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  LayoutDashboard,
  LogOut,
  Radar,
  Settings,
  Wallet,
} from 'lucide-react'
import { Button } from '../components/ui/Button'
import { useAuth } from '../services/useAuth'

const navigationItems = [
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
  { label: 'Scanner di Mercato', to: '/scanner', icon: Radar },
  { label: 'Portafoglio', to: '/portafoglio', icon: Wallet },
  { label: 'Impostazioni', to: '/impostazioni', icon: Settings },
]

export default function MainLayout() {
  const { logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-[#050608] text-slate-100">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-72 border-r border-slate-800/80 bg-[#080a0e]/95 px-5 py-6 shadow-2xl shadow-black/30 lg:flex lg:flex-col">
        <div className="flex items-center gap-3 border-b border-slate-800/80 pb-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-[#deff9a]/35 bg-[#deff9a]/10">
            <BarChart3 className="h-5 w-5 text-[#deff9a]" />
          </div>
          <div>
            <p className="text-lg font-semibold tracking-[0.22em] text-white">
              SPAPPLE
            </p>
            <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
              Laboratorio Trading
            </p>
          </div>
        </div>

        <nav className="mt-8 flex flex-1 flex-col gap-2">
          {navigationItems.map((item) => {
            const Icon = item.icon

            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  [
                    'flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition',
                    isActive
                      ? 'bg-[#deff9a] text-slate-950 shadow-lg shadow-[#deff9a]/10'
                      : 'text-slate-400 hover:bg-slate-900 hover:text-white',
                  ].join(' ')
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            )
          })}
        </nav>

        <Button variant="ghost" className="justify-start" onClick={handleLogout}>
          <LogOut className="h-4 w-4" />
          Esci
        </Button>
      </aside>

      <main className="min-h-screen lg:pl-72">
        <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-5 sm:px-7 lg:px-10 lg:py-8">
          <div className="mb-5 flex items-center justify-between border-b border-slate-800 pb-5 lg:hidden">
            <div>
              <p className="text-base font-semibold tracking-[0.2em] text-white">
                SPAPPLE
              </p>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                Laboratorio Trading
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
