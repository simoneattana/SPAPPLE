import { useState } from 'react'
import { LockKeyhole } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useAuth } from '../services/useAuth'

export default function Login() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = (event) => {
    event.preventDefault()
    setError('')

    if (login(password)) {
      navigate('/dashboard', { replace: true })
      return
    }

    setError('Password non valida. Riprova.')
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#050608] px-5 text-slate-100">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border border-slate-800 bg-[#090b10] p-7 shadow-2xl shadow-black/40"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-lg border border-[#deff9a]/35 bg-[#deff9a]/10">
            <LockKeyhole className="h-6 w-6 text-[#deff9a]" />
          </div>
          <h1 className="text-3xl font-semibold tracking-[0.24em] text-white">
            Spapple
          </h1>
          <p className="mt-3 text-sm text-slate-500">
            Accesso riservato al simulatore quantitativo
          </p>
        </div>

        <label className="mb-2 block text-sm font-medium text-slate-300">
          Password
        </label>
        <Input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          placeholder="Inserisci password"
        />

        {error ? (
          <p className="mt-3 text-sm font-medium text-[#ef8f8f]">{error}</p>
        ) : null}

        <Button className="mt-6 w-full" type="submit">
          Accedi
        </Button>
      </form>
    </main>
  )
}
