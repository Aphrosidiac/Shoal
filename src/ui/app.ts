/**
 * The dashboard's JavaScript, served as it is written. Hash-routed views over
 * one state object that arrives by SSE every 1.5s. The filmstrip is the one
 * view that is never redrawn under the reader.
 */
export const JS = String.raw`
const $ = (s) => document.querySelector(s)
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const hhmm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const dur = (ms) => { if (ms < 0) ms = 0; const m = Math.round(ms / 60000); if (m < 1) return Math.round(ms / 1000) + 's'; return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm' }
const pct = (p) => Math.round(p * 100)
const usd = (n, d) => '$' + Number(n || 0).toFixed(d == null ? 2 : d)

// ---------- icons (Feather-style, 1.6 stroke) ----------
const I = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  live: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 5v14M16 5v14M3 10h5M3 14h5M16 10h5M16 14h5"/></svg>',
  bug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 9V6a3 3 0 0 1 6 0v3"/><rect x="6" y="9" width="12" height="11" rx="5"/><path d="M3 13h3M18 13h3M4 19l3-2M20 19l-3-2M4 8l3 2M20 8l-3 2"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="3"/></svg>',
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2Z"/><path d="M9 4v14M15 6v14"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-5-6.3"/></svg>',
  log: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16M4 10h16M4 15h10M4 20h7"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l5 5v13H6Z"/><path d="M14 3v5h5M9 13h7M9 17h7"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l12-7Z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M9 6l6 6-6 6"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>',
  judge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M5 7h14M5 7l-3 7a3 3 0 0 0 6 0l-3-7M19 7l-3 7a3 3 0 0 0 6 0l-3-7"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2.5 20h19Z"/><path d="M12 9v5M12 17h.01"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13l3-8h12l3 8v6H3Z"/><path d="M3 13h5l2 3h4l2-3h5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="16" height="16"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
}
const ibox = (ic, tone) => '<span class="ibox' + (tone ? ' ' + tone : '') + '">' + I[ic] + '</span>'

// ---------- state + routing ----------
let S = null
let route = { view: 'overview', id: null }
let filters = { findings: 'all', sus: 'all', live: 'all', map: 'screens' }
let pendingSteps = []

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '')
  const [view, id] = h.split('/')
  route = { view: view || 'overview', id: id ? Number(id) : null }
}
window.addEventListener('hashchange', () => { parseHash(); closeDrawer(); $('#modal').classList.remove('on'); draw() })
parseHash()
const go = (view, id) => { location.hash = '#' + view + (id != null ? '/' + id : '') }

const NAV = [
  ['Run', [['overview', 'Overview', 'home'], ['live', 'Live', 'live']]],
  ['Results', [['findings', 'Findings', 'bug'], ['suspicions', 'Suspicions', 'eye']]],
  ['Coverage', [['map', 'Map', 'map'], ['accounts', 'Accounts', 'users']]],
  ['System', [['log', 'Log', 'log'], ['report', 'Report', 'doc']]],
]
const TITLES = {
  overview: ['Overview', (s) => s.run.exists ? esc(s.run.url) + ' · ' + (s.run.running ? 'running for ' + dur(s.app.uptimeMs) : 'finished') : 'Point Shoal at your app on localhost'],
  live: ['Live', () => 'every screen an agent lands on, judged as it happens'],
  findings: ['Findings', () => 'only what reproduced — walked again in a fresh account, or replayed over HTTP'],
  suspicions: ['Suspicions', () => 'what looked wrong, and what happened when it was checked'],
  map: ['Map', () => 'what Shoal knows about the app — untouched first'],
  accounts: ['Accounts', () => 'every one of these signed itself up'],
  log: ['Log', () => 'everything that made the run less than it appears'],
}

function counts(s) {
  return {
    live: s.judge.steps, findings: s.counters.findings,
    suspicions: s.judge.suspicions.open, map: s.map.pages.length, accounts: s.counters.accounts, log: s.events.length,
  }
}

function drawRail(s) {
  const c = counts(s)
  $('#rail').innerHTML =
    '<div class="brand"><span class="mark"><svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M2 13c2.2-1.6 4-1.6 6 0 2-1.6 3.8-1.6 6 0 1.4-1.1 2.7-1.5 4-1.2" stroke="#7dd56f" stroke-width="1.6" stroke-linecap="round"/><path d="M2 17c2.2-1.6 4-1.6 6 0 2-1.6 3.8-1.6 6 0" stroke="#fff" stroke-opacity=".55" stroke-width="1.6" stroke-linecap="round"/><path d="M11.5 3 17 6.2l-5.5 3.2V3Z" fill="#7dd56f"/></svg></span><b>Shoal</b></div>' +
    NAV.map(([g, items]) => '<div class="group"><div class="lbl">' + g + '</div><div class="nav">' +
      items.map(([k, label, ic]) => {
        const href = k === 'report' ? '/report' : '#' + k
        const n = c[k]
        const tone = k === 'findings' && n ? ' red' : k === 'suspicions' && n ? ' amber' : ''
        return '<a href="' + href + '"' + (k === 'report' ? ' target="_blank"' : '') + (route.view === k ? ' aria-current="page"' : '') + '>' + I[ic] + esc(label) +
          (n ? '<span class="cnt' + tone + '">' + n + '</span>' : '') + '</a>'
      }).join('') + '</div></div>').join('') +
    '<div class="railfoot">' +
      '<div class="kv"><span>Judge</span><span><b>' + esc(s.app.driver.replace('typesafe / ', '')) + '</b></span></div>' +
      '<div class="kv"><span>Jev spend</span><span><b>' + usd(s.judge.usd, 3) + '</b>' + (s.run.maxUsd != null ? ' of ' + usd(s.run.maxUsd) : '') + '</span></div>' +
      '<div class="kv"><span>Directory</span><span title="' + esc(s.run.dir) + '">' + esc(s.run.dir.split('/').slice(-2).join('/')) + '</span></div>' +
    '</div>'
}

function drawHead(s) {
  const t = TITLES[route.view] || TITLES.overview
  $('#title').textContent = t[0]
  $('#subtitle').innerHTML = t[1](s)
  const r = s.run
  let acts = ''
  if (r.running) {
    const left = r.endsAt ? dur(r.endsAt - Date.now()) + ' left' : 'no time limit'
    acts = '<span class="chip green">' + I.spark.replace('<svg', '<svg width="12" height="12"') + ' running · ' + left + '</span>' +
      '<button class="btn secondary" id="stop">' + I.stop + 'Stop</button>'
  } else if (r.exists) {
    acts = '<a class="btn secondary" href="/report" target="_blank">' + I.doc + 'Report</a><button class="btn accent" id="start">' + I.play + 'Run again</button>'
  } else if (route.view !== 'overview') {
    // The one green button on a page. On the front door it is the form's.
    acts = '<button class="btn accent" id="start">' + I.play + 'Start a run</button>'
  }
  $('#acts').innerHTML = acts
  const st = $('#start'); if (st) st.onclick = () => openStart(s)
  const sp = $('#stop'); if (sp) sp.onclick = async () => { sp.disabled = true; sp.textContent = 'stopping…'; await fetch('/api/stop', { method: 'POST' }).catch(() => null) }
}

function draw() {
  if (!S) return
  drawRail(S)
  drawHead(S)
  const c = $('#content')
  switch (route.view) {
    case 'live': if ($('#film')) refreshFilm(S); else c.innerHTML = live(S); break
    case 'findings': c.innerHTML = findings(S); break
    case 'suspicions': c.innerHTML = suspicions(S); break
    case 'map': c.innerHTML = mapView(S); break
    case 'accounts': c.innerHTML = accounts(S); break
    case 'log': c.innerHTML = log(S); break
    default: c.innerHTML = overview(S)
  }
  wire()
}

// ---------- pieces ----------
const card = (o) => '<section class="card' + (o.tone ? ' ' + o.tone : '') + '">' +
  (o.title ? '<div class="hd' + (o.flush ? ' flush' : '') + '"><div class="t">' + (o.icon ? ibox(o.icon, o.tone === 'dark' ? 'blue' : '') : '') +
    '<div class="tt"><h3>' + esc(o.title) + '</h3>' + (o.count != null ? '<span class="cnt">' + o.count + '</span>' : '') + (o.sub ? '<span class="s">' + esc(o.sub) + '</span>' : '') + '</div></div>' +
    (o.actions ? '<div class="a">' + o.actions + '</div>' : '') + '</div>' : '') +
  '<div class="bd' + (o.flush ? ' flush' : '') + '">' + o.body + '</div>' + (o.footer ? '<div class="ft">' + o.footer + '</div>' : '') + '</section>'
const kpi = (label, value, small, sub, ic, chip) => '<div class="kpi">' + (ic ? ibox(ic) : '') + '<div style="min-width:0;flex:1"><div class="l">' + label + '</div><div class="v"><b class="num">' + value + '</b>' + (small ? '<small>' + small + '</small>' : '') + (chip || '') + '</div>' + (sub ? '<div class="s">' + sub + '</div>' : '') + '</div></div>'
const chip = (text, tone, sm) => '<span class="chip' + (tone ? ' ' + tone : '') + (sm ? ' sm' : '') + '">' + text + '</span>'
const meter = (label, value, p, tone) => '<div class="meter"><div class="l"><span>' + esc(label) + '</span><b class="num">' + esc(value) + '</b></div><div class="track' + (tone ? ' ' + tone : '') + '"><i style="width:' + Math.max(0, Math.min(100, p)) + '%"></i></div></div>'
const bare = (p, tone) => '<span class="track bare' + (tone ? ' ' + tone : '') + '"><i style="width:' + Math.max(0, Math.min(100, p)) + '%"></i></span>'
const empty = (ic, title, text) => '<div class="empty">' + ibox(ic) + '<b>' + title + '</b><span>' + text + '</span></div>'
const callout = (tone, ic, html) => '<div class="callout ' + tone + '">' + ibox(ic, 'sm ' + (tone === 'red' ? 'red' : tone === 'amber' ? 'amber' : tone === 'green' ? 'green' : 'blue')) + '<div>' + html + '</div></div>'
const HUES = [212, 260, 340, 20, 150, 45, 190, 300]
const avatar = (name) => { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return '<span class="avatar" style="background:hsl(' + HUES[h % HUES.length] + ' 55% 52%)">' + esc(String(name).replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?') + '</span>' }

const KIND = { leak: ['Leak', 'red'], 'data-loss': ['Data loss', 'red'], money: ['Money', 'amber'], race: ['Race', 'blue'], auth: ['Access', 'violet'], fault: ['Fault', 'red'], wrong: ['Wrong', 'amber'], slow: ['Slow', 'neutral'], noise: ['Noise', 'neutral'] }
const kindChip = (k) => { const [l, t] = KIND[k] || [k, 'neutral']; return chip(l, t) }
const checkName = (c) => String(c || '').replace(/^screen\./, '').replace(/[._]/g, ' ')
const SUS_STATE = { open: ['Being checked', 'amber'], confirmed: ['Confirmed', 'green'], unreproduced: ['Did not hold', 'neutral'], dismissed: ['Dismissed', 'neutral'] }
const stateChip = (st) => { const [l, t] = SUS_STATE[st] || [st, 'neutral']; return chip(l, t) }
const PHASE = { explore: ['Exploring', 'neutral'], mission: ['Mission', 'green'], form: ['Form', 'amber'], rewalk: ['Walking again', 'blue'] }
const phaseChip = (p) => { const [l, t] = PHASE[p] || [p, 'neutral']; return chip(l, t, true) }

// ---------- overview ----------
function overview(s) {
  if (!s.run.exists) return startHero(s)
  const c = s.counters, j = s.judge
  const done = !s.run.running
  const top = s.findings.filter((f) => f.state === 'open').slice(0, 6)
  const untouched = s.map.pages.filter((p) => !p.explored).slice(0, 5)
  const unhammered = s.map.endpoints.filter((e) => e.writes && !e.hammered).slice(0, 5)
  return '<div class="stack">' +
    (done ? callout('grey', 'doc', '<b>This run has finished.</b> Everything stays on disk; <a href="/report" target="_blank">open the report</a> or run again and it picks up where it left off.') : '') +
    '<div class="card kpis">' +
      kpi('Findings', c.findings, '', c.unconfirmed ? c.unconfirmed + ' more did not hold' : 'each one reproduced', 'bug', c.findings ? chip(c.findings + ' to fix', 'red', true) : chip('clean so far', 'green', true)) +
      kpi('Screens judged', j.steps, '', (s.app.uptimeMs > 60000 ? (j.steps / (s.app.uptimeMs / 60000)).toFixed(0) + ' a minute · ' : '') + j.withVerdict + ' fired', 'judge') +
      kpi('Coverage', c.pagesExplored, '<small>of ' + c.pages + ' screens</small>', c.endpointsHammered + ' of ' + c.writeEndpoints + ' writes hammered · ' + c.fieldsPoked + ' of ' + c.fields + ' fields', 'map') +
      kpi('Spend', usd(Math.max(c.spend, j.usd), 3), s.run.maxUsd != null ? '<small>of ' + usd(s.run.maxUsd) + '</small>' : '', j.medianMs ? 'Jev answers in ' + j.medianMs + ' ms' : '', 'spark') +
    '</div>' +
    (s.starved.length ? callout('amber', 'warn', '<b>Starved.</b> ' + s.starved.length + ' action' + (s.starved.length === 1 ? '' : 's') + ' the swarm tried and was always refused — a clean report means less than it looks. ' + s.starved.slice(0, 3).map((x) => esc(x.action) + ' (always ' + esc(x.statuses) + ')').join(' · ')) : '') +
    '<div class="grid two"><div class="col">' +
      card({ title: 'Do these first', count: s.findings.length, sub: top.length ? 'ranked by category, then how often it reproduced' : 'nothing has reproduced yet', icon: 'bug', flush: true,
        body: top.length ? '<div class="rows">' + top.map((f) => '<div class="row link" data-go="findings/' + f.id + '">' + kindChip(f.kind) + '<div class="tx"><b>' + esc(f.title) + '</b><span>' + esc(f.where || '') + ' · ' + f.reproduced + '/' + f.attempts + ' reproduced</span></div><span class="chev">' + I.chev + '</span></div>').join('') + '</div>'
          : empty('bug', s.run.running ? 'Nothing confirmed yet' : 'Nothing reproduced', 'Agents file suspicions; only what holds on a second walk in a fresh account, or on an HTTP replay, lands here.') }) +
      card({ title: 'Not looked at yet', sub: 'what you missed is more useful than what you covered', icon: 'map', flush: true,
        body: (untouched.length || unhammered.length) ? '<div class="rows">' +
          untouched.map((p) => '<div class="row">' + chip('screen', 'neutral', true) + '<div class="tx"><b class="mono">' + esc(p.pattern) + '</b><span>' + esc(p.title || 'never opened') + '</span></div></div>').join('') +
          unhammered.map((e) => '<div class="row">' + chip('write', 'amber', true) + '<div class="tx"><b class="mono">' + esc(e.method + ' ' + e.path) + '</b><span>never hammered</span></div></div>').join('') + '</div>'
          : empty('map', 'Everything mapped has been opened', 'Every screen opened, every write endpoint hammered at least once.') }) +
    '</div><div class="col">' +
      card({ title: 'Agents', count: s.workers.length, sub: s.run.running ? 'what each one is doing this second' : 'idle', icon: 'users', flush: true,
        body: s.workers.length ? '<div class="rows">' + s.workers.map((w) => '<div class="row">' + avatar(w.name) + '<div class="tx"><b>' + esc(w.name) + ' <span style="display:inline;font-weight:400;color:var(--ink-500)">' + esc(w.kind) + '</span></b><span>' + esc(w.where || w.did || '—') + '</span></div>' +
          chip(w.state, w.state === 'stuck' ? 'amber' : w.state === 'thinking' ? 'blue' : w.state === 'idle' ? 'neutral' : 'green', true) + '</div>').join('') + '</div>'
          : empty('users', 'No agents yet', 'The scout signs up first; the crew follows once the map has something in it.') }) +
      card({ title: 'Judge', sub: 'one Jev request per step', icon: 'judge',
        body: meter('Suspicions being checked', String(j.suspicions.open), j.suspicions.open ? 100 : 0, 'amber') +
          meter('Confirmed', String(j.suspicions.confirmed), j.suspicions.confirmed + j.suspicions.unreproduced ? 100 * j.suspicions.confirmed / (j.suspicions.confirmed + j.suspicions.unreproduced) : 0, 'green') +
          meter('Did not hold on a second walk', String(j.suspicions.unreproduced), j.suspicions.confirmed + j.suspicions.unreproduced ? 100 * j.suspicions.unreproduced / (j.suspicions.confirmed + j.suspicions.unreproduced) : 0, 'grey') +
          '<div class="kv" style="margin-top:12px"><span>Rewalks</span><span>' + j.rewalks + '</span><span>Median answer</span><span>' + j.medianMs + ' ms</span><span>Tokens</span><span>' + (j.tokens / 1000).toFixed(0) + 'k</span></div>',
        footer: 'A probability above 0.85 files a suspicion. Two fresh-account walks must both agree before it is a finding.' }) +
    '</div></div>' +
    (s.steps.some((x) => x.verdicts.length) ? card({ title: 'Latest verdicts', sub: 'suspicions, not findings', icon: 'eye',
      body: '<div class="evidence">' + s.steps.filter((x) => x.verdicts.length).slice(0, 6).map((x) => '<a href="#live/' + x.id + '">' + (x.shot ? '<img src="/shots/' + x.shot + '" alt="">' : '<div style="height:120px"></div>') + '<div class="cap"><b style="color:var(--ink-900);font-weight:500">' + esc(checkName(x.verdicts[0].check)) + '</b> · ' + esc(x.path) + '</div></a>').join('') + '</div>' }) : '') +
  '</div>'
}

function startHero(s) {
  return '<div class="grid half"><div class="col">' +
    card({ title: 'Point Shoal at your app', sub: 'it signs itself up and takes it from there', icon: 'play',
      body: startForm(s, true) }) +
    '</div><div class="col">' +
    card({ title: 'What happens next', icon: 'spark', flush: true, body: '<div class="rows">' +
      [['1', 'It makes an account', 'Finds the signup form, invents an identity, reads its own verification mail on :1025.'],
       ['2', 'It walks every screen', 'Code opens every untried link; Jev reads each screen and says what kind it is. That is the map.'],
       ['3', 'The crew goes in', 'Missions written from the map, each with a persona — the one who double-clicks Pay, the one who types −1.'],
       ['4', 'Every screen is judged', 'Thirty questions after every action, each a calibrated probability, for a hundredth of a cent.'],
       ['5', 'Only what holds is reported', 'A suspicion is walked again in a fresh account, twice. HTTP suspicions are replayed eight at once.']]
      .map(([n, t, d]) => '<div class="row"><span class="step-n">' + n + '</span><div class="tx"><b>' + t + '</b><span style="white-space:normal">' + d + '</span></div></div>').join('') + '</div>',
      footer: 'Localhost only, and it is not negotiable. It signs itself up, submits whatever it likes and hammers your write endpoints.' }) +
    '</div></div>'
}

function startForm(s, inline) {
  const r = s.run
  return '<form class="form" id="startform">' +
    '<label class="f"><b>App URL</b><input class="field" name="url" value="' + esc(r.url || 'http://localhost:3000') + '" placeholder="http://localhost:3000" required></label>' +
    '<div class="two">' +
      '<label class="f"><b>For how long</b><select class="field" name="for"><option value="10">10 minutes</option><option value="30" selected>30 minutes</option><option value="120">2 hours</option><option value="480">8 hours</option><option value="1440">24 hours</option></select></label>' +
      '<label class="f"><b>Jev budget</b><input class="field" name="usd" type="number" step="0.05" min="0" value="' + (r.maxUsd != null ? r.maxUsd : 1) + '"><span class="hint">a dollar is roughly eight thousand judged screens</span></label>' +
    '</div>' +
    '<div class="two"><label class="f"><b>Explorers</b><select class="field" name="explorers">' + [1, 2, 3, 4, 6].map((n) => '<option' + (n === (r.explorers || 3) ? ' selected' : '') + '>' + n + '</option>').join('') + '</select><span class="hint">browser agents, each its own account</span></label></div>' +
    '<div class="err" id="starterr"></div>' +
    '<div class="end">' + (inline ? '' : '<button type="button" class="btn secondary" id="cancelstart">Cancel</button>') + '<button type="submit" class="btn accent lg">' + I.play + 'Start the run</button></div>' +
    '</form>'
}

function openStart(s) {
  const m = $('#modal')
  m.classList.add('on')
  m.innerHTML = '<div class="box"><h3>' + (s.run.exists ? 'Run again' : 'Start a run') + '</h3><p class="p">' + (s.run.exists ? 'The map and the accounts from last time are kept; the queue picks up where it stopped.' : 'A URL is the whole setup.') + '</p>' + startForm(s, false) + '</div>'
  wireStart()
  $('#cancelstart').onclick = () => m.classList.remove('on')
}

function wireStart() {
  const f = $('#startform')
  if (!f) return
  f.onsubmit = async (ev) => {
    ev.preventDefault()
    const b = f.querySelector('[type=submit]')
    b.disabled = true
    const fd = new FormData(f)
    const body = { url: fd.get('url'), forMs: Number(fd.get('for')) * 60000, maxUsd: Number(fd.get('usd')), explorers: Number(fd.get('explorers')) }
    const r = await fetch('/api/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({ error: 'could not reach shoal' }))
    if (r.error) { $('#starterr').textContent = r.error; b.disabled = false; return }
    $('#modal').classList.remove('on')
    go('live')
  }
}

// ---------- live ----------
function live(s) {
  const rows = filterSteps(s.steps)
  return '<div class="stack">' +
    '<div class="toolbar">' + filterBar('live', [['all', 'All'], ['verdict', 'With a verdict', s.judge.withVerdict], ['mission', 'Missions'], ['rewalk', 'Walking again'], ['form', 'Forms']]) +
      '<span class="hint">' + s.judge.steps + ' screens judged · newest first</span></div>' +
    '<div class="film" id="film">' + (rows.length ? rows.map(frame).join('') : empty('live', 'Nothing here yet', 'Every screen an agent lands on appears here with what Jev answered about it.')) + '</div>' +
    (s.steps.length >= 48 ? '<button class="btn secondary" id="more" style="align-self:center">Earlier steps</button>' : '') +
    '</div>'
}
const filterSteps = (xs) => xs.filter((x) => filters.live === 'all' || (filters.live === 'verdict' ? x.verdicts.length : x.phase === filters.live))

function frame(x) {
  const d = x.decision
  let dec = ''
  if (d) {
    const conf = pct(d.targetConfidence == null ? d.confidence : d.targetConfidence)
    dec = d.target
      ? 'Jev chose ' + chip(d.operation.replace('_', ' ').toLowerCase(), 'green', true) + '<b style="font-weight:500;color:var(--ink-900)">' + esc(d.target.role) + ' “' + esc(d.target.name) + '”' + (d.option ? ' = ' + esc(d.option) : '') + '</b><span class="hint">' + conf + '% sure</span>'
      : 'Jev chose ' + chip(d.operation.toLowerCase(), d.operation === 'DONE' ? 'green' : d.operation === 'BLOCKED' ? 'red' : 'neutral', true) + '<span class="hint">' + pct(d.confidence) + '% sure</span>'
  } else if (x.phase === 'explore') dec = '<span class="hint">code picked the next untried link</span>'
  else if (x.phase === 'rewalk') dec = '<span class="hint">walked again in a fresh account' + (x.rewalkOf ? ' for <a href="#suspicions/' + x.rewalkOf + '">suspicion #' + x.rewalkOf + '</a>' : '') + '</span>'
  return '<article class="frame' + (x.verdicts.length ? ' hit' : '') + '" data-step="' + x.id + '">' +
    '<div class="shot" data-open="' + x.id + '">' + (x.shot ? '<img loading="lazy" src="/shots/' + x.shot + '" alt="">' : '<div class="none">no picture</div>') + '<span class="ph">' + phaseChip(x.phase) + '</span></div>' +
    '<div class="fb">' +
      '<div class="l1"><div class="who">' + avatar(x.worker) + '<b>' + esc(x.worker) + '</b>' + (x.account ? '<span>' + esc(x.account) + '</span>' : '') + '</div><span class="t">' + clock(x.at) + '</span></div>' +
      '<div class="where"><span>' + esc(x.path) + '</span>' + (x.kind ? chip(x.kind, 'outline', true) : '') + (x.changed ? '' : chip('unchanged', 'neutral', true)) + '</div>' +
      '<div class="act">after <b>' + esc(x.action) + '</b></div>' +
      (dec ? '<div class="dec">' + dec + '</div>' : '') +
      '<div class="probs">' + x.top.map(([k, p]) => '<div class="pr' + (p >= 0.85 ? ' hot' : '') + '"><span>' + esc(checkName(k)) + '</span><span class="track"><i style="width:' + pct(p) + '%"></i></span><span class="pv">' + pct(p) + '</span></div>').join('') + '</div>' +
      (x.verdicts.length ? '<div class="dmeta" style="margin:4px 0 0">' + x.verdicts.map((v) => chip(checkName(v.check) + (v.p < 1 ? ' ' + pct(v.p) + '%' : ''), (KIND[v.kind] || [0, 'red'])[1])).join('') + '</div>' : '') +
      '<div class="l3"><span>' + (x.goal ? esc(x.goal.slice(0, 110)) : '') + '</span><span>' + (x.cached ? 'cached' : (x.tokens / 1000).toFixed(1) + 'k tokens · ' + x.ms + ' ms') + '</span></div>' +
    '</div></article>'
}

function refreshFilm(s) {
  const film = $('#film')
  const first = film.querySelector('.frame')
  const top = first ? Number(first.dataset.step) : 0
  const fresh = filterSteps(s.steps).filter((x) => x.id > top && !pendingSteps.some((p) => p.id === x.id))
  pendingSteps = fresh.concat(pendingSteps)
  if (!pendingSteps.length) return
  const c = $('#content')
  if (c.scrollTop < 60 && !$('#drawer').classList.contains('on')) flushFilm()
  else {
    let pill = $('#newsteps')
    if (!pill) {
      pill = document.createElement('button')
      pill.id = 'newsteps'; pill.className = 'btn accent sm newpill'
      pill.onclick = () => { flushFilm(); c.scrollTo({ top: 0 }) }
      film.parentElement.insertBefore(pill, film)
    }
    pill.textContent = pendingSteps.length + ' new ↑'
  }
}
function flushFilm() {
  const film = $('#film')
  if (!film) return
  const e = film.querySelector('.empty'); if (e) e.remove()
  film.insertAdjacentHTML('afterbegin', pendingSteps.sort((a, b) => b.id - a.id).map(frame).join(''))
  pendingSteps = []
  const pill = $('#newsteps'); if (pill) pill.remove()
  wire()
}

async function openStep(id) {
  const dr = $('#drawer')
  dr.classList.add('on'); $('#veil').classList.add('on')
  dr.innerHTML = '<div class="dh"><h3>Step ' + id + '</h3><button class="x" id="dclose">' + I.x + '</button></div><div class="db"><span class="hint">loading…</span></div>'
  $('#dclose').onclick = closeDrawer
  let x
  try { x = await fetch('/api/step/' + id).then((r) => r.json()) } catch (e) { dr.querySelector('.db').textContent = 'could not load'; return }
  const nouls = Object.entries(x.answers).filter(([, v]) => typeof v === 'number').sort((a, b) => b[1] - a[1])
  const d = x.decisionFull
  dr.innerHTML = '<div class="dh"><div style="min-width:0"><h3 class="mono" style="font-size:14px">' + esc(x.path) + '</h3><span class="hint">' + esc(x.worker) + ' · ' + clock(x.at) + (x.account ? ' · ' + esc(x.account) : '') + '</span></div>' +
    '<div class="dmeta" style="margin:0">' + phaseChip(x.phase) + (x.kind ? chip(x.kind, 'outline', true) : '') + '</div><button class="x" id="dclose">' + I.x + '</button></div>' +
    '<div class="db"><div class="split"><div>' +
      '<div class="pic">' + (x.shot ? '<img src="/shots/' + x.shot + '" alt="">' : '<div class="none" style="padding:40px;text-align:center;color:var(--ink-400)">no picture</div>') + '</div>' +
      '<div class="kv" style="margin-top:14px"><span>After</span><span>' + esc(x.action) + (x.changed ? '' : ' — the screen did not change') + '</span>' +
        (x.goal ? '<span>Goal</span><span>' + esc(x.goal) + '</span>' : '') +
        (Object.keys(x.entered || {}).length ? '<span>Entered</span><span>' + Object.entries(x.entered).map(([k, v]) => esc(k) + ' = ' + esc(String(v).length > 60 ? String(v).slice(0, 57) + '… (' + String(v).length + ' chars)' : v)).join(' · ') + '</span>' : '') +
        '<span>Cost</span><span>' + (x.cached ? 'cached — free' : x.tokens + ' tokens · ' + x.ms + ' ms · ' + usd(x.tokens * 0.042 / 1e6, 5)) + '</span></div>' +
      (x.verdicts.length ? '<div class="section">Verdicts</div><div class="dmeta">' + x.verdicts.map((v) => chip(checkName(v.check) + (v.p < 1 ? ' ' + pct(v.p) + '%' : ''), (KIND[v.kind] || [0, 'red'])[1])).join('') + '</div>' + x.verdicts.map((v) => '<p class="dp">' + esc(v.title) + '</p>').join('') : '') +
    '</div><div>' +
      (d ? '<div class="section">Jev chose</div><div class="ops">' + Object.entries(d.operations).sort((a, b) => b[1] - a[1]).map(([k, p]) => chip(k.replace('_', ' ').toLowerCase() + ' ' + pct(p) + '%', k === d.operation ? 'dark' : 'outline')).join('') + '</div>' +
        (d.target ? '<div class="kv"><span>Target</span><span>' + esc(d.target.role) + ' “' + esc(d.target.name) + '”' + (d.option ? ' = ' + esc(d.option) : '') + ' · ' + pct(d.targetConfidence == null ? d.confidence : d.targetConfidence) + '% sure</span></div>' : '') : '') +
      '<div class="section">The contract — ' + nouls.length + ' questions, one request</div>' +
      nouls.map(([k, p]) => '<div class="q' + (p >= 0.85 ? ' hot' : '') + '"><span>' + esc(checkName(k)) + '</span><span class="track' + (p >= 0.85 ? '' : ' grey') + '"><i style="width:' + pct(p) + '%"></i></span><span class="pv">' + pct(p) + '</span></div>').join('') +
    '</div></div></div>'
  $('#dclose').onclick = closeDrawer
}
function closeDrawer() { $('#drawer').classList.remove('on'); $('#veil').classList.remove('on') }

// ---------- findings ----------
function findings(s) {
  const all = s.findings
  const kinds = {}
  all.forEach((f) => { kinds[f.kind] = (kinds[f.kind] || 0) + 1 })
  const rows = all.filter((f) => filters.findings === 'all' || f.kind === filters.findings)
  const sel = rows.find((f) => f.id === route.id) || rows[0]
  return '<div class="stack">' +
    '<div class="toolbar">' + filterBar('findings', [['all', 'All', all.length]].concat(Object.keys(kinds).map((k) => [k, (KIND[k] || [k])[0], kinds[k]]))) + '</div>' +
    '<div class="card pane">' +
      '<div class="list">' + (rows.length ? rows.map((f) => '<div class="item" data-go="findings/' + f.id + '" aria-selected="' + (sel && sel.id === f.id) + '"><div class="tx"><b>' + esc(f.title) + '</b><div class="m">' + kindChip(f.kind) + chip(f.reproduced + '/' + f.attempts + ' reproduced', f.reproduced < f.attempts ? 'amber' : 'green', true) + '<span class="w">' + esc(f.where) + '</span></div></div><span class="t">' + hhmm(f.lastSeen) + '</span></div>').join('')
        : empty('bug', 'Nothing has reproduced', 'Agents file suspicions; only replay and rewalk turn one into a finding.')) + '</div>' +
      '<div class="detail">' + (sel ? findingDetail(sel) : '') + '</div>' +
    '</div>' +
    (s.unconfirmed.length ? card({ title: 'Did not hold', count: s.unconfirmed.length, sub: 'filed, checked, and not reproduced. Kept because one that keeps coming back is itself interesting', icon: 'eye', flush: true,
      body: '<table><tr><th>Expected</th><th>Saw</th></tr>' + s.unconfirmed.slice(0, 40).map((u) => '<tr><td>' + esc(u.expected) + '</td><td class="dim">' + esc(u.observed) + '</td></tr>').join('') + '</table>' }) : '') +
    '</div>'
}

function findingDetail(f) {
  return '<div class="dhead"><h3>' + esc(f.title) + '</h3></div>' +
    '<div class="dmeta">' + kindChip(f.kind) + chip(f.surface === 'screen' ? 'seen on screen' : 'seen in traffic', f.surface === 'screen' ? 'blue' : 'neutral') + chip(f.reproduced + ' of ' + f.attempts + ' reproduced', f.reproduced < f.attempts ? 'amber' : 'green') + (f.where ? chip(esc(f.where), 'outline') : '') + '</div>' +
    '<p class="dp">' + esc(f.detail) + '</p>' +
    (f.evidence && f.evidence.length ? '<div class="section">Evidence</div><div class="evidence">' + f.evidence.map((e) => '<a href="#live/' + e.stepId + '">' + (e.shot ? '<img src="/shots/' + e.shot + '" alt="">' : '<div style="height:120px"></div>') + '<div class="cap">' + (e.phase === 'rewalk' ? 'seen again in a fresh account' : 'first seen') + ' · ' + hhmm(e.at) + '</div></a>').join('') + '</div>' : '') +
    (f.steps.length ? '<div class="section">How to reproduce it — ' + f.steps.length + ' step' + (f.steps.length === 1 ? '' : 's') + '</div><div class="steps">' + f.steps.map((st, n) =>
      '<div class="st"><span class="n">' + (n + 1) + '</span><span>' + (st.method === 'browser' ? esc(st.status) : '<span class="mono">' + esc(st.method) + ' ' + esc(st.path) + '</span> → ' + esc(st.status)) + (st.as ? ' <span class="hint">as ' + esc(st.as) + '</span>' : '') + '</span><span class="w">' + (st.method === 'browser' ? esc(st.path) : '') + '</span>' +
      (st.note ? '<span class="note">' + esc(st.note) + '</span>' : '') + '</div>').join('') + '</div>' : '') +
    '<div class="kv" style="margin-top:16px"><span>First seen</span><span>' + hhmm(f.firstSeen) + '</span><span>Last seen</span><span>' + hhmm(f.lastSeen) + ' · ' + f.occurrences + ' time' + (f.occurrences === 1 ? '' : 's') + '</span><span>Check</span><span class="mono">' + esc(f.check) + '</span>' + (f.recordings.length ? '<span>Recordings</span><span>' + f.recordings.map((r) => '#' + r).join(' ') + '</span>' : '') + '</div>' +
    '<div style="display:flex;gap:8px;margin-top:16px"><button class="btn primary" data-recheck="' + f.id + '">Recheck against the app as it is now</button></div>'
}

// ---------- suspicions ----------
function suspicions(s) {
  const all = s.suspicions
  const cnt = { all: all.length, open: 0, confirmed: 0, unreproduced: 0 }
  all.forEach((x) => { if (cnt[x.state] != null) cnt[x.state]++ })
  const rows = all.filter((x) => filters.sus === 'all' || x.state === filters.sus)
  const sel = rows.find((x) => x.id === route.id) || rows[0]
  return '<div class="stack">' +
    '<div class="toolbar">' + filterBar('sus', [['all', 'All', cnt.all], ['open', 'Being checked', cnt.open], ['confirmed', 'Confirmed', cnt.confirmed], ['unreproduced', 'Did not hold', cnt.unreproduced]]) + '</div>' +
    '<div class="card pane"><div class="list">' + (rows.length ? rows.map((x) => '<div class="item" data-go="suspicions/' + x.id + '" aria-selected="' + (sel && sel.id === x.id) + '"><div class="tx"><b>' + esc(x.title) + '</b><div class="m">' + stateChip(x.state) + chip(checkName(x.check), 'outline', true) + (x.p != null && x.p < 1 ? chip(pct(x.p) + '%', 'neutral', true) : '') + '</div></div><span class="t">' + hhmm(x.at) + '</span></div>').join('')
      : empty('eye', 'Nothing here', 'Suspicions appear the moment a screen or a request looks wrong.')) + '</div>' +
    '<div class="detail">' + (sel ? susDetail(sel) : '') + '</div></div></div>'
}
function susDetail(x) {
  return '<div class="dhead"><h3>' + esc(x.title) + '</h3></div>' +
    '<div class="dmeta">' + stateChip(x.state) + chip(checkName(x.check), 'outline') + (x.p != null ? chip(x.p >= 1 ? 'decided in code' : 'Jev ' + pct(x.p) + '%', x.p >= 1 ? 'neutral' : 'blue') : '') + (x.retries ? chip('retried ' + x.retries + '×', 'amber') : '') + '</div>' +
    '<div class="kv"><span>Expected</span><span>' + esc(x.expected) + '</span><span>Observed</span><span>' + esc(x.observed) + '</span>' + (x.screen ? '<span>Screen</span><span class="mono">' + esc(x.screen) + '</span>' : '') + '<span>Filed by</span><span>' + esc(x.worker) + ' at ' + clock(x.at) + (x.recording ? ' · recording #' + x.recording : '') + '</span></div>' +
    (x.source === 'screen'
      ? (x.state === 'open' ? callout('amber', 'eye', 'A confirmer is walking this again in a brand new account. Both walks have to agree.') : x.state === 'unreproduced' ? callout('grey', 'eye', 'Walked again in a fresh account and it did not hold. Not reported.') : callout('green', 'bug', 'Held on every walk. It is a <a href="#findings">finding</a>.'))
      : (x.state === 'open' ? callout('amber', 'eye', 'A confirmer is replaying the request behind this, five times, with no model involved.') : x.state === 'unreproduced' ? callout('grey', 'eye', 'Replayed and it did not reproduce. Not reported.') : callout('green', 'bug', 'Reproduced on replay. It is a <a href="#findings">finding</a>.'))) +
    (x.trail.length ? '<div class="section">The trail a confirmer replays</div><div class="steps">' + x.trail.map((t, i) => '<div class="st"><span class="n">' + (i + 1) + '</span><span>' + esc(trailStep(t)) + '</span><span class="w">' + esc(t.url) + '</span></div>').join('') + '</div>' : '')
}
function trailStep(t) {
  if (t.op === 'goto') return 'open ' + t.path
  if (t.op === 'click') return 'click ' + t.role + ' “' + t.name + '”'
  if (t.op === 'type') return 'type “' + (t.text.length > 40 ? t.text.slice(0, 37) + '…' : t.text) + '” into “' + t.name + '”'
  if (t.op === 'select') return 'choose “' + t.value + '” in “' + t.name + '”'
  if (t.op === 'press') return 'press ' + t.key
  return t.op
}

// ---------- map, accounts, log ----------
function mapView(s) {
  const tab = filters.map
  const body = tab === 'screens'
    ? '<table><tr><th></th><th>Screen</th><th>Title</th><th class="r">Visits</th></tr>' + s.map.pages.map((p) => '<tr><td>' + (p.explored ? '' : chip('never opened', 'amber', true)) + '</td><td class="mono">' + esc(p.pattern) + '</td><td class="dim">' + esc(p.title || '') + '</td><td class="r num">' + p.visits + '</td></tr>').join('') + '</table>'
    : tab === 'endpoints'
    ? '<table><tr><th></th><th>Endpoint</th><th class="r">Calls</th><th>Answers</th><th>Hammered</th></tr>' + s.map.endpoints.map((e) => '<tr><td>' + (e.writes && !e.hammered ? chip('never', 'amber', true) : '') + '</td><td class="mono">' + esc(e.method + ' ' + e.path) + '</td><td class="r num">' + e.calls + '</td><td class="dim mono">' + esc(e.statuses) + '</td><td>' + (e.writes ? bare(e.hammered ? 100 : 0) : chip('read', 'neutral', true)) + '</td></tr>').join('') + '</table>'
    : '<table><tr><th>Form</th><th class="r">Fields</th><th>Value classes tried</th></tr>' + s.map.forms.map((f) => '<tr><td>' + esc(f.name || '(unnamed)') + '</td><td class="r num">' + f.fields + '</td><td>' + bare(f.fields ? 100 * f.poked / f.fields : 0) + ' <span class="hint">' + f.poked + '/' + f.fields + '</span></td></tr>').join('') + '</table>'
  return '<div class="stack"><div class="toolbar"><div class="tabs">' + [['screens', 'Screens', s.map.pages.length], ['endpoints', 'Endpoints', s.map.endpoints.length], ['forms', 'Forms', s.map.forms.length]].map(([k, l, n]) => '<button role="tab" data-tab="' + k + '" aria-selected="' + (tab === k) + '">' + l + '<span class="cnt">' + n + '</span></button>').join('') + '</div></div>' +
    '<div class="card"><div class="bd flush">' + body + '</div></div></div>'
}

function accounts(s) {
  return '<div class="stack">' +
    (s.tenancy === 'shared' ? callout('blue', 'users', '<b>One shared workspace.</b> Every account can read the same data, so a cross-account read is the product working and is not reported.') : s.tenancy === 'isolated' ? callout('green', 'users', '<b>Accounts are separated.</b> One account reading another’s object is a leak and gets reported as one.') : callout('grey', 'users', 'Not enough accounts yet to know whether one reading another’s data is a bug or the point of the app.')) +
    '<div class="card"><div class="bd flush"><table><tr><th>Email</th><th>Role</th><th>Verified</th><th>State</th><th class="r">Requests</th><th class="r">Made</th></tr>' +
    s.accounts.map((a) => '<tr><td>' + avatar(a.email) + ' <span style="display:inline-block;vertical-align:middle">' + esc(a.email) + '</span></td><td class="dim">' + esc(a.role || '') + '</td><td>' + (a.verified ? chip('by mail', 'green', true) : chip('no', 'neutral', true)) + '</td><td>' + esc(a.state) + '</td><td class="r num">' + a.requests + '</td><td class="r dim">' + hhmm(a.created) + '</td></tr>').join('') + '</table></div></div></div>'
}

function log(s) {
  const TONE = { starved: 'amber', restart: 'blue', limit: 'red', stuck: 'neutral', info: 'neutral' }
  return '<div class="stack"><div class="card"><div class="hd flush"><div class="t">' + ibox('log') + '<div class="tt"><h3>Run log</h3><span class="s">the run’s own words, live</span></div></div></div><div class="bd flush"><div class="runlog" id="runlog">loading…</div></div></div>' +
    '<div class="card"><div class="hd flush"><div class="t">' + ibox('warn') + '<div class="tt"><h3>Events</h3><span class="cnt">' + s.events.length + '</span></div></div></div><div class="bd flush log">' +
    (s.events.length ? s.events.map((e) => '<div class="l"><span class="t">' + hhmm(e.at) + '</span><span>' + chip(e.kind, TONE[e.kind] || 'neutral', true) + '</span><span>' + esc(e.message) + '</span></div>').join('') : '<div class="empty"><span>nothing to report</span></div>') + '</div></div></div>'
}

// ---------- shared ----------
function filterBar(key, items) {
  return '<div class="filters">' + items.map(([k, l, n]) => '<button data-f="' + key + ':' + k + '" aria-pressed="' + (filters[key] === k) + '">' + l + (n != null ? '<span class="cnt">' + n + '</span>' : '') + '</button>').join('') + '</div>'
}

let loadingMore = false
function wire() {
  document.querySelectorAll('[data-go]').forEach((el) => (el.onclick = () => { const [v, id] = el.dataset.go.split('/'); go(v, id) }))
  document.querySelectorAll('[data-open]').forEach((el) => (el.onclick = () => openStep(Number(el.dataset.open))))
  document.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { const [k, v] = b.dataset.f.split(':'); filters[k] = v; if (k === 'live') pendingSteps = []; if (k !== 'live') route.id = null; $('#content').innerHTML = ''; draw() }))
  document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { filters.map = b.dataset.tab; draw() }))
  document.querySelectorAll('[data-recheck]').forEach((b) => (b.onclick = async () => {
    b.disabled = true; b.textContent = 'rechecking…'
    const r = await fetch('/api/recheck/' + b.dataset.recheck, { method: 'POST' }).then((x) => x.json()).catch(() => ({ error: 'could not reach shoal' }))
    b.textContent = r.error ? 'failed: ' + r.error : r.message || 'done'
  }))
  const more = $('#more')
  if (more) more.onclick = async () => {
    if (loadingMore) return
    loadingMore = true
    const film = $('#film')
    const last = film.querySelector('.frame:last-child')
    more.textContent = 'loading…'
    const rows = await fetch('/api/steps?before=' + (last ? last.dataset.step : 0) + '&limit=60').then((r) => r.json()).catch(() => [])
    filterSteps(rows).forEach((x) => film.insertAdjacentHTML('beforeend', frame(x)))
    more.textContent = rows.length ? 'Earlier steps' : 'That is all of them'
    loadingMore = false
    wire()
  }
  if (route.view === 'log') fetch('/api/runlog').then((r) => r.json()).then((r) => { const el = $('#runlog'); if (el) { el.textContent = r.lines.join('\n') || 'nothing yet'; el.scrollTop = el.scrollHeight } }).catch(() => null)
  if (route.view === 'live' && route.id && !$('#drawer').classList.contains('on')) { openStep(route.id); route.id = null }
  wireStart()
}
$('#veil').onclick = closeDrawer
$('#modal').onclick = (ev) => { if (ev.target === $('#modal')) $('#modal').classList.remove('on') }
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { closeDrawer(); $('#modal').classList.remove('on') } })

// ---------- stream ----------
let lastView = null
function render(s) {
  S = s
  if (route.view !== lastView) { $('#content').innerHTML = ''; lastView = route.view }
  draw()
}
let stream = null
function connect() {
  stream = new EventSource('/events')
  stream.onmessage = (m) => { $('#stale').hidden = true; render(JSON.parse(m.data)) }
  stream.onerror = () => { stream.close(); $('#stale').hidden = false; $('#stale').textContent = 'live stream dropped — polling every 5s'; setTimeout(poll, 5000) }
}
async function poll() {
  try { render(await fetch('/api/state').then((r) => r.json())) } catch (e) { /* still down */ }
  setTimeout(() => (navigator.onLine ? connect() : poll()), 5000)
}
window.addEventListener('hashchange', () => { lastView = null })
fetch('/api/state').then((r) => r.json()).then(render).then(connect).catch(poll)
`
