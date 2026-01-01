// src/components/Dashboard.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { assignedUserForBalancedWithExempt, periodKey } from '../utils/rotation.js'
import { saveState } from '../state/storage.js'
import { uid } from '../utils/uid.js'
import confetti from 'canvas-confetti'
import {
  getTaskInstancesByPeriod,
  markTaskCompleted,
  unmarkTaskCompleted,
  upsertTaskInstance,
  getAllTaskInstances
} from '../state/ledgerDb.js'

export default function Dashboard({ tab, setTab, state, setState, tabs }) {
  // Leaderboard / Podium tabs
  if (tab === 'Leaderboard') {
    return <LeaderboardTab tabs={tabs} tab={tab} setTab={setTab} state={state} />
  }
  if (tab === 'Podium') {
    return <PodiumTab tabs={tabs} tab={tab} setTab={setTab} state={state} />
  }

  const [showModal, setShowModal] = useState(false)
  const [editChore, setEditChore] = useState(null)
  const [hideCompleted, setHideCompleted] = useState(false)

  // ---- Automatic re-render at the next period boundary ----
  const [, forceTick] = useState(0)
  const timerRef = useRef(null)

  useEffect(() => {
    scheduleNextBoundaryTick(tab, () => forceTick(t => t + 1), timerRef)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [tab])

  // ---- Seed current period tasks into IndexedDB (ledger) ----
  // [Unverified] If the app is closed at period rollover, seeding will happen on next open.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await ensureLedgerSeededForNow(state)
      } catch (e) {
        // Avoid crashing UI; ledger is "nice-to-have" for leaderboard/podium.
        // eslint-disable-next-line no-console
        console.warn('Ledger seeding failed:', e)
      }
      if (cancelled) return
    })()
    return () => { cancelled = true }
  }, [state.chores, state.users, state.completions])

  // Helpers
  const users = state.users
  const isCompleted = (chore) => {
    const key = periodKey(state, chore.id, new Date())
    return state.completions[key]?.[chore.id] || null
  }

  // ----- Build visible list(s) -----
  const visibleChores = useMemo(() => {
    const listFor = (freq) => state.chores
      .filter(c => c.frequency === freq)
      .sort((a, b) => {
        const ai = (a.sortIndex ?? Infinity)
        const bi = (b.sortIndex ?? Infinity)
        if (ai !== bi) return ai - bi
        return (a.name || '').localeCompare(b.name || '') || a.id.localeCompare(b.id)
      })

    if (tab !== 'Today') {
      const freq = tab.toLowerCase()
      return listFor(freq)
    }

    // TODAY MODE:
    // - daily: all (due today until done)
    // - weekly/monthly: only those not yet completed in current period
    const daily = listFor('daily')
    const weekly = listFor('weekly').filter(c => !isCompleted(c))
    const monthly = listFor('monthly').filter(c => !isCompleted(c))
    return [...daily, ...weekly, ...monthly]
  }, [state.chores, tab, state.completions])

  // **All done detection for TODAY** (independent of Hide Completed)
  const allDoneToday = useMemo(() => {
    if (tab !== 'Today') return false

    const byFreq = (freq) => state.chores
      .filter(c => c.frequency === freq)
      .sort((a, b) => {
        const ai = (a.sortIndex ?? Infinity)
        const bi = (b.sortIndex ?? Infinity)
        if (ai !== bi) return ai - bi
        return (a.name || '').localeCompare(b.name || '') || a.id.localeCompare(b.id)
      })

    const dueDaily = byFreq('daily')
    const dueWeeklyOpen = byFreq('weekly').filter(c => !isCompleted(c))
    const dueMonthlyOpen = byFreq('monthly').filter(c => !isCompleted(c))

    const dueAll = [...dueDaily, ...dueWeeklyOpen, ...dueMonthlyOpen]
    if (dueAll.length === 0) return false

    const remaining = dueAll.filter(c => !isCompleted(c))
    return remaining.length === 0
  }, [tab, state.chores, state.completions])

  // Fire confetti once per day after "all done" transitions to true
  const lastCelebratedKeyRef = useRef(null)
  useEffect(() => {
    if (tab !== 'Today') return
    if (!allDoneToday) return
    const d = new Date()
    const key = `D:${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
    if (lastCelebratedKeyRef.current === key) return

    burstConfetti()
    lastCelebratedKeyRef.current = key
  }, [tab, allDoneToday])

  // Hidden completed (applied last for normal rendering)
  const choresToRender = useMemo(() => {
    if (!hideCompleted) return visibleChores
    return visibleChores.filter(c => !isCompleted(c))
  }, [visibleChores, hideCompleted, state.completions])

  // ----- Balanced offset per frequency -----
  const rankByIdDaily = useMemo(() => buildRankMap(state.chores, 'daily'), [state.chores])
  const rankByIdWeekly = useMemo(() => buildRankMap(state.chores, 'weekly'), [state.chores])
  const rankByIdMonthly = useMemo(() => buildRankMap(state.chores, 'monthly'), [state.chores])

  const offsetFor = (choreId, freq) => {
    if (freq === 'daily') return rankByIdDaily.get(choreId) ?? 0
    if (freq === 'weekly') return rankByIdWeekly.get(choreId) ?? 0
    return rankByIdMonthly.get(choreId) ?? 0
  }

  // Actions (now also writes to IndexedDB ledger)
  const mark = async (choreId, doneByUserId) => {
    const now = new Date()
    const key = periodKey(state, choreId, now)

    // Update UI state (localStorage) as before
    const completions = { ...state.completions }
    completions[key] = completions[key] || {}
    completions[key][choreId] = { doneByUserId, at: Date.now() }
    const next = { ...state, completions }
    setState(next)
    saveState(next)

    // Update IndexedDB ledger
    const user = state.users.find(u => u.id === doneByUserId)
    try {
      await markTaskCompleted({
        periodKey: key,
        choreId,
        doneByUserId,
        doneByNameSnapshot: user?.name || null
      })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Ledger mark failed:', e)
    }
  }

  const unmark = async (choreId) => {
    const now = new Date()
    const key = periodKey(state, choreId, now)

    // Update UI state
    const completions = { ...state.completions }
    if (completions[key]?.[choreId]) {
      delete completions[key][choreId]
      if (Object.keys(completions[key]).length === 0) delete completions[key]
      const next = { ...state, completions }
      setState(next)
      saveState(next)
    }

    // Update IndexedDB ledger
    try {
      await unmarkTaskCompleted({ periodKey: key, choreId })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Ledger unmark failed:', e)
    }
  }

  const updateChore = (id, patch) => {
    const chores = state.chores.map(c => c.id === id ? { ...c, ...patch } : c)
    const next = { ...state, chores }
    setState(next)
    saveState(next)
  }

  const removeChore = (id) => {
    const chores = state.chores.filter(c => c.id !== id)
    const next = { ...state, chores }
    setState(next)
    saveState(next)
  }

  return (
    <div className="dashboard">
      <div className="tabs">
        {tabs.map(t => (
          <button
            key={t}
            className={t === tab ? 'tab active' : 'tab'}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <label className="switch" style={{ marginRight: 8 }}>
          <input
            type="checkbox"
            checked={hideCompleted}
            onChange={() => setHideCompleted(v => !v)}
          />
          <span>Hide completed</span>
        </label>
        <button className="btn primary" onClick={() => setShowModal(true)}>
          + Add Chore
        </button>
      </div>

      <div className="grid header">
        <div>Chore</div>
        {users.map(u => (
          <div key={u.id} className="center">
            <Avatar user={u} />
            <div className="muted">{u.name}</div>
          </div>
        ))}
      </div>

      {tab === 'Today' && allDoneToday && (
        <div className="celebrate">
          <div className="celebrate-title">All chores completed! Good job, guys! 🎉</div>
          <div className="celebrate-sub">Come back tomorrow for fresh tasks.</div>
          <button className="btn" onClick={burstConfetti}>Celebrate again</button>
        </div>
      )}

      {!allDoneToday && choresToRender.map(chore => {
        const exemptIds = chore.exemptUserIds || []
        const eligibleUsers = users.filter(u => !exemptIds.includes(u.id))
        const offset = offsetFor(chore.id, chore.frequency)
        const idxEligible = assignedUserForBalancedWithExempt(
          chore, users, eligibleUsers, new Date(), offset
        )

        const completion = isCompleted(chore)
        const completedBy = completion ? users.find(u => u.id === completion.doneByUserId) : null
        const completedAt = completion ? new Date(completion.at) : null

        const assignedUser = idxEligible >= 0 ? eligibleUsers[idxEligible] : null

        return (
          <div className={`grid row ${completion ? 'row-done' : ''}`} key={chore.id}>
            <div className="chore-cell">
              <span className="icon">{emojiFor(chore.icon)}</span>
              <div className="chore-info">
                <div className="title">
                  {chore.name}
                  <button className="icon-btn" style={{ marginLeft: 8 }} title="Edit chore"
                    onClick={() => setEditChore(chore)}>⚙️</button>
                </div>
                <div className="pill">{chore.frequency}</div>
                {completion && (
                  <div
                    className="pill done"
                    title={completedAt ? completedAt.toLocaleString() : ''}
                  >
                    Done {completedBy ? `by ${completedBy.name}` : ''}
                  </div>
                )}
                {(!assignedUser && eligibleUsers.length === 0) && (
                  <div className="pill warn">No eligible users (all exempt)</div>
                )}
              </div>
            </div>

            {users.map((u) => {
              const isExempt = (chore.exemptUserIds || []).includes(u.id)
              if (isExempt) {
                return (
                  <div key={u.id} className="center muted exempt">—</div>
                )
              }

              const isAssigned = assignedUser && u.id === assignedUser.id

              if (completion) {
                return (
                  <div key={u.id} className="center">
                    {isAssigned ? (
                      <div className="status-wrap">
                        <span className="status-icon done" title="Completed">✓</span>
                        <button
                          className="link-btn"
                          onClick={() => unmark(chore.id)}
                          title="Undo completion"
                        >
                          Undo
                        </button>
                      </div>
                    ) : (
                      <span className="dot" />
                    )}
                  </div>
                )
              }

              return (
                <div key={u.id} className="center">
                  {isAssigned ? (
                    <button
                      className="warn big"
                      onClick={() => mark(chore.id, u.id)}
                      title={`Mark done by ${u.name}`}
                    >
                      !
                    </button>
                  ) : (
                    <span className="dot" />
                  )}
                </div>
              )
            })}
          </div>
        )
      })}

      {showModal && (
        <AddChoreModal
          users={users}
          onClose={() => setShowModal(false)}
          onAdd={(newChore) => {
            const sameFreq = state.chores.filter(c => c.frequency === newChore.frequency)
            const nextSort =
              Math.max(-1, ...sameFreq.map(c => c.sortIndex ?? -1)) + 1
            const choreWithIndex = {
              ...newChore,
              sortIndex: nextSort,
              exemptUserIds: newChore.exemptUserIds || [],
              trackOnLeaderboard: newChore.trackOnLeaderboard ?? true
            }

            const chores = [choreWithIndex, ...state.chores]
            const next = { ...state, chores }
            setState(next)
            saveState(next)
            setShowModal(false)
          }}
        />
      )}

      {editChore && (
        <EditChoreModal
          users={users}
          chore={editChore}
          onClose={() => setEditChore(null)}
          onSave={(patch) => {
            updateChore(editChore.id, patch)
            setEditChore(null)
          }}
          onDelete={() => {
            removeChore(editChore.id)
            setEditChore(null)
          }}
        />
      )}
    </div>
  )
}

function Avatar({ user }) {
  return (
    <div className="avatar" style={{ borderColor: user.color }}>
      {user.name?.[0]?.toUpperCase() || '?'}
    </div>
  )
}

function AddChoreModal({ users, onClose, onAdd }) {
  const [name, setName] = useState('')
  const [frequency, setFrequency] = useState('weekly')
  const [icon, setIcon] = useState('🧹')
  const [exempt, setExempt] = useState([]) // userIds
  const [trackOnLeaderboard, setTrackOnLeaderboard] = useState(true)

  const toggleExempt = (id) => {
    setExempt(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Add New Chore</h3>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <label>Chore Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Take out trash" />

          <label>Frequency</label>
          <select value={frequency} onChange={e => setFrequency(e.target.value)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>

          <label>Icon</label>
          <div className="icon-grid">
            {['🧹', '🧺', '🧼', '🧽', '🗑️', '🛒', '🍽️', '🚽', '🪣', '🧯', '🧴', '🧊'].map(ic => (
              <button
                key={ic}
                className={icon === ic ? 'icon-select active' : 'icon-select'}
                onClick={() => setIcon(ic)}
              >{ic}</button>
            ))}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={trackOnLeaderboard}
              onChange={() => setTrackOnLeaderboard(v => !v)}
            />
            Track this chore on Leaderboard
          </label>

          <label>Exempt Users</label>
          <div className="exempt-grid">
            {users.map(u => (
              <label key={u.id} className="exempt-item">
                <input
                  type="checkbox"
                  checked={exempt.includes(u.id)}
                  onChange={() => toggleExempt(u.id)}
                />
                <span className="avatar mini" style={{ borderColor: u.color }}>
                  {u.name?.[0]?.toUpperCase() || '?'}
                </span>
                <span>{u.name}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={!name.trim()}
            onClick={() => {
              onAdd({
                id: uid(),
                name: name.trim(),
                frequency,
                icon,
                rotationStart: Date.now(),
                exemptUserIds: exempt,
                trackOnLeaderboard
              })
            }}
          >Add Chore</button>
        </div>
      </div>
    </div>
  )
}

function EditChoreModal({ users, chore, onClose, onSave, onDelete }) {
  const [name, setName] = useState(chore.name)
  const [frequency, setFrequency] = useState(chore.frequency)
  const [icon, setIcon] = useState(chore.icon || '🧹')
  const [exempt, setExempt] = useState(chore.exemptUserIds || [])
  const [trackOnLeaderboard, setTrackOnLeaderboard] = useState(
    chore.trackOnLeaderboard === undefined ? true : !!chore.trackOnLeaderboard
  )

  const toggleExempt = (id) => {
    setExempt(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Edit Chore</h3>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <label>Chore Name</label>
          <input value={name} onChange={e => setName(e.target.value)} />

          <label>Frequency</label>
          <select value={frequency} onChange={e => setFrequency(e.target.value)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>

          <label>Icon</label>
          <div className="icon-grid">
            {['🧹', '🧺', '🧼', '🧽', '🗑️', '🛒', '🍽️', '🚽', '🪣', '🧯', '🧴', '🧊'].map(ic => (
              <button
                key={ic}
                className={icon === ic ? 'icon-select active' : 'icon-select'}
                onClick={() => setIcon(ic)}
              >{ic}</button>
            ))}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={trackOnLeaderboard}
              onChange={() => setTrackOnLeaderboard(v => !v)}
            />
            Track this chore on Leaderboard
          </label>

          <label>Exempt Users</label>
          <div className="exempt-grid">
            {users.map(u => (
              <label key={u.id} className="exempt-item">
                <input
                  type="checkbox"
                  checked={exempt.includes(u.id)}
                  onChange={() => toggleExempt(u.id)}
                />
                <span className="avatar mini" style={{ borderColor: u.color }}>
                  {u.name?.[0]?.toUpperCase() || '?'}
                </span>
                <span>{u.name}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          <button className="btn danger" onClick={onDelete}>Delete</button>
          <div>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button
              className="btn primary"
              disabled={!name.trim()}
              onClick={() => {
                onSave({
                  name: name.trim(),
                  frequency,
                  icon,
                  exemptUserIds: exempt,
                  trackOnLeaderboard
                })
              }}
            >Save</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function emojiFor(ic) { return ic || '🧹' }

function buildRankMap(chores, freq) {
  const map = new Map()
  const list = chores
    .filter(c => c.frequency === freq)
    .sort((a, b) => {
      const ai = a.sortIndex ?? Infinity, bi = b.sortIndex ?? Infinity
      if (ai !== bi) return ai - bi
      return (a.name || '').localeCompare(b.name || '') || a.id.localeCompare(b.id)
    })
  list.forEach((c, i) => map.set(c.id, i))
  return map
}

/** Schedule a one-shot re-render at the next period boundary for the active tab. */
function scheduleNextBoundaryTick(tab, cb, timerRef) {
  if (timerRef.current) clearTimeout(timerRef.current)
  const now = new Date()
  let next

  if (tab === 'Daily' || tab === 'Today') {
    next = new Date(now)
    next.setHours(24, 0, 0, 0)
  } else if (tab === 'Weekly') {
    next = new Date(now)
    const day = next.getDay() === 0 ? 7 : next.getDay()
    const daysUntilMonday = (8 - day) % 7 || 7
    next.setDate(next.getDate() + daysUntilMonday)
    next.setHours(0, 0, 0, 0)
  } else {
    next = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0)
  }

  const ms = Math.max(1000, next.getTime() - now.getTime())
  timerRef.current = setTimeout(() => {
    cb()
    scheduleNextBoundaryTick(tab, cb, timerRef)
  }, ms)
}

/** Confetti burst helper */
function burstConfetti() {
  const defaults = { spread: 72, ticks: 180, gravity: 0.8, startVelocity: 32 }
  confetti({ ...defaults, particleCount: 60, origin: { x: 0.2, y: 0.2 } })
  confetti({ ...defaults, particleCount: 60, origin: { x: 0.8, y: 0.2 } })
  confetti({ ...defaults, particleCount: 80, origin: { x: 0.5, y: 0.1 } })
}

// -------------------- Ledger seeding --------------------

async function ensureLedgerSeededForNow(state) {
  const now = new Date()

  // We seed for each chore's current period key.
  // If missing in IDB, create a task instance row.
  const rankDaily = buildRankMap(state.chores, 'daily')
  const rankWeekly = buildRankMap(state.chores, 'weekly')
  const rankMonthly = buildRankMap(state.chores, 'monthly')

  for (const chore of state.chores) {
    const pk = periodKey(state, chore.id, now)
    const id = `${pk}|${chore.id}`

    // Quick "exists?" by querying the period and scanning.
    // (Keeps code simple; if you want faster, add getTaskInstance() here.)
    const periodRows = await getTaskInstancesByPeriod(pk)
    const exists = periodRows.some(r => r.id === id)
    if (exists) continue

    const exemptIds = chore.exemptUserIds || []
    const eligibleUsers = state.users.filter(u => !exemptIds.includes(u.id))

    const offset =
      chore.frequency === 'daily' ? (rankDaily.get(chore.id) ?? 0)
        : chore.frequency === 'weekly' ? (rankWeekly.get(chore.id) ?? 0)
          : (rankMonthly.get(chore.id) ?? 0)

    const idxEligible = assignedUserForBalancedWithExempt(
      chore,
      state.users,
      eligibleUsers,
      now,
      offset
    )

    const assignedUserId =
      idxEligible >= 0 ? eligibleUsers[idxEligible]?.id : null

    const completion = state.completions?.[pk]?.[chore.id] || null

    await upsertTaskInstance({
      id,
      periodKey: pk,
      choreId: chore.id,
      choreNameSnapshot: chore.name || null,
      frequencySnapshot: chore.frequency,
      assignedUserId,
      createdAt: Date.now(),
      completed: !!completion,
      completedAt: completion?.at ?? null,
      completedByUserId: completion?.doneByUserId ?? null,
      completedByNameSnapshot: completion?.doneByUserId
        ? (state.users.find(u => u.id === completion.doneByUserId)?.name || null)
        : null
    })
  }
}

// -------------------- Leaderboard & Podium tabs --------------------

function LeaderboardTab({ tabs, tab, setTab, state }) {
  const [range, setRange] = useState('all') // all | week | month
  const [rows, setRows] = useState([])
  const [taskCounts, setTaskCounts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const all = await getAllTaskInstances()

      const filtered = filterByRange(all, range)
      const trackedChoreIds = new Set(
        state.chores.filter(c => c.trackOnLeaderboard !== false).map(c => c.id)
      )

      const completed = filtered.filter(t => t.completed && t.completedByUserId)

      const byUser = new Map()
      for (const t of completed) {
        const uid = t.completedByUserId
        const prev = byUser.get(uid) || 0
        byUser.set(uid, prev + 1)
      }

      const userRows = state.users
        .map(u => ({
          userId: u.id,
          name: u.name,
          color: u.color,
          score: byUser.get(u.id) || 0
        }))
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))

      // task completion counts (only for "tracked" chores)
      const byChore = new Map()
      for (const t of completed) {
        if (!trackedChoreIds.has(t.choreId)) continue
        byChore.set(t.choreId, (byChore.get(t.choreId) || 0) + 1)
      }

      const choreRows = state.chores
        .filter(c => trackedChoreIds.has(c.id))
        .map(c => ({
          choreId: c.id,
          name: c.name,
          frequency: c.frequency,
          count: byChore.get(c.id) || 0
        }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

      if (cancelled) return
      setRows(userRows)
      setTaskCounts(choreRows)
      setLoading(false)
    })()

    return () => { cancelled = true }
  }, [range, state.users, state.chores])

  return (
    <div className="dashboard">
      <div className="tabs">
        {tabs.map(t => (
          <button
            key={t}
            className={t === tab ? 'tab active' : 'tab'}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="leaderboard-head">
        <div>
          <h2 style={{ margin: 0 }}>Leaderboard</h2>
          <div className="muted">Who’s completing the most tasks</div>
        </div>

        <div className="leaderboard-controls">
          <span className="muted">Range</span>
          <button className={range === 'all' ? 'btn secondary active' : 'btn'} onClick={() => setRange('all')}>All-time</button>
          <button className={range === 'week' ? 'btn secondary active' : 'btn'} onClick={() => setRange('week')}>Last 7 days</button>
          <button className={range === 'month' ? 'btn secondary active' : 'btn'} onClick={() => setRange('month')}>Last 30 days</button>
        </div>
      </div>

      {loading ? (
        <div className="row">Loading…</div>
      ) : (
        <div className="lb-grid">
          <div className="lb-card">
            <div className="lb-title">People</div>

            {rows.map((r, i) => (
              <div className={`lb-row ${i === 0 ? 'is-top' : ''}`} key={r.userId}>
                <div className="lb-rankChip" title={`Rank ${i + 1}`}>
                  {i === 0 ? '👑' : `#${i + 1}`}
                </div>

                <div className="lb-person">
                  <div className="lb-personMeta">
                    <div className="lb-name">{r.name}</div>
                    <div className="lb-sub muted">{r.score} completed</div>
                  </div>
                </div>



                <div className="lb-scoreChip" title="Completed tasks">
                  {r.score}
                </div>

                <div className="lb-bar" aria-hidden="true">
                  <div
                    className="lb-barFill"
                    style={{
                      width:
                        rows[0]?.score
                          ? `${Math.round((r.score / Math.max(1, rows[0].score)) * 100)}%`
                          : '0%'
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="lb-card">
            <div className="lb-title">Tracked chores</div>
            <div className="muted" style={{ marginBottom: 8 }}>
              Only chores with “Track on Leaderboard” enabled.
            </div>

              {taskCounts.map((c) => (
                <div className="lb-row" key={c.choreId}>
                  <div className="lb-person" style={{ gap: 10 }}>
                    <div className="lb-personMeta">
                      <div className="lb-name">{c.name}</div>
                      <div className="lb-sub muted">{c.frequency} · {c.count} completions</div>
                    </div>
                  </div>

                  <div className="lb-scoreChip" title="Total completions">{c.count}</div>
                  <div className="lb-bar" aria-hidden="true">
                    <div className="lb-barFill" style={{ width: '100%', opacity: 0.20 }} />
                  </div>
                </div>
              ))}

          </div>
        </div>
      )}
    </div>
  )
}

function PodiumTab({ tabs, tab, setTab, state }) {
  const [loading, setLoading] = useState(true)
  const [ordered, setOrdered] = useState([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const all = await getAllTaskInstances()
      const completed = all.filter(t => t.completed && t.completedByUserId)

      const byUser = new Map()
      for (const t of completed) {
        byUser.set(t.completedByUserId, (byUser.get(t.completedByUserId) || 0) + 1)
      }

      const rows = state.users
        .map(u => ({ ...u, score: byUser.get(u.id) || 0 }))
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))

      if (cancelled) return
      setOrdered(rows)
      setLoading(false)
    })()

    return () => { cancelled = true }
  }, [state.users])

  const top1 = ordered[0] || null
  const top2 = ordered[1] || null
  const top3 = ordered[2] || null
  const last = ordered.length ? ordered[ordered.length - 1] : null

  return (
    <div className="dashboard">
      <div className="tabs">
        {tabs.map(t => (
          <button
            key={t}
            className={t === tab ? 'tab active' : 'tab'}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="row">
        <h2 style={{ margin: 0 }}>Podium</h2>
        <div className="muted">Top 3 + the Chaos Goblin</div>
      </div>

      {loading ? (
        <div className="row">Loading…</div>
      ) : (
        <div className="podium-wrap">
          <div className="podium">
            <PodiumBlock place={2} user={top2} height="p2" />
            <PodiumBlock place={1} user={top1} height="p1" />
            <PodiumBlock place={3} user={top3} height="p3" />
          </div>

          <div className="goblin">
            <div className="goblin-header">
                <div className="goblin-bin" aria-hidden="true">🗑️</div>


              <div className="goblin-meta">
                <div className="goblin-titleRow">
                  <div className="goblin-title">Chaos Goblin</div>
                  <div className="goblin-tag">LAST</div>
                </div>
                <div className="goblin-sub">Last place</div>
              </div>
            </div>

            {last ? (
              <div className="goblin-user">
                <div className="goblin-userLeft">
                  <span className="avatar mini" style={{ borderColor: last.color }}>
                    {last.name?.[0]?.toUpperCase() || '?'}
                  </span>
                  <div>
                    <div className="goblin-userName">{last.name}</div>
                    <div className="muted">{last.score} completed</div>
                  </div>
                </div>

                <div className="goblin-scorePill" title="Completed">
                  {last.score}
                </div>
              </div>
            ) : (
              <div className="muted">No data yet.</div>
            )}
          </div>

        </div>
      )}
    </div>
  )
}

function PodiumBlock({ place, user, height }) {
  if (!user) {
    return (
      <div className={`podium-block ${height}`}>
        <div className="podium-card">
          <div className={`podium-medal p${place}`}>{place}</div>
          <div className="muted">—</div>
        </div>
      </div>
    )
  }

  return (
    <div className={`podium-block ${height}`}>
      <div className="podium-card">
        <div className={`podium-medal p${place}`}>{place}</div>

        <div className="podium-user">
          <div className="podium-userText">
            <div className="podium-name">{user.name}</div>
            <div className="muted">{user.score} completed</div>
          </div>
        </div>

      </div>
    </div>
  )
}

function filterByRange(all, range) {
  if (range === 'all') return all
  const now = Date.now()
  const days = range === 'week' ? 7 : 30
  const min = now - days * 86400000
  return all.filter(t => (t.completedAt || 0) >= min)
}
