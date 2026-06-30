export const POSITION_SIZE_PERCENT = 0.1
export const MIN_POSITION_SIZE = 1000
export const MAX_POSITION_SIZE = 5000
export const LEGACY_POSITION_SIZE = 2000

export const DEFAULT_POSITION_SIZING = {
  mode: 'percentuale_capitale',
  percent: POSITION_SIZE_PERCENT,
  min: MIN_POSITION_SIZE,
  max: MAX_POSITION_SIZE,
}

export function calculatePositionSize(capital, sizing = DEFAULT_POSITION_SIZING) {
  const availableCapital = Number(capital)

  if (!Number.isFinite(availableCapital) || availableCapital <= 0) {
    return 0
  }

  const percent = Number.isFinite(Number(sizing.percent))
    ? Number(sizing.percent)
    : POSITION_SIZE_PERCENT
  const min = Number.isFinite(Number(sizing.min))
    ? Number(sizing.min)
    : MIN_POSITION_SIZE
  const max = Number.isFinite(Number(sizing.max))
    ? Number(sizing.max)
    : MAX_POSITION_SIZE
  const rawSize = availableCapital * percent
  const cappedSize = Math.min(Math.max(rawSize, min), max)

  return Math.min(cappedSize, availableCapital)
}

export function canOpenPosition(capital, sizing = DEFAULT_POSITION_SIZING) {
  const min = Number.isFinite(Number(sizing.min))
    ? Number(sizing.min)
    : MIN_POSITION_SIZE

  return calculatePositionSize(capital, sizing) >= min
}
