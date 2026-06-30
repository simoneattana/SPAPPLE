export const POSITION_SIZE_PERCENT = 0.1
export const MIN_POSITION_SIZE = 1000
export const MAX_POSITION_SIZE = 5000
export const LEGACY_POSITION_SIZE = 2000

export function calculatePositionSize(capital) {
  const availableCapital = Number(capital)

  if (!Number.isFinite(availableCapital) || availableCapital <= 0) {
    return 0
  }

  const rawSize = availableCapital * POSITION_SIZE_PERCENT
  const cappedSize = Math.min(Math.max(rawSize, MIN_POSITION_SIZE), MAX_POSITION_SIZE)

  return Math.min(cappedSize, availableCapital)
}

export function canOpenPosition(capital) {
  return calculatePositionSize(capital) >= MIN_POSITION_SIZE
}

