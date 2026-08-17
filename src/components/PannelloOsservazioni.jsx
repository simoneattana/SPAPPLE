// Cosa succede ai segnali che il motore NON apre.
//
// Il pilota automatico apre al massimo 8 posizioni per mercato e le chiude con
// una regola sola. Di tutto il resto non sapremmo niente. Qui si vede come si
// muovono tutti i segnali, aperti e non, a quattro distanze di tempo: e il dato
// che serve per capire quanto conviene tenere aperta una posizione.

import { Eye } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from './ui/Card'
import { InfoTip } from './ui/InfoTip'
import { getObservationStats } from '../services/engine/observations'

const percentuale = (valore) =>
  `${valore >= 0 ? '+' : ''}${valore.toFixed(2)}%`

function colore(valore) {
  if (valore > 0) return 'text-[var(--market-accent)]'
  if (valore < 0) return 'text-[#ef8f8f]'
  return 'text-slate-400'
}

export function PannelloOsservazioni({ observations = [] }) {
  const righe = getObservationStats(observations)
  const totale = observations.length
  const rilevate = righe.some((riga) => riga.osservazioni > 0)

  return (
    <Card>
      <CardHeader className="items-center justify-between gap-3 p-4 pb-2">
        <div className="flex items-center gap-2">
          <Eye className="h-5 w-5 text-[var(--market-accent)]" />
          <CardTitle className="text-white">Osservazione segnali</CardTitle>
          <InfoTip label="Cos e l osservazione dei segnali">
            <span className="block font-medium text-slate-200">
              Anche i segnali che non diventano operazioni
            </span>
            <span className="mt-2 block">
              Il pilota apre al massimo 8 posizioni per mercato e le chiude con una
              regola sola. Di tutti gli altri segnali non sapremmo niente.
            </span>
            <span className="mt-2 block">
              Qui ogni segnale viene annotato con il prezzo del momento, anche se non e
              stato aperto o se la guardia sui costi lo ha rifiutato, e poi si guarda
              come si e mosso dopo un&rsquo;ora, un giorno, tre giorni e una settimana.
            </span>
            <span className="mt-2 block">
              La resa e vista dal lato della scommessa: uno short guadagna quando il
              prezzo scende. Non costa nessuna chiamata dati in piu, usa i prezzi che la
              scansione scarica gia.
            </span>
          </InfoTip>
        </div>
        <span className="text-xs text-slate-500">
          {totale} {totale === 1 ? 'segnale annotato' : 'segnali annotati'}
        </span>
      </CardHeader>
      <CardContent className="p-4">
        {totale === 0 ? (
          <p className="text-sm text-slate-500">
            Nessun segnale ancora annotato. Si popola alla prossima scansione a mercato
            aperto.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[0.12em] text-slate-600">
                    <th className="pb-2 text-left font-medium">Dopo</th>
                    <th className="pb-2 text-right font-medium">Segnali</th>
                    <th className="pb-2 text-right font-medium">Giornate</th>
                    <th className="pb-2 text-right font-medium">Resa media</th>
                    <th className="pb-2 text-right font-medium">Positivi</th>
                  </tr>
                </thead>
                <tbody>
                  {righe.map((riga) => (
                    <tr key={riga.orizzonte} className="border-t border-slate-800">
                      <td className="py-2 text-slate-300">{riga.etichetta}</td>
                      <td className="py-2 text-right tabular-nums text-slate-400">
                        {riga.osservazioni || '—'}
                      </td>
                      <td className="py-2 text-right tabular-nums text-slate-400">
                        {riga.giornate || '—'}
                      </td>
                      <td
                        className={`py-2 text-right tabular-nums font-medium ${
                          riga.osservazioni ? colore(riga.resaMediaPct) : 'text-slate-600'
                        }`}
                      >
                        {riga.osservazioni ? percentuale(riga.resaMediaPct) : '—'}
                      </td>
                      <td className="py-2 text-right tabular-nums text-slate-400">
                        {riga.osservazioni
                          ? `${Math.round(riga.quotaPositive * 100)}%`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rilevate ? null : (
              <p className="mt-3 text-xs text-slate-600">
                Le rilevazioni compaiono man mano che passa il tempo: la prima dopo
                un&rsquo;ora dal segnale.
              </p>
            )}
            <p className="mt-3 text-xs text-slate-600">
              Le rese sono al lordo dei costi: servono a capire se il movimento c&rsquo;e,
              non se sarebbe stato conveniente inseguirlo.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
