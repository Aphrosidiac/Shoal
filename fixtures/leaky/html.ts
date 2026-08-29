const NAV = [
  ['/app', 'Dashboard'],
  ['/app/customers', 'Customers'],
  ['/app/orders', 'Orders'],
  ['/app/invoices', 'Invoices'],
  ['/app/deliveries', 'Deliveries'],
  ['/app/reports', 'Reports'],
  ['/app/admin', 'Admin'],
  ['/app/settings', 'Settings'],
]

export function page(opts: { title: string; body: string; nav?: boolean; heading?: string }): string {
  const nav = opts.nav === false ? '' : `<nav aria-label="Main"><ul>${NAV.map(([h, t]) => `<li><a href="${h}">${t}</a></li>`).join('')}<li><a href="/app/profile">Profile</a></li><li><button type="button" id="logout">Log out</button></li></ul></nav>`
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${opts.title} — Leaky</title>
<link rel="stylesheet" href="/static/app.css"></head>
<body>
<header><a href="/" id="brand">Leaky</a>${nav}</header>
<main>
<h1>${opts.heading ?? opts.title}</h1>
${opts.body}
<p id="msg" role="status"></p>
</main>
<script src="/static/app.js"></script>
</body></html>`
}

export const CSS = `
:root{--fg:#16181d;--bg:#fff;--line:#d8dbe2;--accent:#2f5bea}
*{box-sizing:border-box}
body{margin:0;font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:var(--fg);background:var(--bg)}
header{display:flex;gap:24px;align-items:center;padding:12px 20px;border-bottom:1px solid var(--line);flex-wrap:wrap}
#brand{font-weight:700;text-decoration:none;color:var(--fg)}
nav ul{display:flex;gap:16px;list-style:none;margin:0;padding:0;flex-wrap:wrap}
nav a{color:var(--accent);text-decoration:none}
main{max-width:900px;margin:0 auto;padding:24px 20px 80px}
h1{font-size:24px;margin:0 0 16px}
h2{font-size:17px;margin:28px 0 10px}
form{display:grid;gap:10px;max-width:420px;margin:0 0 20px}
label{display:grid;gap:4px;font-size:13px}
input,select,textarea{padding:8px 10px;border:1px solid var(--line);border-radius:5px;font:inherit}
button{padding:8px 14px;border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:5px;font:inherit;cursor:pointer}
button.secondary{background:#fff;color:var(--accent)}
table{border-collapse:collapse;width:100%;margin:8px 0 16px}
th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--line);font-size:14px}
#msg{min-height:20px;color:#a3352b;font-size:14px}
.pager{display:flex;gap:10px;align-items:center}
`

export const JS = String.raw`
const $ = (s, r) => (r || document).querySelector(s)
const msg = (t, bad) => { const m = $('#msg'); if (m) { m.textContent = t || ''; m.style.color = bad ? '#a3352b' : '#1d6f3f' } }
const qs = new URLSearchParams(location.search)

async function api(method, path, body, headers) {
  const res = await fetch(path, {
    method,
    headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  })
  let data = null
  try { data = await res.json() } catch (e) { data = null }
  return { status: res.status, ok: res.ok, data }
}

function cell(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function renderTable(host, rows, cols, linkBase) {
  if (!rows || rows.length === 0) { host.innerHTML = '<p>Nothing here yet.</p>'; return }
  const use = cols && cols.length ? cols : Object.keys(rows[0])
  const head = '<tr>' + use.map(c => '<th>' + c + '</th>').join('') + '</tr>'
  const body = rows.map(r => '<tr>' + use.map(c =>
    '<td>' + (c === 'id' && linkBase ? '<a href="' + linkBase + r.id + '">' + cell(r[c]) + '</a>' : cell(r[c])) + '</td>'
  ).join('') + '</tr>').join('')
  host.innerHTML = '<table>' + head + body + '</table>'
}

async function loadList(host) {
  const path = host.dataset.list
  const page = Number(qs.get('page') || 1)
  const url = path + (path.indexOf('?') >= 0 ? '&' : '?') + 'page=' + page
  const r = await api('GET', url)
  if (!r.ok) { msg((r.data && r.data.error) || ('failed with ' + r.status), true); return }
  const rows = Array.isArray(r.data) ? r.data : (r.data.rows || [])
  renderTable(host, rows, (host.dataset.cols || '').split(',').filter(Boolean), host.dataset.link)
  const pager = $('#pager')
  if (pager && r.data && r.data.total !== undefined) {
    const limit = r.data.limit || 20
    const pages = Math.max(1, Math.ceil(r.data.total / limit))
    pager.innerHTML =
      (page > 1 ? '<a href="?page=' + (page - 1) + '">Previous page</a>' : '') +
      '<span>page ' + page + ' of ' + pages + ' — ' + r.data.total + ' rows</span>' +
      (page < pages ? '<a href="?page=' + (page + 1) + '">Next page</a>' : '')
  }
}

async function loadOne(host) {
  const r = await api('GET', host.dataset.one)
  if (!r.ok) { msg((r.data && r.data.error) || ('failed with ' + r.status), true); return }
  const d = r.data
  host.innerHTML = '<table>' + Object.keys(d).map(k =>
    '<tr><th>' + k + '</th><td id="f-' + k + '">' + cell(d[k]) + '</td></tr>').join('') + '</table>'
  document.querySelectorAll('[data-fill]').forEach(el => {
    const v = d[el.dataset.fill]
    if (v !== undefined && v !== null && el.value === '') el.value = v
  })
}

function wireForm(f) {
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault()
    msg('')
    const body = {}
    new FormData(f).forEach((v, k) => {
      if (v === '') return
      body[k] = f.elements[k] && f.elements[k].type === 'number' ? Number(v) : v
    })
    const headers = {}
    if (f.dataset.idem) headers['Idempotency-Key'] = f.dataset.idemKey || (f.dataset.idemKey = 'idem-' + Math.random().toString(36).slice(2, 10))
    const method = f.dataset.method || 'POST'
    let action = f.dataset.action
    let payload = body
    if (method === 'GET' || method === 'HEAD') {
      const q = new URLSearchParams()
      Object.keys(body).forEach(k => q.set(k, body[k]))
      const qs = q.toString()
      if (qs) action = action + (action.indexOf('?') >= 0 ? '&' : '?') + qs
      payload = undefined
    }
    const r = await api(method, action, payload, headers)
    if (!r.ok) { msg((r.data && r.data.error) || ('failed with ' + r.status), true); return }
    msg('Saved.')
    if (f.dataset.redirect) { location.href = f.dataset.redirect.replace(':id', (r.data && r.data.id) || ''); return }
    // refetch after every write: this is what the page shows you afterwards
    document.querySelectorAll('[data-list]').forEach(loadList)
    document.querySelectorAll('[data-one]').forEach(loadOne)
    if (f.dataset.reset !== 'no') f.reset()
  })
}

document.querySelectorAll('form[data-action]').forEach(wireForm)
document.querySelectorAll('[data-list]').forEach(loadList)
document.querySelectorAll('[data-one]').forEach(loadOne)
const lo = $('#logout')
if (lo) lo.addEventListener('click', async () => { await api('POST', '/api/auth/logout'); location.href = '/login' })
`
