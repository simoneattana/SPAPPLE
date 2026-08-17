// Etichette che dicono quanto vale un numero.
//
// Un risultato senza la sua numerosita e una bugia per omissione: chi legge
// «rende X» non sa se dietro c'e un anno di operativita o una sola giornata
// fortunata. Queste etichette stanno accanto a ogni statistica aggregata e
// rispondono prima che la domanda venga posta.

import { InfoTip } from './ui/InfoTip'
import { cn } from '../services/utils'

const plurale = (n, singolare, plurale) => `${n} ${n === 1 ? singolare : plurale}`

export function Campione({ campione, className }) {
  if (!campione || campione.operazioni === 0) {
    return (
      <p className={cn('text-xs text-slate-600', className)}>
        Nessuna operazione chiusa: non c&rsquo;e ancora niente da misurare.
      </p>
    )
  }

  const { operazioni, giornate, perGiornata } = campione
  const concentrato = perGiornata >= 3

  return (
    <p
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500',
        className,
      )}
    >
      <span>
        Su {plurale(operazioni, 'operazione', 'operazioni')} in{' '}
        <span className={cn('font-medium', concentrato ? 'text-amber-400' : 'text-slate-400')}>
          {plurale(giornate, 'giornata', 'giornate')}
        </span>
      </span>
      {concentrato ? (
        <span className="text-amber-400">
          · {perGiornata.toFixed(1)} per giornata
        </span>
      ) : null}
      <InfoTip label="Perche contano le giornate">
        <span className="block font-medium text-slate-200">
          La numerosita vera sono le giornate, non le operazioni
        </span>
        <span className="mt-2 block">
          Posizioni aperte nello stesso giro sullo stesso mercato si muovono insieme: se
          quel giorno la borsa scende, vanno bene tutte per un motivo solo. Valgono come
          una misura sola, non come tante.
        </span>
        <span className="mt-2 block">
          Nello storico di luglio e agosto 2026, 25 operazioni erano 8 giornate, e una
          sola di quelle pesava per meta. Contate come 25 prove separate facevano
          sembrare positivo un risultato che positivo non era.
        </span>
        {concentrato ? (
          <span className="mt-2 block text-amber-300">
            Qui ci sono {perGiornata.toFixed(1)} operazioni per giornata: il campione e
            molto piu piccolo di quanto sembri.
          </span>
        ) : null}
      </InfoTip>
    </p>
  )
}

export function NotaModello({ className }) {
  return (
    <p
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600',
        className,
      )}
    >
      <span>Risultati simulati · costi modello IBKR</span>
      <InfoTip label="Come sono calcolati questi numeri">
        <span className="block font-medium text-slate-200">
          Cosa c&rsquo;e dentro questi numeri
        </span>
        <span className="mt-2 block">
          Nessuna operazione e reale: Spapple non e collegato a nessun conto. I prezzi
          sono veri, gli ordini no.
        </span>
        <span className="mt-2 block">
          I costi usano il listino Interactive Brokers, piu il cambio valuta, le imposte
          di stato e il prestito titoli sugli short tenuti oltre la giornata. Fino al 17
          agosto 2026 usavano un listino diverso, quindi le operazioni precedenti a quella
          data non sono confrontabili con le successive.
        </span>
        <span className="mt-2 block text-amber-300">
          Una voce e un&rsquo;ipotesi, non una misura: lo slittamento, cioe quanto il
          prezzo peggiora fra la decisione e l&rsquo;esecuzione. Vale circa meta del costo
          stimato e non e verificabile finche le operazioni restano simulate.
        </span>
      </InfoTip>
    </p>
  )
}
