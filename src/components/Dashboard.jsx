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
  // Leaderboard / Podium / Hall of Fame tabs
  if (tab === 'Leaderboard') {
    return <LeaderboardTab tabs={tabs} tab={tab} setTab={setTab} state={state} />
  }
  if (tab === 'Podium') {
    return <PodiumTab tabs={tabs} tab={tab} setTab={setTab} state={state} />
  }
  if (tab === 'Hall of Fame') {
    return <HallOfFameTab tabs={tabs} tab={tab} setTab={setTab} state={state} />
  }

  const [showModal, setShowModal] = useState(false)
  const [editChore, setEditChore] = useState(null)
  const [hideCompleted, setHideCompleted] = useState(false)
  const [completeConfirm, setCompleteConfirm] = useState(null) // { chore, user } when asking "mark as complete for name?"
  const [filterByUser, setFilterByUser] = useState(null) // userId when viewing one person's chores

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

  // ---- One-time backfill of legacy completions into ledger for Hall of Fame ----
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (state.prefs?.ledgerBackfillDoneV1) return
      try {
        await backfillLedgerFromLegacyCompletions(state)
        if (cancelled) return
        const next = {
          ...state,
          prefs: { ...(state.prefs || {}), ledgerBackfillDoneV1: true }
        }
        setState(next)
        saveState(next)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('Ledger backfill failed:', e)
      }
    })()
    return () => { cancelled = true }
  }, [state])

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

  // When filtering by user: only chores where they're assigned or completed
  const choresForView = useMemo(() => {
    if (!filterByUser) return choresToRender
    return choresToRender.filter(chore => {
      const exemptIds = chore.exemptUserIds || []
      const eligibleUsers = users.filter(u => !exemptIds.includes(u.id))
      const offset = offsetFor(chore.id, chore.frequency)
      const idxEligible = assignedUserForBalancedWithExempt(
        chore, users, eligibleUsers, new Date(), offset
      )
      const assignedUser = idxEligible >= 0 ? eligibleUsers[idxEligible] : null
      const completion = isCompleted(chore)
      return assignedUser?.id === filterByUser || completion?.doneByUserId === filterByUser
    })
  }, [choresToRender, filterByUser, users, state.completions, state.chores])

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

      {filterByUser && (
        <div className="user-filter-bar">
          <h3 className="user-filter-title">
            {users.find(u => u.id === filterByUser)?.name || 'Unknown'}'s chores
          </h3>
          <button className="btn" onClick={() => setFilterByUser(null)}>
            Show all
          </button>
        </div>
      )}

      <div className={`grid header ${filterByUser ? 'grid-filtered' : ''}`}>
        <div>Chore</div>
        {(filterByUser ? users.filter(u => u.id === filterByUser) : users).map(u => (
          <div key={u.id} className="center">
            <button
              type="button"
              className={`avatar-btn ${filterByUser === u.id ? 'active' : ''}`}
              onClick={() => setFilterByUser(prev => (prev === u.id ? null : u.id))}
              title={filterByUser ? 'Click to show all' : `View ${u.name}'s chores`}
              aria-label={filterByUser ? 'Show all chores' : `View ${u.name}'s chores`}
            >
              <Avatar user={u} />
            </button>
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

      {!allDoneToday && choresForView.map(chore => {
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

            {(filterByUser ? users.filter(u => u.id === filterByUser) : users).map((u) => {
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
                    <button
                      type="button"
                      className="dot dot-clickable"
                      onClick={() => setCompleteConfirm({ chore, user: u })}
                      title={`Mark as complete for ${u.name}`}
                      aria-label={`Mark as complete for ${u.name}`}
                    />
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

      {completeConfirm && (
        <div className="modal-backdrop" onClick={() => setCompleteConfirm(null)}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-body">
              <p className="confirm-msg">
                Mark as complete for <strong>{completeConfirm.user.name}</strong>?
              </p>
              <div className="confirm-actions">
                <button className="btn" onClick={() => setCompleteConfirm(null)}>
                  No
                </button>
                <button
                  className="btn primary"
                  onClick={() => {
                    mark(completeConfirm.chore.id, completeConfirm.user.id)
                    setCompleteConfirm(null)
                  }}
                >
                  Yes
                </button>
              </div>
            </div>
          </div>
        </div>
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
  const [rows, setRows] = useState([])
  const [taskCounts, setTaskCounts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const all = await getAllTaskInstances()
      // Always use THIS MONTH only for the seasonal leaderboard
      const filtered = filterByRange(all, 'month')
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
  }, [state.users, state.chores])

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
          <div className="muted">Who’s completing the most chores this month</div>
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
      // Podium also uses this month's completions
      const inRange = filterByRange(all, 'month')
      const completed = inRange.filter(t => t.completed && t.completedByUserId)

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
  const now = new Date()

  if (range === 'week') {
    const min = Date.now() - 7 * 86400000
    return all.filter(t => (t.completedAt || 0) >= min)
  }

  if (range === 'month') {
    const year = now.getFullYear()
    const month = now.getMonth()
    const start = new Date(year, month, 1).getTime()
    const end = new Date(year, month + 1, 1).getTime()
    return all.filter(t => {
      const ts = t.completedAt || 0
      return ts >= start && ts < end
    })
  }

  return all
}

function formatMonthYear(year, monthIndex) {
  const d = new Date(year, monthIndex, 1)
  return d.toLocaleString(undefined, { month: 'long', year: 'numeric' })
}

function HallOfFameTab({ tabs, tab, setTab, state }) {
  const [loading, setLoading] = useState(true)
  const [seasons, setSeasons] = useState([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const all = await getAllTaskInstances()
      const completed = all.filter(t => t.completed && t.completedByUserId && t.completedAt)

      const bySeasonKey = new Map()

      for (const t of completed) {
        const d = new Date(t.completedAt)
        const year = d.getFullYear()
        const month = d.getMonth()
        const key = `${year}-${month}`

        if (!bySeasonKey.has(key)) {
          bySeasonKey.set(key, {
            year,
            month,
            counts: new Map()
          })
        }

        const season = bySeasonKey.get(key)
        const uid = t.completedByUserId
        season.counts.set(uid, (season.counts.get(uid) || 0) + 1)
      }

      const rows = Array.from(bySeasonKey.values())
        .map(season => {
          let winnerUserId = null
          let max = 0
          for (const [uid, count] of season.counts.entries()) {
            if (count > max) {
              max = count
              winnerUserId = uid
            }
          }
          const winner = state.users.find(u => u.id === winnerUserId) || null
          return {
            key: `${season.year}-${season.month}`,
            year: season.year,
            month: season.month,
            label: formatMonthYear(season.year, season.month),
            winnerUserId,
            winnerName: winner?.name || 'Unknown',
            winnerColor: winner?.color || '#6b7280',
            totalCompleted: max
          }
        })
        // newest month first
        .sort((a, b) => {
          if (a.year !== b.year) return b.year - a.year
          return b.month - a.month
        })

      if (cancelled) return
      setSeasons(rows)
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [state.users])

  return (
    <div className="dashboard hof-wrap">
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

      <section className="hof-hero">
        <div className="hof-heroGlow" aria-hidden="true" />
        <div className="hof-heroInner">
          <div className="hof-crest">
            <div className="hof-crestCircle">
              <span className="hof-crestIcon">🏅</span>
            </div>
            <div className="hof-crestBase" />
          </div>

          <div className="hof-heroText">
            <h2 className="hof-title">Hall of Fame</h2>
            <p className="hof-sub">
              Champions of each month, honoured for keeping the house running.
            </p>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="row">Loading…</div>
      ) : seasons.length === 0 ? (
        <div className="row muted">No completed seasons yet.</div>
      ) : (
        <HallOfFameList seasons={seasons} />
      )}
    </div>
  )
}

function HallOfFameList({ seasons }) {
  const maxCompleted = seasons.reduce(
    (max, s) => (s.totalCompleted > max ? s.totalCompleted : max),
    0
  )

  return (
    <section className="hof-list">
      {seasons.map((s, index) => {
        const isTop = index === 0
        const isCleanest = s.totalCompleted === maxCompleted && maxCompleted > 0
        return (
          <article
            key={s.key}
            className={isTop ? 'hof-plaque hof-plaque-current' : 'hof-plaque'}
          >
            <header className="hof-plaqueHeader">
              <div className="hof-plaqueMonth">{s.winnerName}</div>
              <div className="hof-plaqueRibbon">
                {isTop ? 'Reigning champion' : 'Season champion'}
              </div>
            </header>

            <div className="hof-plaqueBody">
              <div className="hof-winnerMeta">
                <span className="hof-count">
                  {s.label} · {s.totalCompleted} chore
                  {s.totalCompleted === 1 ? '' : 's'} completed
                </span>
                {isCleanest && (
                  <span className="hof-tag hof-tag-cleanest">
                    Cleanest month
                  </span>
                )}
              </div>
            </div>
          </article>
        )
      })}
    </section>
  )
}

async function backfillLedgerFromLegacyCompletions(state) {
  const completions = state.completions || {}
  const choresById = new Map(state.chores.map(c => [c.id, c]))
  const usersById = new Map(state.users.map(u => [u.id, u]))

  const entries = Object.entries(completions)
  for (const [pk, perChore] of entries) {
    if (!perChore) continue
    for (const [choreId, comp] of Object.entries(perChore)) {
      if (!comp) continue
      const chore = choresById.get(choreId)
      if (!chore) continue

      const doneByUserId = comp.doneByUserId
      if (!doneByUserId) continue

      const user = usersById.get(doneByUserId)
      const inferredAt =
        typeof comp.at === 'number' && comp.at > 0
          ? comp.at
          : inferTimestampFromPeriodKey(pk)
      if (!inferredAt) continue

      const id = `${pk}|${choreId}`
      await upsertTaskInstance({
        id,
        periodKey: pk,
        choreId,
        choreNameSnapshot: chore.name || null,
        frequencySnapshot: chore.frequency,
        assignedUserId: null,
        createdAt: inferredAt,
        completed: true,
        completedAt: inferredAt,
        completedByUserId: doneByUserId,
        completedByNameSnapshot: user?.name || null
      })
    }
  }
}

function inferTimestampFromPeriodKey(pk) {
  try {
    if (pk.startsWith('D:')) {
      const [, rest] = pk.split(':') // y-m-d
      const [y, m, d] = rest.split('-').map(Number)
      return new Date(y, (m || 1) - 1, d || 1).getTime()
    }
    if (pk.startsWith('M:')) {
      const [, rest] = pk.split(':') // y-m
      const [y, m] = rest.split('-').map(Number)
      return new Date(y, (m || 1) - 1, 1).getTime()
    }
    if (pk.startsWith('W:')) {
      const [, rest] = pk.split(':') // y-Wn
      const [yearPart, weekPart] = rest.split('-W')
      const y = Number(yearPart)
      const w = Number(weekPart)
      if (!y || !w) return null
      // Approximate Monday of that ISO-like week
      const d = new Date(y, 0, 1)
      const day = d.getDay() || 7
      const diff = (w - 1) * 7 - (day - 1)
      d.setDate(d.getDate() + diff)
      return d.getTime()
    }
  } catch {
    return null
  }
  return null
}
