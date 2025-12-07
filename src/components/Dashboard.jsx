import React, { useEffect, useMemo, useRef, useState } from 'react'
import { assignedUserForBalancedWithExempt, periodKey } from '../utils/rotation.js'
import { saveState } from '../state/storage.js'
import { uid } from '../utils/uid.js'

export default function Dashboard({ tab, setTab, state, setState, tabs }) {
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

  // Helpers
  const users = state.users
  const isCompleted = (chore) => {
    const key = periodKey(state, chore.id, new Date())
    return state.completions[key]?.[chore.id] || null
  }

  // ----- Build visible list(s) -----
  const visibleChores = useMemo(() => {
    const now = new Date()
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

    const daily = listFor('daily')
    const weekly = listFor('weekly').filter(c => !isCompleted(c))
    const monthly = listFor('monthly').filter(c => !isCompleted(c))
    return [...daily, ...weekly, ...monthly]
  }, [state.chores, tab, state.completions])

  // Hidden completed (applied last)
  const choresToRender = useMemo(() => {
    if (!hideCompleted) return visibleChores
    return visibleChores.filter(c => !isCompleted(c))
  }, [visibleChores, hideCompleted, state.completions])

  // ----- Balanced offset per frequency -----
  const rankByIdDaily = useMemo(() => {
    const map = new Map()
    const daily = state.chores
      .filter(c => c.frequency === 'daily')
      .sort((a,b)=>{
        const ai = a.sortIndex ?? Infinity, bi = b.sortIndex ?? Infinity
        if (ai !== bi) return ai - bi
        return (a.name||'').localeCompare(b.name||'') || a.id.localeCompare(b.id)
      })
    daily.forEach((c, i) => map.set(c.id, i))
    return map
  }, [state.chores])

  const rankByIdWeekly = useMemo(() => {
    const map = new Map()
    const weekly = state.chores
      .filter(c => c.frequency === 'weekly')
      .sort((a,b)=>{
        const ai = a.sortIndex ?? Infinity, bi = b.sortIndex ?? Infinity
        if (ai !== bi) return ai - bi
        return (a.name||'').localeCompare(b.name||'') || a.id.localeCompare(b.id)
      })
    weekly.forEach((c, i) => map.set(c.id, i))
    return map
  }, [state.chores])

  const rankByIdMonthly = useMemo(() => {
    const map = new Map()
    const monthly = state.chores
      .filter(c => c.frequency === 'monthly')
      .sort((a,b)=>{
        const ai = a.sortIndex ?? Infinity, bi = b.sortIndex ?? Infinity
        if (ai !== bi) return ai - bi
        return (a.name||'').localeCompare(b.name||'') || a.id.localeCompare(b.id)
      })
    monthly.forEach((c, i) => map.set(c.id, i))
    return map
  }, [state.chores])

  const offsetFor = (choreId, freq) => {
    if (freq === 'daily')   return rankByIdDaily.get(choreId)   ?? 0
    if (freq === 'weekly')  return rankByIdWeekly.get(choreId)  ?? 0
    return rankByIdMonthly.get(choreId) ?? 0
  }

  // Actions
  const mark = (choreId, doneByUserId) => {
    const now = new Date()
    const key = periodKey(state, choreId, now)
    const completions = { ...state.completions }
    completions[key] = completions[key] || {}
    completions[key][choreId] = { doneByUserId, at: Date.now() }
    const next = { ...state, completions }
    setState(next)
    saveState(next)
  }

  const unmark = (choreId) => {
    const now = new Date()
    const key = periodKey(state, choreId, now)
    const completions = { ...state.completions }
    if (completions[key]?.[choreId]) {
      delete completions[key][choreId]
      if (Object.keys(completions[key]).length === 0) delete completions[key]
      const next = { ...state, completions }
      setState(next)
      saveState(next)
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

      {choresToRender.map(chore => {
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
              const isExempt = exemptIds.includes(u.id)
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
            const choreWithIndex = { ...newChore, sortIndex: nextSort, exemptUserIds: newChore.exemptUserIds || [] }

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

  const toggleExempt = (id) => {
    setExempt(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e)=>e.stopPropagation()}>
        <div className="modal-header">
          <h3>Add New Chore</h3>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <label>Chore Name</label>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g., Take out trash" />

          <label>Frequency</label>
          <select value={frequency} onChange={e=>setFrequency(e.target.value)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>

          <label>Icon</label>
          <div className="icon-grid">
            {['🧹','🧺','🧼','🧽','🗑️','🛒','🍽️','🚽','🪣','🧯','🧴','🧊'].map(ic=>(
              <button
                key={ic}
                className={icon===ic?'icon-select active':'icon-select'}
                onClick={()=>setIcon(ic)}
              >{ic}</button>
            ))}
          </div>

          <label>Exempt Users</label>
          <div className="exempt-grid">
            {users.map(u => (
              <label key={u.id} className="exempt-item">
                <input
                  type="checkbox"
                  checked={exempt.includes(u.id)}
                  onChange={()=>toggleExempt(u.id)}
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
            onClick={()=>{
              onAdd({
                id: uid(),
                name: name.trim(),
                frequency,
                icon,
                rotationStart: Date.now(),
                exemptUserIds: exempt
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

  const toggleExempt = (id) => {
    setExempt(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e)=>e.stopPropagation()}>
        <div className="modal-header">
          <h3>Edit Chore</h3>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <label>Chore Name</label>
          <input value={name} onChange={e=>setName(e.target.value)} />

          <label>Frequency</label>
          <select value={frequency} onChange={e=>setFrequency(e.target.value)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>

          <label>Icon</label>
          <div className="icon-grid">
            {['🧹','🧺','🧼','🧽','🗑️','🛒','🍽️','🚽','🪣','🧯','🧴','🧊'].map(ic=>(
              <button
                key={ic}
                className={icon===ic?'icon-select active':'icon-select'}
                onClick={()=>setIcon(ic)}
              >{ic}</button>
            ))}
          </div>

          <label>Exempt Users</label>
          <div className="exempt-grid">
            {users.map(u => (
              <label key={u.id} className="exempt-item">
                <input
                  type="checkbox"
                  checked={exempt.includes(u.id)}
                  onChange={()=>toggleExempt(u.id)}
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
              onClick={()=>{
                onSave({
                  name: name.trim(),
                  frequency,
                  icon,
                  exemptUserIds: exempt
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

function scheduleNextBoundaryTick(tab, cb, timerRef) {
  if (timerRef.current) clearTimeout(timerRef.current)
  const now = new Date()
  let next

  // Today behaves like Daily: flip at midnight
  if (tab === 'Daily' || tab === 'Today') {
    next = new Date(now)
    next.setHours(24, 0, 0, 0) // midnight tonight
  } else if (tab === 'Weekly') {
    // Next Monday 00:00 (treat Monday as week start)
    next = new Date(now)
    const day = next.getDay() === 0 ? 7 : next.getDay() // Sun->7
    const daysUntilMonday = (8 - day) % 7 || 7
    next.setDate(next.getDate() + daysUntilMonday)
    next.setHours(0, 0, 0, 0)
  } else {
    // Monthly: first of next month 00:00
    next = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0)
  }

  const ms = Math.max(1000, next.getTime() - now.getTime())
  timerRef.current = setTimeout(() => {
    cb()
    scheduleNextBoundaryTick(tab, cb, timerRef)
  }, ms)
}
