// Ordini simulati: creazione, compattazione, deduplica e ricostruzione degli
// ordini di chiusura storici.

import { MAX_ORDER_AUDIT_RECORDS, ORDER_RETENTION_MS } from './constants.js'
import { createId, normalizeIdPart, roundPrice, roundQuantity } from './format.js'

export function getOpenOrderSide(type) {
  return type === 'LONG' ? 'BUY' : 'SELL_SHORT'
}

export function getCloseOrderSide(type) {
  return type === 'LONG' ? 'SELL' : 'BUY_TO_COVER'
}

export function isRecentOrder(order, now = Date.now()) {
  const timestamp = new Date(
    order?.createdAt || order?.executedAt || order?.submittedAt || 0,
  ).getTime()

  return Number.isFinite(timestamp) && now - timestamp <= ORDER_RETENTION_MS
}

export function compactOrder(order) {
  if (!order?.id) {
    return null
  }

  const compacted = {
    id: order.id,
    marketId: order.marketId || null,
    marketLabel: order.marketLabel || null,
    action: order.action || null,
    side: order.side || null,
    direction: order.direction || null,
    status: order.status || 'ESEGUITO',
    source: order.source || 'system',
    ticker: order.ticker || null,
    positionId: order.positionId || null,
    quantity: Number.isFinite(Number(order.quantity))
      ? roundQuantity(Number(order.quantity))
      : null,
    notional: Number.isFinite(Number(order.notional))
      ? roundPrice(Number(order.notional))
      : 0,
    requestedPrice: Number.isFinite(Number(order.requestedPrice))
      ? roundPrice(Number(order.requestedPrice))
      : null,
    executedPrice: Number.isFinite(Number(order.executedPrice))
      ? roundPrice(Number(order.executedPrice))
      : null,
    executedPriceEur: Number.isFinite(Number(order.executedPriceEur))
      ? roundPrice(Number(order.executedPriceEur))
      : null,
    executionCosts: order.executionCosts || null,
    fee: Number.isFinite(Number(order.fee)) ? roundPrice(Number(order.fee)) : null,
    reason: order.reason || null,
    dataQuality: order.dataQuality || null,
    createdAt: order.createdAt || order.executedAt || new Date().toISOString(),
    executedAt: order.executedAt || null,
  }

  return Object.fromEntries(
    Object.entries(compacted).filter(([, value]) => value !== null),
  )
}

export function dedupeOrders(orders = []) {
  const normalizedOrders = Array.isArray(orders) ? orders : []
  const byKey = new Map()
  const now = Date.now()

  normalizedOrders.forEach((order) => {
    if (!order?.id || !isRecentOrder(order, now)) {
      return
    }

    const compactedOrder = compactOrder(order)

    if (!compactedOrder) {
      return
    }

    const key =
      compactedOrder.action === 'CLOSE' && compactedOrder.positionId
        ? `close-${compactedOrder.positionId}`
        : `order-${compactedOrder.id}`
    const current = byKey.get(key)

    if (
      !current ||
      new Date(compactedOrder.createdAt || 0) > new Date(current.createdAt || 0)
    ) {
      byKey.set(key, compactedOrder)
    }
  })

  return [...byKey.values()]
    .sort(
      (first, second) =>
        new Date(second.createdAt || 0) - new Date(first.createdAt || 0),
    )
    .slice(0, MAX_ORDER_AUDIT_RECORDS)
}

export function appendOrders(state, orders) {
  const nextOrders = Array.isArray(orders) ? orders : [orders]
  return dedupeOrders([...nextOrders, ...(state.orders || [])])
}

// source non ha default: le due copie ne avevano due diversi, 'backend-monitor'
// lato server e 'manual' lato browser, e l'ordine finiva etichettato male.
// Se il chiamante lo dimentica, compactOrder ripiega su 'system', che si vede.
export function createSimulationOrder({
  action,
  direction,
  executedPrice = null,
  executedPriceEur = null,
  executionCosts = null,
  fee = 0,
  marketId,
  marketLabel,
  notional = 0,
  positionId = null,
  quantity = null,
  reason,
  requestedPrice = null,
  side,
  source,
  status = 'ESEGUITO',
  ticker,
}) {
  const now = new Date().toISOString()
  const normalizedPrice = Number(executedPrice ?? requestedPrice)
  const normalizedNotional = Number(notional)
  const normalizedQuantity =
    Number.isFinite(Number(quantity)) && Number(quantity) > 0
      ? Number(quantity)
      : Number.isFinite(normalizedPrice) && normalizedPrice > 0
        ? normalizedNotional / normalizedPrice
        : null

  return compactOrder({
    id: createId('order'),
    marketId,
    marketLabel,
    action,
    side,
    direction,
    status,
    source,
    ticker,
    positionId,
    quantity: Number.isFinite(normalizedQuantity)
      ? roundQuantity(normalizedQuantity)
      : null,
    notional: Number.isFinite(normalizedNotional)
      ? roundPrice(normalizedNotional)
      : 0,
    requestedPrice: Number.isFinite(Number(requestedPrice))
      ? roundPrice(Number(requestedPrice))
      : null,
    executedPrice: Number.isFinite(Number(executedPrice))
      ? roundPrice(Number(executedPrice))
      : null,
    executedPriceEur: Number.isFinite(Number(executedPriceEur))
      ? roundPrice(Number(executedPriceEur))
      : null,
    executionCosts,
    fee,
    slippagePct: 0,
    reason,
    createdAt: now,
    submittedAt: status === 'RIFIUTATO' ? null : now,
    executedAt: status === 'ESEGUITO' ? now : null,
  })
}

export function createLegacyCloseOrderId(marketId, trade, index) {
  return [
    'legacy-close',
    marketId,
    normalizeIdPart(trade.ticker),
    normalizeIdPart(trade.openedAt),
    normalizeIdPart(trade.exitDate),
    index,
  ].join('-')
}

export function hasCompleteLegacyTradeData(trade) {
  return (
    Number.isFinite(Number(trade.entryPrice)) &&
    Number(trade.entryPrice) > 0 &&
    Number.isFinite(Number(trade.exitPrice)) &&
    Number(trade.exitPrice) > 0 &&
    Number.isFinite(Number(trade.pnlEur)) &&
    Number.isFinite(Number(trade.recoveredCapital))
  )
}

export function createLegacyCloseOrder(trade, marketId, marketLabel, index) {
  const complete = hasCompleteLegacyTradeData(trade)
  const id = trade.closeOrderId || createLegacyCloseOrderId(marketId, trade, index)
  const positionId =
    trade.positionId ||
    `legacy-position-${marketId}-${normalizeIdPart(trade.ticker)}-${normalizeIdPart(
      trade.openedAt || trade.exitDate,
    )}-${index}`
  const entryPrice = Number(trade.entryPrice)
  const exitPrice = Number(trade.exitPrice)
  const invested = Number(trade.invested)
  const recoveredCapital = Number(trade.recoveredCapital)
  const quantity =
    complete && Number.isFinite(invested) && invested > 0
      ? invested / entryPrice
      : null
  const createdAt = trade.exitDate || new Date().toISOString()

  return compactOrder({
    id,
    marketId,
    marketLabel,
    action: 'CLOSE',
    side: getCloseOrderSide(trade.type),
    direction: trade.type,
    status: 'ESEGUITO',
    source: 'legacy-backfill',
    ticker: trade.ticker,
    positionId,
    quantity: Number.isFinite(quantity) ? roundQuantity(quantity) : null,
    notional: Number.isFinite(recoveredCapital)
      ? roundPrice(recoveredCapital)
      : Number.isFinite(invested)
        ? roundPrice(invested)
        : 0,
    requestedPrice: complete ? roundPrice(exitPrice) : null,
    executedPrice: complete ? roundPrice(exitPrice) : null,
    fee: 0,
    slippagePct: 0,
    reason: complete
      ? 'Ordine storico ricostruito da una chiusura già registrata.'
      : 'Ordine storico ricostruito con dati incompleti: prezzi o P/L legacy non disponibili.',
    dataQuality: complete ? 'complete' : 'incomplete',
    createdAt,
    submittedAt: createdAt,
    executedAt: createdAt,
  })
}

export function backfillLegacyCloseOrders(
  marketId,
  marketLabel,
  history = [],
  orders = [],
) {
  const existingOrderIds = new Set(orders.map((order) => order?.id).filter(Boolean))
  const nextOrders = [...orders]
  let changed = false
  const nextHistory = history.map((trade, index) => {
    if (!trade?.ticker || !trade?.exitDate) {
      return trade
    }

    const order = createLegacyCloseOrder(trade, marketId, marketLabel, index)
    const positionId = trade.positionId || order.positionId
    const nextTrade = {
      ...trade,
      positionId,
      closeOrderId: trade.closeOrderId || order.id,
      dataQuality: hasCompleteLegacyTradeData(trade) ? 'complete' : 'incomplete',
      legacyBackfilled: true,
    }

    if (!existingOrderIds.has(order.id)) {
      nextOrders.push(order)
      existingOrderIds.add(order.id)
      changed = true
    }

    if (
      nextTrade.positionId !== trade.positionId ||
      nextTrade.closeOrderId !== trade.closeOrderId ||
      nextTrade.dataQuality !== trade.dataQuality ||
      nextTrade.legacyBackfilled !== trade.legacyBackfilled
    ) {
      changed = true
      return nextTrade
    }

    return trade
  })

  return {
    changed,
    history: nextHistory,
    orders: nextOrders.sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
    ),
  }
}
