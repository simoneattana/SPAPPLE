// Diario di bordo del motore: voci di attivita e log.

import { ACTIVITY_LOG_LIMIT } from './constants.js'
import { createId } from './format.js'

export function createActivity({ type = 'system', status = 'done', title, detail }) {
  return {
    id: createId(type),
    type,
    status,
    title,
    detail,
    createdAt: new Date().toISOString(),
  }
}

export function appendActivity(state, activity) {
  return [activity, ...(state.activityLog || [])].slice(0, ACTIVITY_LOG_LIMIT)
}

export function appendLogs(state, activity) {
  return {
    activityLog: appendActivity(state, activity),
    events: [activity, ...(state.events || [])],
  }
}
