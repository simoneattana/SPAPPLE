import { Radar } from 'lucide-react'
import { EmptyState } from '../components/EmptyState'

export default function MarketScanner() {
  return (
    <EmptyState
      icon={Radar}
      title="Scanner di Mercato"
      description="Modulo pronto per la prossima fase di scansione quantitativa."
    />
  )
}
