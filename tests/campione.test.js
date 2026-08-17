// La numerosita di un campione di operazioni.
//
// Regola: contano le giornate, non le operazioni. Posizioni aperte nello stesso
// giro sullo stesso mercato si muovono insieme e valgono come una misura sola.
//
// E la regola su cui e caduta la prima bozza del documento strategico: 25
// operazioni lette come 25 prove indipendenti facevano sembrare positivo uno
// storico che, contato per giornate, positivo non era.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import { calculateSampleSize } from '../src/services/profitStats.js'

const op = (marketId, openedAt) => ({ marketId, openedAt, exitDate: openedAt })

describe('numerosita del campione', () => {
  it('senza operazioni non c e niente da misurare', () => {
    const vuoto = calculateSampleSize([])
    assert.equal(vuoto.operazioni, 0)
    assert.equal(vuoto.giornate, 0)
    assert.equal(vuoto.perGiornata, 0)
  })

  it('operazioni in giorni diversi valgono una a testa', () => {
    const campione = calculateSampleSize([
      op('equities', '2026-08-03T09:00:00Z'),
      op('equities', '2026-08-04T09:00:00Z'),
      op('equities', '2026-08-05T09:00:00Z'),
    ])

    assert.equal(campione.operazioni, 3)
    assert.equal(campione.giornate, 3)
    assert.equal(campione.perGiornata, 1)
  })

  it('tredici operazioni nello stesso giorno e mercato sono una giornata sola', () => {
    const stesseOre = Array.from({ length: 13 }, (_, i) =>
      op('asia', `2026-08-03T0${i % 5}:30:00Z`),
    )
    const campione = calculateSampleSize(stesseOre)

    assert.equal(campione.operazioni, 13)
    assert.equal(campione.giornate, 1)
    assert.equal(campione.perGiornata, 13)
  })

  it('lo stesso giorno su mercati diversi conta come giornate diverse', () => {
    const campione = calculateSampleSize([
      op('asia', '2026-08-03T02:00:00Z'),
      op('equities', '2026-08-03T09:00:00Z'),
      op('usa', '2026-08-03T15:00:00Z'),
    ])

    assert.equal(campione.giornate, 3, 'tre borse diverse, tre osservazioni')
  })

  it('senza mercato sull operazione si usa quello passato come riferimento', () => {
    const campione = calculateSampleSize(
      [{ openedAt: '2026-08-03T09:00:00Z' }, { openedAt: '2026-08-03T10:00:00Z' }],
      'equities',
    )

    assert.equal(campione.giornate, 1)
  })

  it('le operazioni senza data non contano come giornata', () => {
    const campione = calculateSampleSize([
      op('equities', '2026-08-03T09:00:00Z'),
      { marketId: 'equities', openedAt: null, exitDate: null },
    ])

    assert.equal(campione.operazioni, 2)
    assert.equal(campione.giornate, 1)
  })
})

describe('lo storico vero del 3 agosto', () => {
  const archivio = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../docs/archive/stato-operativo-2026-08-03.json', import.meta.url)),
      'utf8',
    ),
  )

  const tutte = Object.entries(archivio.mercati).flatMap(([marketId, m]) =>
    (m.history || []).map((t) => ({ ...t, marketId })),
  )

  // Il caso che ha originato tutto: 25 operazioni, 8 giornate, e una sola
  // giornata che da sola vale piu della meta del campione.
  it('le 25 operazioni archiviate sono 8 giornate', () => {
    const campione = calculateSampleSize(tutte)

    assert.equal(campione.operazioni, 25)
    assert.equal(campione.giornate, 8)
    assert.ok(campione.perGiornata > 3, 'campione concentrato, va segnalato come tale')
  })

  it('la giornata asiatica del 3 agosto da sola vale meta delle operazioni', () => {
    const quelGiorno = tutte.filter(
      (t) => t.marketId === 'asia' && t.openedAt.slice(0, 10) === '2026-08-03',
    )

    assert.equal(quelGiorno.length, 13)
    assert.ok(quelGiorno.length / 25 > 0.5)
    assert.equal(calculateSampleSize(quelGiorno).giornate, 1, 'ma resta una misura sola')
  })
})
