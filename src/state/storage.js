// src/state/storage.js
import { uid } from '../utils/uid.js'

const KEY = 'chore-chart-state-v1'

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultState()
    const parsed = JSON.parse(raw)

    // Migrations / defaults
    parsed.users = parsed.users || []
    parsed.chores = (parsed.chores || []).map(c => ({
      exemptUserIds: [],
      trackOnLeaderboard: true,
      ...c
    }))
    parsed.completions = parsed.completions || {}
    parsed.prefs = { autoNight: true, ...parsed.prefs }

    return parsed
  } catch {
    return defaultState()
  }
}

export function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify(state))
}

export function seedIfEmpty() {
  if (!localStorage.getItem(KEY)) {
    saveState(defaultState())
  }
}

function defaultState() {
  const users = [
    { id: uid(), name: 'User 1', color: '#6b8afd' },
    { id: uid(), name: 'User 2', color: '#57c08f' },
    { id: uid(), name: 'User 3', color: '#f2c266' },
    { id: uid(), name: 'User 4', color: '#c69cf6' },
  ]

  const chores = [
    { id: uid(), name: 'Clean kitchen counter', frequency: 'daily', icon: '🍽️', sortIndex: 0, rotationStart: Date.now(), exemptUserIds: [], trackOnLeaderboard: true },
    { id: uid(), name: 'Clean kitchen floors', frequency: 'daily', icon: '🫧', sortIndex: 1, rotationStart: Date.now(), exemptUserIds: [], trackOnLeaderboard: true },
    { id: uid(), name: 'Clean sink area', frequency: 'daily', icon: '🧼', sortIndex: 2, rotationStart: Date.now(), exemptUserIds: [], trackOnLeaderboard: true },

    { id: uid(), name: 'Take out trash', frequency: 'weekly', icon: '🗑️', sortIndex: 0, rotationStart: Date.now(), exemptUserIds: [], trackOnLeaderboard: true },
    { id: uid(), name: 'Tidy living room', frequency: 'weekly', icon: '🛋️', sortIndex: 1, rotationStart: Date.now(), exemptUserIds: [], trackOnLeaderboard: true },
    { id: uid(), name: 'Clean stove', frequency: 'weekly', icon: '🍳', sortIndex: 2, rotationStart: Date.now(), exemptUserIds: [], trackOnLeaderboard: true },
    { id: uid(), name: 'Clean bathroom', frequency: 'weekly', icon: '🚿', sortIndex: 3, rotationStart: Date.now(), exemptUserIds: [], trackOnLeaderboard: true },
    { id: uid(), name: 'Clean guest toilet', frequency: 'weekly', icon: '🚽', sortIndex: 4, rotationStart: Date.now(), exemptUserIds: [], trackOnLeaderboard: true },
    { id: uid(), name: 'Clean dining table', frequency: 'weekly', icon: '🍜', sortIndex: 5, rotationStart: Date.now(), exemptUserIds: [], trackOnLeaderboard: true },

    { id: uid(), name: 'Sweep stairs', frequency: 'monthly', icon: '🧹', sortIndex: 0, rotationStart: Date.now(), exemptUserIds: [], trackOnLeaderboard: true },
    { id: uid(), name: 'Trim weeds', frequency: 'monthly', icon: '🪣', sortIndex: 1, rotationStart: Date.now(), exemptUserIds: [], trackOnLeaderboard: true }
  ]

  return {
    users,
    chores,
    completions: {}, // map periodKey -> { choreId: { doneByUserId, at } }
    prefs: {
      dark: false,
      autoNight: true,
      telegram: { botToken: '', chatId: '' },
      emailWebhook: ''
    }
  }
}
