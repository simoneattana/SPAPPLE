import { Navigate, Route, Routes } from 'react-router-dom'
import { cloneElement, isValidElement, useLayoutEffect } from 'react'
import { AuthProvider } from './services/AuthContext'
import { ToastProvider } from './components/ui/Toast'
import { TradingProvider } from './context/TradingContext'
import MainLayout from './layouts/MainLayout'
import Dashboard from './pages/Dashboard'
import Diary from './pages/Diary'
import Explanation from './pages/Explanation'
import Login from './pages/Login'
import MarketScanner from './pages/MarketScanner'
import Orders from './pages/Orders'
import Profits from './pages/Profits'
import Settings from './pages/Settings'
import { useAuth } from './services/useAuth'
import { useTrading } from './context/useTrading'

function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return children
}

function PublicRoute({ children }) {
  const { isAuthenticated } = useAuth()

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}

function MarketScope({ marketId, children }) {
  const { activeMarket, setActiveMarket } = useTrading()

  useLayoutEffect(() => {
    if (activeMarket !== marketId) {
      setActiveMarket(marketId)
    }
  }, [activeMarket, marketId, setActiveMarket])

  return children
}

function MarketPage({ marketId, children }) {
  return (
    <MarketScope marketId={marketId}>
      {isValidElement(children) ? cloneElement(children, { marketId }) : children}
    </MarketScope>
  )
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicRoute>
            <Login />
          </PublicRoute>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/europa/dashboard" replace />} />
        <Route path="dashboard" element={<Navigate to="/europa/dashboard" replace />} />
        <Route path="scanner" element={<MarketScanner />} />
        <Route path="portafoglio" element={<Navigate to="/scanner" replace />} />
        <Route path="ordini" element={<Navigate to="/europa/ordini" replace />} />
        <Route path="utili" element={<Navigate to="/europa/utili" replace />} />
        <Route path="diario" element={<Navigate to="/europa/diario" replace />} />
        <Route path="storico" element={<Navigate to="/europa/diario" replace />} />
        <Route path="azioni/dashboard" element={<Navigate to="/europa/dashboard" replace />} />
        <Route path="azioni/scanner" element={<Navigate to="/scanner?mercato=equities" replace />} />
        <Route path="azioni/portafoglio" element={<Navigate to="/scanner?mercato=equities" replace />} />
        <Route path="azioni/ordini" element={<Navigate to="/europa/ordini" replace />} />
        <Route path="azioni/utili" element={<Navigate to="/europa/utili" replace />} />
        <Route path="azioni/diario" element={<Navigate to="/europa/diario" replace />} />
        <Route path="azioni/storico" element={<Navigate to="/europa/diario" replace />} />
        <Route
          path="europa/dashboard"
          element={<MarketPage marketId="equities"><Dashboard /></MarketPage>}
        />
        <Route
          path="europa/scanner"
          element={<Navigate to="/scanner?mercato=equities" replace />}
        />
        <Route path="europa/portafoglio" element={<Navigate to="/scanner?mercato=equities" replace />} />
        <Route
          path="europa/ordini"
          element={<MarketPage marketId="equities"><Orders /></MarketPage>}
        />
        <Route
          path="europa/utili"
          element={<MarketPage marketId="equities"><Profits /></MarketPage>}
        />
        <Route
          path="europa/diario"
          element={<MarketPage marketId="equities"><Diary /></MarketPage>}
        />
        <Route path="europa/storico" element={<Navigate to="/europa/diario" replace />} />
        <Route
          path="usa/dashboard"
          element={<MarketPage marketId="usa"><Dashboard /></MarketPage>}
        />
        <Route
          path="usa/scanner"
          element={<Navigate to="/scanner?mercato=usa" replace />}
        />
        <Route path="usa/portafoglio" element={<Navigate to="/scanner?mercato=usa" replace />} />
        <Route
          path="usa/ordini"
          element={<MarketPage marketId="usa"><Orders /></MarketPage>}
        />
        <Route
          path="usa/utili"
          element={<MarketPage marketId="usa"><Profits /></MarketPage>}
        />
        <Route
          path="usa/diario"
          element={<MarketPage marketId="usa"><Diary /></MarketPage>}
        />
        <Route path="usa/storico" element={<Navigate to="/usa/diario" replace />} />
        <Route
          path="asia/dashboard"
          element={<MarketPage marketId="asia"><Dashboard /></MarketPage>}
        />
        <Route
          path="asia/scanner"
          element={<Navigate to="/scanner?mercato=asia" replace />}
        />
        <Route path="asia/portafoglio" element={<Navigate to="/scanner?mercato=asia" replace />} />
        <Route
          path="asia/ordini"
          element={<MarketPage marketId="asia"><Orders /></MarketPage>}
        />
        <Route
          path="asia/utili"
          element={<MarketPage marketId="asia"><Profits /></MarketPage>}
        />
        <Route
          path="asia/diario"
          element={<MarketPage marketId="asia"><Diary /></MarketPage>}
        />
        <Route path="asia/storico" element={<Navigate to="/asia/diario" replace />} />
        <Route path="crypto/*" element={<Navigate to="/usa/dashboard" replace />} />
        <Route path="spiegazione" element={<Explanation />} />
        <Route path="impostazioni" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/europa/dashboard" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <TradingProvider>
          <AppRoutes />
        </TradingProvider>
      </ToastProvider>
    </AuthProvider>
  )
}
