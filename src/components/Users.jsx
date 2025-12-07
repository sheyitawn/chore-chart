import React from 'react'
import { uid } from '../utils/uid.js'

export default function Users({ state, setState }) {
  const users = state.users

  const move = (idx, dir) => {
    const arr = [...users]
    const n = idx + dir
    if (n < 0 || n >= arr.length) return
    const [item] = arr.splice(idx, 1)
    arr.splice(n, 0, item)
    setState({ ...state, users: arr })
  }

  const updateUser = (id, patch) => {
    const arr = state.users.map(u => u.id === id ? { ...u, ...patch } : u)
    setState({ ...state, users: arr })
  }

  const addUser = () => {
    setState({ ...state, users: [...state.users, { id: uid(), name: 'New', color: '#6b8afd' }] })
  }

  const removeUser = (id) => {
    if (state.users.length <= 1) return
    setState({
      ...state,
      users: state.users.filter(u => u.id !== id)
    })
  }

  return (
    <div className="users">
      <h2>User Management</h2>
      <div className="user-grid">
        {users.map((u, i) => (
          <div key={u.id} className="user-card">
            <div className="user-header">
              <div className="avatar" style={{ borderColor: u.color }}>
                {u.name?.[0]?.toUpperCase() || '?'}
              </div>
              <div className="muted">Position #{i+1} in rotation</div>
              <div className="spacer" />
              <div className="stack">
                <button className="icon-btn" onClick={()=>move(i,-1)}>↑</button>
                <button className="icon-btn" onClick={()=>move(i, 1)}>↓</button>
              </div>
            </div>
            <label>Name</label>
            <input value={u.name} onChange={e=>updateUser(u.id, { name: e.target.value })} />
            <label>Color</label>
            <input type="color" value={u.color} onChange={e=>updateUser(u.id, { color: e.target.value })} />
            <div className="row-end">
              <button className="btn danger" onClick={()=>removeUser(u.id)}>Remove</button>
            </div>
          </div>
        ))}
        <button className="user-card add" onClick={addUser}>+ Add User</button>
      </div>

      {/* <h3>Notifications (Optional)</h3>
      <p className="muted">
        [Unverified] Client-side tokens are visible. Use a server proxy for production.
      </p>
      <div className="notif-grid">
        <div>
          <label>Telegram Bot Token</label>
          <input
            placeholder="123456:ABC..."
            value={state.prefs?.telegram?.botToken || ''}
            onChange={e => setState({
              ...state,
              prefs: { ...(state.prefs||{}), telegram: { ...(state.prefs?.telegram||{}), botToken: e.target.value } }
            })}
          />
        </div>
        <div>
          <label>Telegram Chat ID</label>
          <input
            placeholder="@your_channel or 12345678"
            value={state.prefs?.telegram?.chatId || ''}
            onChange={e => setState({
              ...state,
              prefs: { ...(state.prefs||{}), telegram: { ...(state.prefs?.telegram||{}), chatId: e.target.value } }
            })}
          />
        </div>
        <div>
          <label>Email Webhook URL</label>
          <input
            placeholder="https://email-webhook.example/send"
            value={state.prefs?.emailWebhook || ''}
            onChange={e => setState({
              ...state,
              prefs: { ...(state.prefs||{}), emailWebhook: e.target.value }
            })}
          />
        </div>
      </div> */}
    </div>
  )
}
