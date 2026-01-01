// src/state/ledgerDb.js
// IndexedDB "ledger" for chore task-instances (per period).
// Stores: what tasks existed in each period, who they were assigned to, and who completed them.

const DB_NAME = 'chore-chart-ledger-v1'
const DB_VERSION = 1

const STORE_TASKS = 'tasks' // keyPath: id = `${periodKey}|${choreId}`

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_TASKS)) {
        const store = db.createObjectStore(STORE_TASKS, { keyPath: 'id' })
        store.createIndex('periodKey', 'periodKey', { unique: false })
        store.createIndex('choreId', 'choreId', { unique: false })
        store.createIndex('completedByUserId', 'completedByUserId', { unique: false })
        store.createIndex('completedAt', 'completedAt', { unique: false })
      }
    }

    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function upsertTaskInstance(task) {
  const db = await openDb()
  const tx = db.transaction(STORE_TASKS, 'readwrite')
  tx.objectStore(STORE_TASKS).put(task)
  await txDone(tx)
  db.close()
}

export async function getTaskInstance(id) {
  const db = await openDb()
  const tx = db.transaction(STORE_TASKS, 'readonly')
  const req = tx.objectStore(STORE_TASKS).get(id)
  const out = await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
  await txDone(tx)
  db.close()
  return out
}

export async function getAllTaskInstances() {
  const db = await openDb()
  const tx = db.transaction(STORE_TASKS, 'readonly')
  const req = tx.objectStore(STORE_TASKS).getAll()
  const out = await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
  await txDone(tx)
  db.close()
  return out
}

export async function getTaskInstancesByPeriod(periodKey) {
  const db = await openDb()
  const tx = db.transaction(STORE_TASKS, 'readonly')
  const idx = tx.objectStore(STORE_TASKS).index('periodKey')
  const req = idx.getAll(periodKey)
  const out = await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
  await txDone(tx)
  db.close()
  return out
}

export async function markTaskCompleted({ periodKey, choreId, doneByUserId, doneByNameSnapshot }) {
  const id = `${periodKey}|${choreId}`
  const existing = await getTaskInstance(id)

  const now = Date.now()
  const next = {
    ...(existing || {
      id,
      periodKey,
      choreId,
      createdAt: now
    }),
    completed: true,
    completedAt: now,
    completedByUserId: doneByUserId,
    completedByNameSnapshot: doneByNameSnapshot || null
  }

  await upsertTaskInstance(next)
  return next
}

export async function unmarkTaskCompleted({ periodKey, choreId }) {
  const id = `${periodKey}|${choreId}`
  const existing = await getTaskInstance(id)
  if (!existing) return null

  const next = {
    ...existing,
    completed: false,
    completedAt: null,
    completedByUserId: null,
    completedByNameSnapshot: null
  }

  await upsertTaskInstance(next)
  return next
}
