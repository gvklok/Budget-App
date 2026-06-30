const BASE = '/api'

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Request failed' }))
    throw new Error(err.detail || 'Request failed')
  }
  return res.status === 204 ? null : res.json()
}

export const api = {
  funds: {
    create: (data) => req('POST', '/funds/', data),
    update: (id, data) => req('PATCH', `/funds/${id}`, data),
    delete: (id) => req('DELETE', `/funds/${id}`),
  },
}

export function fmt(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount ?? 0)
}

export function toCents(value) {
  if (value === '' || value == null) return 0
  return Math.round(Number(value) * 100)
}

export function fromCents(value) {
  return (Number(value) ?? 0) / 100
}

export function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(ym) {
  if (!ym) return ''
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}
