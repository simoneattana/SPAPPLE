import {
  BadgeEuro,
  Bot,
  CalendarClock,
  ClipboardCheck,
  DatabaseZap,
  Globe2,
  Radar,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { useTrading } from '../context/useTrading'
import { getMarketCopy } from '../services/marketCopy'
import { getTradingStrategy } from '../strategies'

const marketCards = [
  {
    id: 'equities',
    title: 'Europa',
    text: 'Azioni europee in euro. È il mercato principale e usa P/E, RSI, ATR, orari europei e protezione pre-chiusura.',
  },
  {
    id: 'usa',
    title: 'USA',
    text: 'Azioni NYSE e Nasdaq. I prezzi restano in USD e Spapple mostra anche il controvalore stimato in euro tramite cambio Forex.',
  },
  {
    id: 'asia',
    title: 'Asia',
    text: 'Tokyo e Hong Kong. I prezzi restano in valuta locale, con conversione in euro per rendere capitale, utili e P/L confrontabili.',
  },
]

const analysisRules = [
  {
    title: "Salute dell'azienda",
    text: 'Spapple considera solo società con P/E positivo. Se il dato è assente, non valido o negativo, il titolo viene scartato prima ancora di valutare il segnale tecnico.',
  },
  {
    title: 'Temperatura del titolo',
    text: 'Il sistema usa RSI per cercare eccessi: sotto 30 cerca rimbalzi Long, sopra 70 cerca correzioni Short. Su Tokyo e Hong Kong la fascia visibile è più morbida: sotto 35 o sopra 65.',
  },
  {
    title: 'Volatilità controllata',
    text: 'ATR misura quanto si muove normalmente un titolo. Il pilota automatico evita asset troppo nervosi e usa ATR per calcolare take profit, trailing profit e stop loss.',
  },
]

const automaticRules = [
  {
    title: 'Pilota automatico di default',
    text: 'Le scansioni e il monitoraggio sono pensati per lavorare in automatico. Tu puoi sempre aggiornare manualmente, ma il sistema deve ridurre al minimo le decisioni impulsive.',
  },
  {
    title: 'Massimo 8 posizioni',
    text: 'Ogni mercato può gestire fino a 8 posizioni aperte. Ogni nuova posizione usa circa il 10% del capitale disponibile, con minimo 1.000€ e massimo 5.000€.',
  },
  {
    title: 'Mercati separati',
    text: 'Europa, USA e Asia hanno capitale, posizioni, ordini, storico e utili separati. I risultati non devono mischiarsi tra loro.',
  },
]

const openingRules = [
  {
    title: 'Quando apre una posizione',
    text: 'Apre solo se il titolo supera i filtri: dati disponibili, P/E positivo, RSI in zona estrema, volatilità accettabile, slot libero, capitale sufficiente e nessun cooldown recente sullo stesso ticker.',
  },
  {
    title: 'Long e Short',
    text: 'Long significa cercare un guadagno se il prezzo sale. Short significa simulare un guadagno se il prezzo scende. La direzione deriva dal segnale RSI.',
  },
  {
    title: 'Orari reali',
    text: 'Spapple non apre nuove posizioni fuori dalla finestra operativa del mercato. Le dashboard e lo scanner mostrano se Europa, USA o Asia sono aperti o chiusi.',
  },
]

const closingRules = [
  {
    title: 'Take profit dinamico',
    text: 'Per le azioni il primo target è circa 0,35% sui titoli tranquilli e circa 0,60% sui titoli più volatili. Dopo il primo target può entrare in gioco il trailing profit.',
  },
  {
    title: 'Stop loss e protezione',
    text: 'Lo stop loss è calcolato con ATR. Se il prezzo va contro la posizione oltre la soglia ammessa, Spapple chiude per limitare la perdita.',
  },
  {
    title: 'Protezione pre-chiusura',
    text: 'Prima della chiusura del mercato, il sistema valuta il rischio di restare esposto overnight. Se conviene proteggere capitale o utile, può chiudere automaticamente.',
  },
]

const userRoutine = [
  {
    title: 'Controlli la dashboard',
    text: 'Vedi capitale, posizioni, utili del giorno, utili del mese, chiusure recenti e stato aperto/chiuso del mercato.',
  },
  {
    title: 'Usi lo scanner unico',
    text: 'Nello Scanner mercati scegli Europa, USA o Asia. Ogni filtro mostra se quel mercato è aperto o chiuso e mantiene separati i dati.',
  },
  {
    title: 'Leggi ordini, utili e storico',
    text: 'Ordini mostra cosa è stato simulato. Utili dà il calendario dei risultati. Storico serve per analizzare le chiusure nel tempo.',
  },
  {
    title: 'Intervieni solo se serve',
    text: 'Puoi chiudere manualmente una posizione, ma l’obiettivo è lasciare lavorare il pilota automatico e valutare i risultati su uno storico significativo.',
  },
]

const limits = [
  'Spapple è una piattaforma di simulazione e forward testing: non esegue ancora ordini reali su broker.',
  'I risultati dipendono dalla qualità e disponibilità dei dati EODHD, dai cambi Forex e dagli orari effettivi dei mercati.',
  'Le festività di borsa possono richiedere controlli aggiuntivi: gli orari mostrati rappresentano la sessione ordinaria.',
  'Un singolo giorno non basta per giudicare la strategia: servono campione storico, win rate, P/L medio e perdita media.',
]

function InfoCard({ icon: Icon, title, text }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3">
        {Icon ? (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--market-accent-border)] bg-[var(--market-accent-soft)]">
            <Icon className="h-5 w-5 text-[var(--market-accent)]" />
          </div>
        ) : null}
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-6 text-slate-400">{text}</p>
      </CardContent>
    </Card>
  )
}

function SectionHeader({ eyebrow, title, children, icon: Icon }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[var(--market-accent-border)] bg-[var(--market-accent-soft)]">
        <Icon className="h-5 w-5 text-[var(--market-accent)]" />
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
          {eyebrow}
        </p>
        <h2 className="mt-1 text-2xl font-semibold text-white">{title}</h2>
        {children ? (
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
            {children}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export default function Explanation() {
  const { activeMarket, marketLabel } = useTrading()
  const marketCopy = getMarketCopy(activeMarket)
  const strategy = getTradingStrategy(activeMarket)
  const universeCount = Array.isArray(strategy.universe)
    ? strategy.universe.length
    : 0
  const maxPositions = strategy.maxPositions || 8

  return (
    <div className="flex flex-1 flex-col gap-7">
      <header className="rounded-lg border border-slate-800 bg-[#090b10] p-6 shadow-xl shadow-black/20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
              Spiegazione operativa · {marketCopy.eyebrow}
            </p>
            <h1 className="mt-3 text-3xl font-semibold text-white">
              Cos’è Spapple
            </h1>
            <p className="mt-4 max-w-4xl text-base leading-7 text-slate-400">
              Spapple è un simulatore professionale di trading quantitativo e
              forward testing. Analizza mercati azionari reali, applica regole
              matematiche di selezione, apre posizioni simulate con un pilota
              automatico prudente e registra ogni ordine, chiusura, utile e
              perdita in modo separato per mercato.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[26rem]">
            <Badge variant="positive">Europa</Badge>
            <Badge variant="default">USA</Badge>
            <Badge variant="default">Asia</Badge>
          </div>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-3">
        {marketCards.map((market) => (
          <InfoCard
            key={market.id}
            icon={Globe2}
            title={market.title}
            text={market.text}
          />
        ))}
      </section>

      <section className="rounded-lg border border-slate-800 bg-[#090b10] p-6 shadow-xl shadow-black/20">
        <SectionHeader
          eyebrow="Dati e mercati"
          title="Come legge il mercato"
          icon={DatabaseZap}
        >
          Il mercato attivo ora è {marketLabel}. La scansione lavora su{' '}
          {universeCount} {marketCopy.assetPlural}, con dati reali da{' '}
          {marketCopy.provider}. USA e Asia mantengono la valuta originale e
          mostrano anche il controvalore in euro.
        </SectionHeader>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {analysisRules.map((rule) => (
            <InfoCard key={rule.title} icon={Radar} {...rule} />
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-[#090b10] p-6 shadow-xl shadow-black/20">
        <SectionHeader
          eyebrow="Apertura posizioni"
          title="Quando decide di comprare o aprire short"
          icon={TrendingUp}
        >
          Il segnale visibile non basta da solo. Il pilota automatico entra solo
          quando qualità del dato, rischio, volatilità, capitale e orario di
          mercato sono coerenti.
        </SectionHeader>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {openingRules.map((rule) => (
            <InfoCard key={rule.title} {...rule} />
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-[#090b10] p-6 shadow-xl shadow-black/20">
        <SectionHeader
          eyebrow="Chiusura posizioni"
          title="Quando decide di vendere"
          icon={ShieldCheck}
        >
          La chiusura può avvenire per target raggiunto, trailing profit, stop
          loss, protezione pre-chiusura o chiusura manuale. Ogni evento viene
          registrato nello storico.
        </SectionHeader>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {closingRules.map((rule) => (
            <InfoCard key={rule.title} {...rule} />
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-[#090b10] p-6 shadow-xl shadow-black/20">
        <SectionHeader
          eyebrow="Money management"
          title="Come gestisce il capitale"
          icon={BadgeEuro}
        >
          Ogni mercato parte da un budget simulato separato e reinveste il
          capitale recuperato, inclusi gli utili. L’obiettivo è misurare se la
          strategia può crescere nel tempo senza mescolare mondi diversi.
        </SectionHeader>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {automaticRules.map((rule) => (
            <InfoCard key={rule.title} icon={Bot} {...rule} />
          ))}
          <InfoCard
            icon={CalendarClock}
            title="Limite operativo"
            text={`Nel mercato attivo Spapple può arrivare fino a ${maxPositions} posizioni aperte. Le nuove aperture rispettano orari di mercato, cooldown e disponibilità del capitale.`}
          />
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-[#090b10] p-6 shadow-xl shadow-black/20">
        <SectionHeader
          eyebrow="Esperienza utente"
          title="Cosa devi guardare tu"
          icon={ClipboardCheck}
        >
          La Regia sistema è stata eliminata perché duplicava informazioni. Ora
          i dati importanti stanno nelle pagine dove servono: dashboard, scanner,
          ordini, utili e storico.
        </SectionHeader>
        <ol className="mt-5 grid gap-3 md:grid-cols-2">
          {userRoutine.map((step, index) => (
            <li
              key={step.title}
              className="rounded-lg border border-slate-800 bg-slate-950 p-4 text-sm leading-6 text-slate-300"
            >
              <p className="font-semibold text-white">
                <span className="mr-2 text-[var(--market-accent)]">
                  {index + 1}.
                </span>
                {step.title}
              </p>
              <p className="mt-2 text-slate-400">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-lg border border-[var(--market-accent-border)] bg-[var(--market-accent-soft)] p-6">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-1 h-5 w-5 shrink-0 text-[var(--market-accent)]" />
          <div>
            <p className="font-semibold text-white">Limiti da ricordare</p>
            <ul className="mt-3 grid gap-2 text-sm leading-6 text-slate-200">
              {limits.map((limit) => (
                <li key={limit}>• {limit}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  )
}
