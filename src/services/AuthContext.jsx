import { useMemo, useState } from 'react'
import { AuthContext } from './authState'
import { safeGetItem, safeRemoveItem, safeSetItem } from './safeStorage'

const AUTH_STORAGE_KEY = 'spapple-auth'

export function AuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return safeGetItem(AUTH_STORAGE_KEY) === 'true'
  })

  const login = (password) => {
    if (password === 'alpha') {
      safeSetItem(AUTH_STORAGE_KEY, 'true')
      setIsAuthenticated(true)
      return true
    }

    return false
  }

  const logout = () => {
    safeRemoveItem(AUTH_STORAGE_KEY)
    setIsAuthenticated(false)
  }

  const value = useMemo(
    () => ({ isAuthenticated, login, logout }),
    [isAuthenticated],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
