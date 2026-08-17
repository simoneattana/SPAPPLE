import { readFileSync } from 'node:fs'

const REPO = '/Users/simone/Progetti/SPAPPLE'
for (const line of readFileSync(`${REPO}/.env.local`, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/)
  if (m) process.env[m[1]] = m[2]
}

const { getSupabaseClient, readTradingState } = await import(`${REPO}/api/_tradingEngine.js`)
const { payload, updatedAt } = await readTradingState(getSupabaseClient())

console.log('revisione', payload.stateRevision, '| aggiornato', updatedAt)
console.log('ultima mutazione:', payload.lastStateMutationSummary)
console.log('')

for (const [id, m] of Object.entries(payload.markets || {})) {
  const ordini = m.orders || []
  const rifiutati = ordini.filter((o) => o.status === 'RIFIUTATO')
  const eseguiti = ordini.filter((o) => o.status === 'ESEGUITO')

  console.log(`=== ${id}`)
  console.log(`   stato: ${m.engineStatus}`)
  console.log(`   messaggio: ${m.lastAutomationMessage}`)
  console.log(
    `   scansione: ${m.lastScanAt || 'mai'} | titoli ${m.lastScanCount} | segnali ${m.lastSignalCount}`,
  )
  console.log(
    `   posizioni ${(m.positions || []).length} | ordini eseguiti ${eseguiti.length} | rifiutati ${rifiutati.length}`,
  )

  const motivi = {}
  for (const o of rifiutati) {
    const chiave = /non copre il costo/.test(o.reason || '')
      ? 'guardia sui costi'
      : (o.reason || 'senza motivo').slice(0, 60)
    motivi[chiave] = (motivi[chiave] || 0) + 1
  }
  for (const [motivo, n] of Object.entries(motivi)) {
    console.log(`      ${n}x  ${motivo}`)
  }

  for (const p of (m.positions || []).slice(0, 6)) {
    console.log(
      `      APERTA ${p.ticker} ${p.type} a ${p.entryPrice} | bersaglio ${p.takeProfit} | stop ${p.stopLoss}`,
    )
  }
  console.log('')
}
