import React, { useMemo, useState, useEffect, useRef } from 'react'
import { format } from 'date-fns'
import { loadState, saveState, seedIfEmpty } from './state/storage.js'
import { ensureNotificationPermission, scheduleTick } from './utils/notify.js'
import Dashboard from './components/Dashboard.jsx'
import Users from './components/Users.jsx'

const TABS = ['Today', 'Daily', 'Weekly', 'Monthly']

export default function App() {
  seedIfEmpty()
  const [route, setRoute] = useState('dashboard') // 'dashboard' | 'users'
  const [tab, setTab] = useState('Today')
  const [state, setState] = useState(loadState())

  // ----- Theme handling -----
  const [dark, setDark] = useState(state?.prefs?.dark || false)
  const [autoNight, setAutoNight] = useState(
    state?.prefs?.autoNight === undefined ? true : !!state.prefs.autoNight
  )
  const nightTimerRef = useRef(null)

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    const newState = {
      ...state,
      prefs: { ...(state.prefs || {}), dark, autoNight }
    }
    saveState(newState)
  }, [dark, autoNight])

  useEffect(() => {
    saveState(state)
  }, [state])

  useEffect(() => {
    ensureNotificationPermission()
    const stop = scheduleTick(() => {}, 60_000)
    return stop
  }, [])

  const todayStr = format(new Date(), 'EEEE, MMMM d, yyyy')
  useEffect(() => {
    document.title = `Chore Chart — ${todayStr}`
  }, [todayStr])

  useEffect(() => {
    if (nightTimerRef.current) {
      clearTimeout(nightTimerRef.current)
      nightTimerRef.current = null
    }
    if (autoNight) {
      setDark(isNightNow())
      nightTimerRef.current = scheduleNextNightFlip(() => setDark(isNightNow()))
      return () => {
        if (nightTimerRef.current) clearTimeout(nightTimerRef.current)
      }
    }
  }, [autoNight])

  const value = useMemo(() => ({ state, setState }), [state])

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>CHORE CHART</h1>
          <div className="sub">{todayStr}</div>
        </div>
        <div className="actions">
          <label className="switch" title={autoNight ? 'Automatic at night' : 'Toggle theme'}>
            <input
              type="checkbox"
              checked={dark}
              onChange={() => setDark(v => !v)}
              disabled={autoNight}
            />
            <span>Dark mode</span>
          </label>

          <label className="switch" title="Automatically enable dark mode at night (19:00–07:00)">
            <input
              type="checkbox"
              checked={autoNight}
              onChange={() => setAutoNight(v => !v)}
            />
            <span>Auto night</span>
          </label>

          <button
            className={route === 'dashboard' ? 'btn secondary active' : 'btn'}
            onClick={() => setRoute('dashboard')}
          >
            Dashboard
          </button>
          <button
            className={route === 'users' ? 'btn secondary active' : 'btn'}
            onClick={() => setRoute('users')}
          >
            Users
          </button>
        </div>
      </header>

      {route === 'dashboard' && (
        <Dashboard
          tab={tab}
          setTab={setTab}
          state={state}
          setState={setState}
          tabs={TABS}
        />
      )}

      {route === 'users' && <Users state={state} setState={setState} />}

      <footer className="footer">
        <small>
          Copyright @ 28 w***** w**
        </small>
      </footer>
    </div>
  )
}

// Night definition: 19:00–07:00 local time
function isNightNow(date = new Date()) {
  const h = date.getHours()
  return h >= 19 || h < 7
}

function scheduleNextNightFlip(cb) {
  const now = new Date()
  const h = now.getHours()
  let next

  if (h >= 19 || h < 7) {
    next = new Date(now)
    if (h >= 19) next.setDate(now.getDate() + 1)
    next.setHours(7, 0, 0, 0)
  } else {
    next = new Date(now)
    next.setHours(19, 0, 0, 0)
  }

  const ms = Math.max(1000, next.getTime() - now.getTime())
  const id = setTimeout(() => {
    cb()
    scheduleNextNightFlip(cb)
  }, ms)
  return id
}
