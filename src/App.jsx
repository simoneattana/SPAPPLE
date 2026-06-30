import { Navigate, Route, Routes } from 'react-router-dom'
import { useLayoutEffect } from 'react'
import { AuthProvider } from './services/AuthContext'
import { ToastProvider } from './components/ui/Toast'
import { TradingProvider } from './context/TradingContext'
import MainLayout from './layouts/MainLayout'
import Dashboard from './pages/Dashboard'
import Diary from './pages/Diary'
import Explanation from './pages/Explanation'
import History from './pages/History'
import Login from './pages/Login'
import Portfolio from './pages/Portfolio'
import Scanner from './pages/Scanner'
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
  return <MarketScope marketId={marketId}>{children}</MarketScope>
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
        <Route index element={<Navigate to="/azioni/dashboard" replace />} />
        <Route path="dashboard" element={<Navigate to="/azioni/dashboard" replace />} />
        <Route path="scanner" element={<Navigate to="/azioni/scanner" replace />} />
        <Route path="portafoglio" element={<Navigate to="/azioni/portafoglio" replace />} />
        <Route path="diario" element={<Navigate to="/azioni/diario" replace />} />
        <Route path="storico" element={<Navigate to="/azioni/storico" replace />} />
        <Route
          path="azioni/dashboard"
          element={<MarketPage marketId="equities"><Dashboard /></MarketPage>}
        />
        <Route
          path="azioni/scanner"
          element={<MarketPage marketId="equities"><Scanner /></MarketPage>}
        />
        <Route
          path="azioni/portafoglio"
          element={<MarketPage marketId="equities"><Portfolio /></MarketPage>}
        />
        <Route
          path="azioni/diario"
          element={<MarketPage marketId="equities"><Diary /></MarketPage>}
        />
        <Route
          path="azioni/storico"
          element={<MarketPage marketId="equities"><History /></MarketPage>}
        />
        <Route
          path="crypto/dashboard"
          element={<MarketPage marketId="crypto"><Dashboard /></MarketPage>}
        />
        <Route
          path="crypto/scanner"
          element={<MarketPage marketId="crypto"><Scanner /></MarketPage>}
        />
        <Route
          path="crypto/portafoglio"
          element={<MarketPage marketId="crypto"><Portfolio /></MarketPage>}
        />
        <Route
          path="crypto/diario"
          element={<MarketPage marketId="crypto"><Diary /></MarketPage>}
        />
        <Route
          path="crypto/storico"
          element={<MarketPage marketId="crypto"><History /></MarketPage>}
        />
        <Route path="spiegazione" element={<Explanation />} />
        <Route path="impostazioni" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/azioni/dashboard" replace />} />
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
