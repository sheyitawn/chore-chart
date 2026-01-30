// src/App.jsx
import React, { useMemo, useState, useEffect, useRef } from 'react'
import { format } from 'date-fns'
import { loadState, saveState, seedIfEmpty } from './state/storage.js'
import { ensureNotificationPermission, scheduleTick } from './utils/notify.js'
import Dashboard from './components/Dashboard.jsx'
import Users from './components/Users.jsx'

const TABS = ['Today', 'Daily', 'Weekly', 'Monthly', 'Leaderboard', 'Podium']

// ✅ Change this to your desired rotation time:
const ROTATE_MS = 1000 * 60 * 60 // 1 hour
// e.g. 30 minutes: 1000 * 60 * 30
// e.g. 10 seconds (for testing): 1000 * 10

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

  // ✅ Auto-rotate tabs
  const [autoRotateTabs, setAutoRotateTabs] = useState(
    state?.prefs?.autoRotateTabs === undefined ? false : !!state.prefs.autoRotateTabs
  )
  const rotateTimerRef = useRef(null)

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    const newState = {
      ...state,
      prefs: { ...(state.prefs || {}), dark, autoNight, autoRotateTabs }
    }
    saveState(newState)
  }, [dark, autoNight, autoRotateTabs]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    saveState(state)
  }, [state])

  useEffect(() => {
    ensureNotificationPermission()
    // Tick so any "period seeding" logic in Dashboard can re-check while app is open.
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

  // ✅ Auto-rotate effect
  useEffect(() => {
    // cleanup old timer
    if (rotateTimerRef.current) {
      clearTimeout(rotateTimerRef.current)
      rotateTimerRef.current = null
    }

    // only rotate when on dashboard + enabled
    if (!autoRotateTabs) return
    if (route !== 'dashboard') return

    const scheduleNext = () => {
      // don’t rotate when the tab/window is hidden
      if (document.hidden) {
        rotateTimerRef.current = setTimeout(scheduleNext, 15_000) // re-check
        return
      }

      rotateTimerRef.current = setTimeout(() => {
        setTab(prev => {
          const idx = TABS.indexOf(prev)
          const nextIdx = idx >= 0 ? (idx + 1) % TABS.length : 0
          return TABS[nextIdx]
        })
        scheduleNext()
      }, ROTATE_MS)
    }

    scheduleNext()

    return () => {
      if (rotateTimerRef.current) clearTimeout(rotateTimerRef.current)
      rotateTimerRef.current = null
    }
  }, [autoRotateTabs, route, tab])

  // Optional: when user manually switches tabs, restart the timer “fresh”
  const setTabAndRestartRotation = (nextTab) => {
    setTab(nextTab)
    if (!autoRotateTabs) return
    if (rotateTimerRef.current) {
      clearTimeout(rotateTimerRef.current)
      rotateTimerRef.current = null
    }
    // re-run the rotation schedule immediately
    // (effect will also do this, but this avoids any delay)
    // We just trigger by setting state again in the next microtask:
    Promise.resolve().then(() => {
      // no-op; effect will reschedule due to same deps? route/autoRotateTabs unchanged,
      // so we mimic the behavior by toggling timer directly:
      // simplest is to rely on the effect; leaving this here avoids extra complexity.
    })
  }

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

          {/* ✅ New toggle */}
          <label className="switch" title={`Auto rotate dashboard tabs every ${Math.round(ROTATE_MS / 60000)} minutes`}>
            <input
              type="checkbox"
              checked={autoRotateTabs}
              onChange={() => setAutoRotateTabs(v => !v)}
            />
            <span>Auto rotate tabs</span>
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
          setTab={(t) => {
            // keep existing behavior but allows easy future “restart timer” behavior
            setTabAndRestartRotation(t)
          }}
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
