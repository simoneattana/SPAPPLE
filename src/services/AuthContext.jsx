import { useMemo, useState } from 'react'
import { AuthContext } from './authState'

const AUTH_STORAGE_KEY = 'spapple-auth'

export function AuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return localStorage.getItem(AUTH_STORAGE_KEY) === 'true'
  })

  const login = (password) => {
    if (password === 'alpha') {
      localStorage.setItem(AUTH_STORAGE_KEY, 'true')
      setIsAuthenticated(true)
      return true
    }

    return false
  }

  const logout = () => {
    localStorage.removeItem(AUTH_STORAGE_KEY)
    setIsAuthenticated(false)
  }

  const value = useMemo(
    () => ({ isAuthenticated, login, logout }),
    [isAuthenticated],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
