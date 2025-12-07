export function ensureNotificationPermission() {
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(()=>{})
  }
}

export function scheduleTick(fn, intervalMs = 60_000) {
  const id = setInterval(fn, intervalMs)
  setTimeout(fn, 400)
  return () => clearInterval(id)
}

export async function sendTelegram(config, chores) {
  if (!config?.botToken || !config?.chatId) return
  try {
    const text = `Chores due:\n` + chores.map(c => `• ${c.name} — ${c.user?.name}`).join('\n')
    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.chatId, text })
    })
  } catch (e) {
    console.error('Telegram failed', e)
  }
}

export async function sendEmail(webhookUrl, chores) {
  if (!webhookUrl) return
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: 'Chores due',
        body: chores.map(c => `• ${c.name} — ${c.user?.name}`).join('\n')
      })
    })
  } catch (e) {
    console.error('Email webhook failed', e)
  }
}
