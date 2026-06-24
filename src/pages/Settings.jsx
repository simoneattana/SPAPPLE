import { Settings as SettingsIcon } from 'lucide-react'
import { EmptyState } from '../components/EmptyState'

export default function Settings() {
  return (
    <EmptyState
      icon={SettingsIcon}
      title="Impostazioni"
      description="Configurazione del simulatore pronta per i parametri futuri."
    />
  )
}
