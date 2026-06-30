import { Bot, ClipboardCheck, ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { useTrading } from '../context/useTrading'
import { getMarketCopy } from '../services/marketCopy'

const analysisRules = [
  {
    title: "La salute dell'azienda (P/E)",
    text: 'Controlla se un’azienda fa utili o perde soldi. Se è in perdita (P/E negativo), la scarta a priori. Non ti farà mai comprare "spazzatura".',
  },
  {
    title: 'La temperatura del titolo (RSI)',
    text: 'Cerca l’effetto elastico. Se un titolo è crollato troppo e tutti lo stanno vendendo per il panico (RSI sotto 30), capisce che l’elastico è teso e segnala di Comprare (Long) per sfruttare il rimbalzo. Se il titolo è salito troppo (RSI sopra 70), segnala di Vendere allo scoperto (Short) per sfruttare la fisiologica discesa.',
  },
  {
    title: 'Il nervosismo del titolo (ATR e Autotuning)',
    text: 'Misura quanto il titolo oscilla normalmente. Se è un titolo tranquillo, imposta in automatico un piccolo guadagno rapido dello 0,30%. Se è un titolo ribelle e volatile, punta a un guadagno leggermente più alto dello 0,50%, distanziando anche lo Stop Loss di sicurezza per non farti buttare fuori dal mercato per un falso allarme.',
  },
]

const automationRules = [
  {
    title: 'Gestione Capitale',
    text: 'Usa al massimo 5 posizioni attive alla volta. Ogni nuova posizione investe il 10% del capitale operativo disponibile, con un minimo di 1.000€ e un massimo di 5.000€.',
  },
  {
    title: 'Il Salvadanaio Blindato',
    text: 'Quando chiudi un’operazione in profitto, rimette il capitale investito nel capitale operativo per il prossimo trade, ma il guadagno reale lo sposta nel Salvadanaio. Quei soldi sono intoccabili e non verranno mai re-investiti.',
  },
  {
    title: 'Il Blocco di 3 Giorni (Time Lock)',
    text: 'Impedisce decisioni d’ansia. Se compri un titolo, lo tiene bloccato per almeno 3 giorni per dargli il tempo di respirare, salvo take profit o stop loss di emergenza.',
  },
]

const routineSteps = [
  {
    title: 'Fai il Login',
    text: 'Entri sull’app con la tua password ("alpha").',
  },
  {
    title: 'Scansioni il Mercato',
    text: 'Vai nella scheda Scanner di Mercato e clicchi il bottone "Avvia Scansione". Aspetti qualche secondo che il sistema interroghi la Borsa reale e ti mostri solo i titoli che rispettano le regole ferree.',
  },
  {
    title: 'Approvi gli Ordini',
    text: 'Dalla tabella dei risultati, scegli quali titoli inserire in portafoglio cliccando su "Acquista" per una posizione Long o "Apri Short" per una posizione al ribasso. L’app calcolerà l’importo in automatico in base al capitale operativo disponibile.',
  },
  {
    title: 'Il Check Serale',
    text: 'La sera successiva vai nella scheda Portafoglio e clicchi "Esegui Motore EOD". L’app scarica i prezzi freschi di giornata e controlla se incassare, proteggerti con lo stop loss o tenere la posizione.',
  },
]

const cryptoAnalysisRules = [
  {
    title: 'La liquidità dell’asset',
    text: 'Sulle crypto non esiste il P/E. Spapple controlla quindi il volume giornaliero in euro e scarta gli asset troppo sottili, perché sarebbero poco affidabili per una simulazione prudente.',
  },
  {
    title: 'La temperatura crypto (RSI)',
    text: 'Cerca eccessi tecnici anche sulle coppie crypto/EUR: RSI sotto 30 segnala possibile rimbalzo, RSI sopra 70 segnala possibile correzione.',
  },
  {
    title: 'La volatilità 24/7 (ATR)',
    text: 'Le crypto oscillano più delle azioni e non chiudono la sera. Per questo target, stop e filtro del pilota sono più larghi e calibrati su ATR.',
  },
]

const cryptoAutomationRules = [
  {
    title: 'Capitale Crypto Separato',
    text: 'Il mercato crypto usa un capitale autonomo rispetto alle azioni. In questo modo risultati, rischio, storico e posizioni non si mischiano.',
  },
  {
    title: 'Sizing più prudente',
    text: 'Ogni nuova posizione crypto usa circa il 5% del capitale crypto, con massimo 3 posizioni. È più prudente perché il mercato è più volatile.',
  },
  {
    title: 'Monitor 24/7',
    text: 'Il sistema può controllare prezzi Kraken anche fuori dagli orari di Borsa. Se target o stop vengono raggiunti, chiude la posizione simulata.',
  },
]

const cryptoRoutineSteps = [
  {
    title: 'Selezioni Crypto',
    text: 'Nel pannello operativo scegli Crypto. Da quel momento Dashboard, Scanner, Portafoglio, Diario e Storico mostrano solo il mondo crypto.',
  },
  {
    title: 'Scansioni Kraken',
    text: 'Vai nello Scanner e aggiorni la scansione. Spapple legge dati Kraken reali su coppie crypto/EUR liquide.',
  },
  {
    title: 'Lasci lavorare il pilota',
    text: 'Con il pilota automatico acceso, Spapple apre solo segnali abbastanza forti per rischio, RSI e volatilità.',
  },
  {
    title: 'Controlli Portafoglio e Storico',
    text: 'Nel Portafoglio vedi solo posizioni crypto. Nel Diario e nello Storico vedi solo attività e risultati del mercato crypto attivo.',
  },
]

function InfoCard({ title, text }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-6 text-slate-400">{text}</p>
      </CardContent>
    </Card>
  )
}

export default function Explanation() {
  const { activeMarket, marketLabel } = useTrading()
  const marketCopy = getMarketCopy(activeMarket)
  const isCrypto = activeMarket === 'crypto'
  const activeAnalysisRules = isCrypto ? cryptoAnalysisRules : analysisRules
  const activeAutomationRules = isCrypto ? cryptoAutomationRules : automationRules
  const activeRoutineSteps = isCrypto ? cryptoRoutineSteps : routineSteps

  return (
    <div className="flex flex-1 flex-col gap-7">
      <header className="rounded-lg border border-slate-800 bg-[#090b10] p-6 shadow-xl shadow-black/20">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
          Spiegazione operativa · {marketCopy.eyebrow}
        </p>
        <h1 className="mt-3 text-3xl font-semibold text-white">
          Cos’è Spapple: {marketLabel}
        </h1>
        <p className="mt-4 max-w-4xl text-base leading-7 text-slate-400">
          {isCrypto
            ? 'Nel mondo crypto Spapple lavora su asset digitali liquidi, prezzi Kraken reali e regole separate di rischio. Non usa P/E o logiche aziendali: controlla liquidità, temperatura tecnica e volatilità 24/7.'
            : 'Spapple guarda il mercato azionario reale e fa da “buttafuori” e da “matematico”. Quando analizza i titoli, controlla da solo salute aziendale, temperatura tecnica e nervosismo del prezzo per produrre decisioni fredde, matematiche e ultra-prudenti.'}
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-3">
        {activeAnalysisRules.map((rule) => (
          <InfoCard key={rule.title} {...rule} />
        ))}
      </section>

      <section className="rounded-lg border border-slate-800 bg-[#090b10] p-6 shadow-xl shadow-black/20">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-[#deff9a]/30 bg-[#deff9a]/10">
            <Bot className="h-5 w-5 text-[#deff9a]" />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
              Money Management
            </p>
            <h2 className="text-2xl font-semibold text-white">
              Cosa fa in automatico
            </h2>
          </div>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {activeAutomationRules.map((rule) => (
            <InfoCard key={rule.title} {...rule} />
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-[#090b10] p-6 shadow-xl shadow-black/20">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-700 bg-slate-950">
            <ClipboardCheck className="h-5 w-5 text-[#deff9a]" />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
              Routine manuale
            </p>
            <h2 className="text-2xl font-semibold text-white">
              Cosa devi o puoi fare tu
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Spapple fa i calcoli difficili, ma tu sei il Direttore dei
              Lavori. La routine cambia in base al mercato attivo e resta
              separata tra azioni e crypto.
            </p>
          </div>
        </div>
        <ol className="mt-5 grid gap-3 md:grid-cols-2">
          {activeRoutineSteps.map((step, index) => (
            <li
              key={step.title}
              className="rounded-lg border border-slate-800 bg-slate-950 p-4 text-sm leading-6 text-slate-300"
            >
              <p className="font-semibold text-white">
                <span className="mr-2 text-[#deff9a]">{index + 1}.</span>
                {step.title}
              </p>
              <p className="mt-2 text-slate-400">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-lg border border-[#deff9a]/25 bg-[#deff9a]/10 p-6">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-1 h-5 w-5 shrink-0 text-[#deff9a]" />
          <p className="text-sm leading-6 text-slate-200">
            Niente grafici complessi da interpretare e niente ansia durante
            l’orario di lavoro: Spapple è progettato per darti una routine
            semplice, serale e disciplinata. Tutto qui: il sistema lavora per
            darti decisioni fredde, matematiche e prudenti.
          </p>
        </div>
      </section>
    </div>
  )
}
