const BASE = '/api'

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || res.statusText)
  }
  if (res.status === 204) return null
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

export function apiGet(path) {
  return req('GET', path)
}

export function apiPost(path, body) {
  return req('POST', path, body)
}

export function apiPatch(path, body) {
  return req('PATCH', path, body)
}

export function apiDel(path) {
  return req('DELETE', path)
}

export const api = {
  funds: {
    create: (data) => apiPost('/funds/', data),
    update: (id, data) => apiPatch(`/funds/${id}`, data),
    delete: (id) => apiDel(`/funds/${id}`),
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
