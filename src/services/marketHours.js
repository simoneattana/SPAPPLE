const MARKET_SCAN_INTERVAL_MS = 15 * 60_000

const SESSION_GROUPS = {
  crypto: [
    {
      id: 'crypto',
      label: 'Crypto legacy',
      timezone: 'Europe/Rome',
      scanStart: { hour: 0, minute: 0 },
      blockNewEntries: { hour: 23, minute: 59 },
      riskReview: { hour: 23, minute: 59 },
      protectiveClose: { hour: 23, minute: 59 },
      marketClose: { hour: 23, minute: 59 },
    },
  ],
  equities: [
    {
      id: 'europe',
      label: 'Europa',
      timezone: 'Europe/Rome',
      scanStart: { hour: 9, minute: 5 },
      blockNewEntries: { hour: 17, minute: 0 },
      riskReview: { hour: 17, minute: 10 },
      protectiveClose: { hour: 17, minute: 20 },
      marketClose: { hour: 17, minute: 30 },
    },
  ],
  usa: [
    {
      id: 'usa',
      label: 'USA',
      timezone: 'America/New_York',
      scanStart: { hour: 9, minute: 35 },
      blockNewEntries: { hour: 15, minute: 30 },
      riskReview: { hour: 15, minute: 40 },
      protectiveClose: { hour: 15, minute: 50 },
      marketClose: { hour: 16, minute: 0 },
    },
  ],
  asia: [
    {
      id: 'tokyo',
      label: 'Tokyo',
      timezone: 'Asia/Tokyo',
      tickerSuffixes: ['.TSE'],
      scanStart: { hour: 9, minute: 5 },
      blockNewEntries: { hour: 15, minute: 0 },
      riskReview: { hour: 15, minute: 10 },
      protectiveClose: { hour: 15, minute: 20 },
      marketClose: { hour: 15, minute: 30 },
    },
    {
      id: 'hong-kong',
      label: 'Hong Kong',
      timezone: 'Asia/Hong_Kong',
      tickerSuffixes: ['.HK'],
      scanStart: { hour: 9, minute: 35 },
      blockNewEntries: { hour: 15, minute: 30 },
      riskReview: { hour: 15, minute: 45 },
      protectiveClose: { hour: 16, minute: 0 },
      marketClose: { hour: 16, minute: 8 },
    },
  ],
}

function toMinutes(time) {
  return time.hour * 60 + time.minute
}

function formatTime(time) {
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(
    2,
    '0',
  )}`
}

function getTimeInTimezone(date = new Date(), timezone = 'Europe/Rome') {
  const parts = new Intl.DateTimeFormat('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: timezone,
  }).formatToParts(date)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value)
  const second = Number(parts.find((part) => part.type === 'second')?.value)

  return { hour, minute, second }
}

function getSessions(strategy, ticker = null) {
  const sessions = SESSION_GROUPS[strategy?.id] || SESSION_GROUPS.equities

  if (!ticker || strategy?.id !== 'asia') {
    return sessions
  }

  const normalizedTicker = String(ticker).toUpperCase()
  const matched = sessions.find((session) =>
    (session.tickerSuffixes || []).some((suffix) =>
      normalizedTicker.endsWith(suffix),
    ),
  )

  return matched ? [matched] : sessions
}

function getSessionStatus(session, date = new Date()) {
  const localTime = getTimeInTimezone(date, session.timezone)
  const currentMinutes = localTime.hour * 60 + localTime.minute
  const scanStartMinutes = toMinutes(session.scanStart)
  const blockMinutes = toMinutes(session.blockNewEntries)
  const riskReviewMinutes = toMinutes(session.riskReview)
  const protectiveMinutes = toMinutes(session.protectiveClose)
  const closeMinutes = toMinutes(session.marketClose)
  const seconds =
    Number.isFinite(localTime.second) && localTime.second > 0
      ? localTime.second
      : 0

  if (!Number.isFinite(currentMinutes)) {
    return {
      ...session,
      isOpenForScan: false,
      newEntriesBlocked: true,
      riskReviewActive: false,
      protectiveCloseActive: false,
      minutesToClose: null,
    }
  }

  return {
    ...session,
    currentMinutes,
    scanStartLabel: formatTime(session.scanStart),
    blockNewEntriesLabel: formatTime(session.blockNewEntries),
    riskReviewLabel: formatTime(session.riskReview),
    protectiveCloseLabel: formatTime(session.protectiveClose),
    marketCloseLabel: formatTime(session.marketClose),
    isOpenForScan:
      currentMinutes >= scanStartMinutes && currentMinutes < blockMinutes,
    newEntriesBlocked:
      currentMinutes < scanStartMinutes || currentMinutes >= blockMinutes,
    riskReviewActive:
      currentMinutes >= riskReviewMinutes && currentMinutes < closeMinutes,
    protectiveCloseActive:
      currentMinutes >= protectiveMinutes && currentMinutes < closeMinutes,
    minutesToClose: Math.max(
      0,
      closeMinutes - currentMinutes - (seconds > 0 ? 1 : 0),
    ),
  }
}

function getSecondsUntilScanStart(session, date = new Date()) {
  const localTime = getTimeInTimezone(date, session.timezone)
  const currentSeconds =
    localTime.hour * 3600 + localTime.minute * 60 + localTime.second
  const scanStartSeconds =
    session.scanStart.hour * 3600 + session.scanStart.minute * 60

  if (!Number.isFinite(currentSeconds)) {
    return MARKET_SCAN_INTERVAL_MS / 1000
  }

  return currentSeconds < scanStartSeconds
    ? scanStartSeconds - currentSeconds
    : 24 * 3600 - currentSeconds + scanStartSeconds
}

export function getMarketSessionStatus(strategy, date = new Date(), ticker = null) {
  const statuses = getSessions(strategy, ticker).map((session) =>
    getSessionStatus(session, date),
  )

  return statuses.find((status) => status.riskReviewActive) || statuses[0]
}

export function isMarketCloseGuardActive(strategy, date = new Date(), ticker = null) {
  return getSessions(strategy, ticker).some(
    (session) => getSessionStatus(session, date).riskReviewActive,
  )
}

export function isMarketScanBlocked(strategy, date = new Date(), ticker = null) {
  return !getSessions(strategy, ticker).some(
    (session) => getSessionStatus(session, date).isOpenForScan,
  )
}

export function getMarketCloseGuardLabel(strategy, ticker = null) {
  const session = getSessions(strategy, ticker)[0]

  return `${session.label} ${formatTime(session.riskReview)}-${formatTime(
    session.marketClose,
  )}`
}

export function getMarketScanStartLabel(strategy) {
  return getSessions(strategy)
    .map((session) => `${session.label} ${formatTime(session.scanStart)}`)
    .join(' / ')
}

export function getNextMarketScanAt(strategy, from = new Date()) {
  const secondsUntilStart = Math.min(
    ...getSessions(strategy).map((session) =>
      getSecondsUntilScanStart(session, from),
    ),
  )

  return new Date(from.getTime() + secondsUntilStart * 1000)
}

export function calculatePreCloseRiskScore({
  position,
  latestPrice,
  pnlEur,
  sessionStatus,
}) {
  const invested = Number(position?.invested)
  const entryPrice = Number(position?.entryPrice)
  const atr = Number(position?.atrAtEntry)
  const stopLoss = Number(position?.stopLoss)
  const price = Number(latestPrice)
  const pnlPct =
    Number.isFinite(invested) && invested > 0 && Number.isFinite(Number(pnlEur))
      ? (Number(pnlEur) / invested) * 100
      : 0
  const atrPct =
    Number.isFinite(atr) && Number.isFinite(entryPrice) && entryPrice > 0
      ? (atr / entryPrice) * 100
      : 0
  const stopDistancePct =
    Number.isFinite(stopLoss) && Number.isFinite(price) && price > 0
      ? position.type === 'LONG'
        ? ((price - stopLoss) / price) * 100
        : ((stopLoss - price) / price) * 100
      : null
  const minutesToClose = Number(sessionStatus?.minutesToClose)

  let score = 0

  if (pnlPct < 0) {
    score += Math.min(35, Math.abs(pnlPct) * 28)
  } else if (pnlPct < 0.05) {
    score += 8
  }

  if (atrPct > 3) {
    score += 20
  } else if (atrPct > 1.5) {
    score += 10
  }

  if (Number.isFinite(stopDistancePct)) {
    if (stopDistancePct <= 0) {
      score += 35
    } else if (stopDistancePct < 0.15) {
      score += 25
    } else if (stopDistancePct < 0.35) {
      score += 15
    } else if (stopDistancePct < 0.75) {
      score += 8
    }
  }

  if (Number.isFinite(minutesToClose)) {
    if (minutesToClose <= 10) {
      score += 20
    } else if (minutesToClose <= 20) {
      score += 12
    } else if (sessionStatus?.riskReviewActive) {
      score += 6
    }
  }

  if (sessionStatus?.protectiveCloseActive) {
    score += 10
  }

  return Math.min(100, Math.round(score))
}

export function getPreCloseProtectionDecision({
  position,
  latestPrice,
  pnlEur,
  sessionStatus,
}) {
  if (!sessionStatus?.riskReviewActive) {
    return {
      shouldClose: false,
      exitReason: null,
      riskScore: 0,
      message: 'Fuori dalla finestra pre-chiusura.',
    }
  }

  const invested = Number(position?.invested)
  const pnlPct =
    Number.isFinite(invested) && invested > 0 && Number.isFinite(Number(pnlEur))
      ? (Number(pnlEur) / invested) * 100
      : 0
  const riskScore = calculatePreCloseRiskScore({
    position,
    latestPrice,
    pnlEur,
    sessionStatus,
  })
  const minutesToClose = Number(sessionStatus.minutesToClose)

  if (pnlPct >= 0.05) {
    return {
      shouldClose: true,
      exitReason: 'PRE_CLOSE_PROFIT_LOCK',
      riskScore,
      message: 'Utile disponibile prima della chiusura: profitto consolidato.',
    }
  }

  if (pnlPct >= 0 && Number.isFinite(minutesToClose) && minutesToClose <= 15) {
    return {
      shouldClose: true,
      exitReason: 'PRE_CLOSE_CAPITAL_PROTECTION',
      riskScore,
      message: 'Posizione a pareggio o positiva negli ultimi minuti: capitale protetto.',
    }
  }

  if (riskScore >= 65) {
    return {
      shouldClose: true,
      exitReason: 'PRE_CLOSE_RISK',
      riskScore,
      message: 'Rischio pre-chiusura elevato: esposizione overnight evitata.',
    }
  }

  if (sessionStatus.protectiveCloseActive && riskScore >= 50) {
    return {
      shouldClose: true,
      exitReason: 'PRE_CLOSE_RISK',
      riskScore,
      message: 'Finestra finale attiva e rischio non trascurabile.',
    }
  }

  return {
    shouldClose: false,
    exitReason: null,
    riskScore,
    message: `Rischio pre-chiusura ${riskScore}/100: posizione mantenuta.`,
  }
}
