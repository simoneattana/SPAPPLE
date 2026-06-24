import { Wallet } from 'lucide-react'
import { EmptyState } from '../components/EmptyState'

export default function Portfolio() {
  return (
    <EmptyState
      icon={Wallet}
      title="Portafoglio"
      description="Area predisposta per posizioni, capitale e storico operativo."
    />
  )
}
