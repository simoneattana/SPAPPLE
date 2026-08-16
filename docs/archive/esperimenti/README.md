# Esperimenti recuperati dai branch cancellati

Il 2026-08-16 il repository è passato a **branch unico `main`**. I branch remoti
creati da agenti esterni sono stati eliminati, ma il lavoro che contenevano è
salvato qui.

## 0001-Sperimenta-strategia-liquidita-eventi.patch

Da `codex/spapple-liquidita-eventi`, commit `bb494809482395aaf3eab785d727cf0d9438ae89`,
20 luglio 2026. Mai unito a main.

Introduce un punteggio di opportunità basato su liquidità ed eventi:
`src/services/opportunityScoring.js` (nuovo, 114 righe), più le modifiche di
innesto in `api/_tradingEngine.js` e `src/context/TradingContext.jsx` e la nota
di progetto `docs/strategia-liquidita-eventi.md`.

Per riapplicarlo su main:

```bash
git apply --3way docs/archive/esperimenti/0001-Sperimenta-strategia-liquidita-eventi.patch
```

Attenzione: è stato scritto prima della scelta IBKR e prima del ripristino su
Neon, quindi va riletto alla luce del modello costi attuale.

## Branch eliminati, per riferimento

| Branch | Ultimo commit | Contenuto |
|---|---|---|
| `codex/spapple-liquidita-eventi` | `bb49480` (2026-07-20) | l'esperimento salvato qui sopra |
| `v0/simoneattana-85e45941` | `2e4a52b` (2026-06-24) | scaffold iniziale di v0, storia non collegata a main, superato |
