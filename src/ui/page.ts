/** The dashboard, served as it is written. No framework, no bundler, no
 * build step: a dev tool that can fail to compile is one that stops you
 * shipping, and this has to start at 2am on somebody else's machine.
 */
export const CSS = String.raw`
:root{
  --bg:#0b0d0f; --panel:#111417; --panel2:#15191d; --line:#1e2429;
  --tx:#c9d1d6; --dim:#6b7780; --dimmer:#454f57;
  --accent:#3ddad0; --accent-dim:#1c5b57;
  --leak:#ff5c7a; --loss:#ff8a3d; --money:#ffc94d; --race:#b98cff;
  --auth:#5aa9ff; --fault:#ff6b6b; --wrong:#7fd67f; --slow:#8a93a0;
  --ok:#4ec97a; --warn:#e8b84b; --bad:#ff5c7a;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{
  background:var(--bg); color:var(--tx);
  font:13px/1.5 var(--mono);
  display:grid; grid-template-columns:196px 1fr; height:100vh; overflow:hidden;
}

/* ---------- rail ---------- */
.rail{background:var(--panel);border-right:1px solid var(--line);display:flex;flex-direction:column;padding:14px 0}
.brand{padding:2px 16px 18px;display:flex;align-items:center;gap:9px}
.brand svg{display:block}
.brand b{font-size:14px;letter-spacing:.14em;font-weight:600;color:#e8eef1}
.nav{display:flex;flex-direction:column;gap:1px;padding:0 8px}
.nav button{
  all:unset;cursor:pointer;padding:7px 10px;border-radius:5px;color:var(--dim);
  display:flex;justify-content:space-between;align-items:center;font-size:12.5px;
}
.nav button:hover{background:var(--panel2);color:var(--tx)}
.nav button[aria-selected=true]{background:var(--panel2);color:#e8eef1;box-shadow:inset 2px 0 0 var(--accent)}
.nav .n{color:var(--dimmer);font-size:11px}
.nav button[aria-selected=true] .n{color:var(--accent)}
.railfoot{margin-top:auto;padding:14px 16px 2px;border-top:1px solid var(--line);font-size:11.5px;color:var(--dim)}
.railfoot .row{display:flex;justify-content:space-between;padding:2.5px 0}
.railfoot b{color:var(--tx);font-weight:500}
.live{display:inline-flex;align-items:center;gap:6px;color:var(--accent)}
.dot{width:6px;height:6px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 0 var(--accent-dim);animation:p 2.4s ease-out infinite}
@keyframes p{0%{box-shadow:0 0 0 0 rgba(61,218,208,.45)}70%{box-shadow:0 0 0 7px rgba(61,218,208,0)}100%{box-shadow:0 0 0 0 rgba(61,218,208,0)}}

/* ---------- main ---------- */
.main{overflow:auto;padding:18px 22px 40px}
.view{display:none}.view.on{display:block}
h2{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);font-weight:600;margin:26px 0 10px}
h2:first-child{margin-top:2px}
.sub{color:var(--dimmer);font-size:11.5px;font-weight:400;letter-spacing:0;text-transform:none;margin-left:8px}

/* counters */
.counters{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:7px;overflow:hidden}
.counter{background:var(--panel);padding:11px 13px}
.counter .k{color:var(--dimmer);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase}
.counter .v{font-size:19px;color:#e8eef1;margin-top:3px;letter-spacing:-.01em}
.counter .v small{font-size:11.5px;color:var(--dim);letter-spacing:0}

.grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:16px;align-items:start}
@media (max-width:1080px){.grid2{grid-template-columns:1fr}}

.panel{background:var(--panel);border:1px solid var(--line);border-radius:7px;overflow:hidden}
.panel .hd{padding:8px 12px;border-bottom:1px solid var(--line);color:var(--dim);font-size:11px;letter-spacing:.12em;text-transform:uppercase;display:flex;justify-content:space-between}

/* explorer cards */
.ex{padding:10px 12px;border-bottom:1px solid var(--line)}
.ex:last-child{border-bottom:0}
.ex .top{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.ex .who{color:#e8eef1}
.ex .acct{color:var(--dimmer);font-size:11.5px}
.ex .state{font-size:11px;padding:1px 7px;border-radius:20px;border:1px solid}
.st-think{color:var(--accent);border-color:var(--accent-dim)}
.st-act{color:var(--wrong);border-color:#2c4a2c}
.st-stuck{color:var(--warn);border-color:#4a3d1c}
.ex .where{color:var(--dim);margin-top:5px;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ex .did{color:var(--dimmer);font-size:11.5px;margin-top:2px}
.ex .goal{color:var(--dimmer);font-size:11.5px;margin-top:4px;padding-top:5px;border-top:1px dashed var(--line)}

/* feed */
.feed{max-height:340px;overflow:auto;font-size:12px}
.feed .r{display:grid;grid-template-columns:52px 1fr 42px 52px 62px;gap:8px;padding:3.5px 12px;border-bottom:1px solid rgba(30,36,41,.55);align-items:baseline}
.feed .r:hover{background:var(--panel2)}
.m{color:var(--dim)}
.m.POST,.m.PUT,.m.PATCH,.m.DELETE{color:var(--money)}
.p{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--tx)}
.s{text-align:right}.s.ok{color:var(--ok)}.s.warn{color:var(--warn)}.s.bad{color:var(--bad)}
.ms{text-align:right;color:var(--dimmer)}
.w{color:var(--dimmer);text-align:right;font-size:11px}

/* hammer */
.ham{padding:9px 12px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:10px;align-items:baseline}
.ham:last-child{border-bottom:0}
.ham .ep{color:var(--tx)}
.ham .shape{font-size:11px;color:var(--dimmer);border:1px solid var(--line);padding:1px 6px;border-radius:3px}

/* findings */
.f{border:1px solid var(--line);border-radius:7px;background:var(--panel);margin-bottom:8px;overflow:hidden}
.f>summary{padding:11px 13px;cursor:pointer;list-style:none;display:grid;grid-template-columns:26px 92px 1fr auto auto;gap:12px;align-items:center}
.f>summary::-webkit-details-marker{display:none}
.f>summary:hover{background:var(--panel2)}
.f .id{color:var(--dimmer)}
.cat{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;padding:2px 7px;border-radius:3px;text-align:center;border:1px solid}
.cat.leak{color:var(--leak);border-color:#4d2230;background:#1d1216}
.cat.loss{color:var(--loss);border-color:#4a2e18;background:#1c1410}
.cat.money{color:var(--money);border-color:#463a15;background:#1b1810}
.cat.race{color:var(--race);border-color:#382b52;background:#16131d}
.cat.auth{color:var(--auth);border-color:#1f3a5c;background:#101620}
.cat.fault{color:var(--fault);border-color:#4a2424;background:#1c1212}
.cat.wrong{color:var(--wrong);border-color:#274527;background:#111a11}
.f .ttl{color:#e8eef1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.f .conf{color:var(--dim);font-size:11.5px}
.f .conf b{color:var(--ok);font-weight:500}
.f .conf.part b{color:var(--warn)}
.f .reach{color:var(--dimmer);font-size:11.5px}
.f .body{padding:2px 13px 14px 13px;border-top:1px solid var(--line)}
.f p{color:var(--dim);margin:11px 0;max-width:74ch;line-height:1.65}
.repro{background:#0d1013;border:1px solid var(--line);border-radius:5px;padding:9px 11px;margin:10px 0}
.repro .rl{display:grid;grid-template-columns:16px 52px 1fr 74px 40px;gap:9px;padding:2.5px 0;align-items:baseline}
.repro .n{color:var(--dimmer)}
.repro .as{color:var(--dimmer);font-size:11.5px}
.repro .note{color:var(--leak);font-size:11.5px;margin-top:6px;padding-top:6px;border-top:1px dashed var(--line)}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:9px;margin-top:12px;font-size:11.5px}
.meta .k{color:var(--dimmer);text-transform:uppercase;letter-spacing:.09em;font-size:10.5px}
.meta .v{color:var(--tx);margin-top:2px}
.btn{all:unset;cursor:pointer;border:1px solid var(--accent-dim);color:var(--accent);padding:5px 12px;border-radius:5px;font-size:12px;margin-top:12px;display:inline-block}
.btn:hover{background:#0f1f1e}
.unconf{border-top:1px solid var(--line);margin-top:22px;padding-top:12px}
.unconf .u{display:grid;grid-template-columns:1fr 78px 88px;gap:10px;padding:4px 2px;color:var(--dim);font-size:12px;border-bottom:1px solid rgba(30,36,41,.5)}
.unconf .u span:last-child{color:var(--dimmer);text-align:right}

/* tables */
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;color:var(--dimmer);font-weight:500;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;padding:7px 12px;border-bottom:1px solid var(--line)}
td{padding:6px 12px;border-bottom:1px solid rgba(30,36,41,.5)}
tr:hover td{background:var(--panel2)}
td.num{text-align:right;color:var(--dim)}
.bar{height:4px;background:#1a2024;border-radius:2px;overflow:hidden;min-width:56px}
.bar i{display:block;height:100%;background:var(--accent)}
.bar.none i{background:#3a2f2f}
.tag{font-size:10.5px;color:var(--dimmer);border:1px solid var(--line);padding:1px 5px;border-radius:3px}
.never{color:var(--warn)}

/* log */
.log .l{display:grid;grid-template-columns:64px 92px 1fr;gap:12px;padding:5px 12px;border-bottom:1px solid rgba(30,36,41,.5);font-size:12px}
.log .t{color:var(--dimmer)}
.log .kind{font-size:10.5px;letter-spacing:.09em;text-transform:uppercase}
.k-starved{color:var(--warn)}.k-restart{color:var(--auth)}.k-limit{color:var(--loss)}
.k-stuck{color:var(--dim)}.k-info{color:var(--dimmer)}
.pinned{background:#1a1610;border:1px solid #4a3d1c;border-radius:6px;padding:10px 12px;margin-bottom:12px}
.pinned .h{color:var(--warn);font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:6px}
.pinned .s{display:grid;grid-template-columns:1fr 60px 1fr;gap:10px;padding:2px 0;font-size:12px;color:var(--dim)}
.note{color:var(--dimmer);font-size:11.5px;margin:8px 0 0;max-width:80ch;line-height:1.6}

.empty{color:var(--dimmer);padding:14px 12px;font-size:12px}
.stale{position:fixed;right:14px;bottom:12px;background:var(--panel2);border:1px solid var(--line);border-radius:6px;padding:6px 10px;color:var(--warn);font-size:11.5px}
.err{color:var(--bad)}
`

export const HTML = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shoal</title><link rel="stylesheet" href="/app.css"></head>
<body>
<nav class="rail">
  <div class="brand">
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M2 13c2.2-1.6 4-1.6 6 0 2-1.6 3.8-1.6 6 0 1.4-1.1 2.7-1.5 4-1.2" stroke="#3ddad0" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M2 17c2.2-1.6 4-1.6 6 0 2-1.6 3.8-1.6 6 0" stroke="#1c5b57" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M11.5 3 17 6.2l-5.5 3.2V3Z" fill="#3ddad0"/><circle cx="13.2" cy="5.6" r=".8" fill="#0b0d0f"/>
    </svg><b>SHOAL</b>
  </div>
  <div class="nav" role="tablist">
    <button role="tab" aria-selected="true"  data-v="now">Now</button>
    <button role="tab" aria-selected="false" data-v="findings">Findings <span class="n" id="n-find">0</span></button>
    <button role="tab" aria-selected="false" data-v="map">Map <span class="n" id="n-map">0</span></button>
    <button role="tab" aria-selected="false" data-v="accounts">Accounts <span class="n" id="n-acct">0</span></button>
    <button role="tab" aria-selected="false" data-v="log">Log <span class="n" id="n-log">0</span></button>
  </div>
  <div class="railfoot" id="foot"></div>
</nav>
<main class="main">
  <section class="view on" id="v-now"></section>
  <section class="view" id="v-findings"></section>
  <section class="view" id="v-map"></section>
  <section class="view" id="v-accounts"></section>
  <section class="view" id="v-log"></section>
</main>
<div class="stale" id="stale" hidden></div>
<script src="/app.js"></script>
</body></html>`

export const JS = String.raw`
const $ = (s) => document.querySelector(s)
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const num = (n) => (n == null ? '—' : String(n))
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const hhmm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const dur = (ms) => { const m = Math.floor(ms / 60000); return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm' }
const CAT = { leak: 'leak', 'data-loss': 'loss', money: 'money', race: 'race', auth: 'auth', fault: 'fault', wrong: 'wrong', slow: 'wrong', noise: 'wrong' }

let view = 'now'
let openFinding = null

document.querySelectorAll('.nav button').forEach((b) => b.addEventListener('click', () => {
  view = b.dataset.v
  document.querySelectorAll('.nav button').forEach((x) => x.setAttribute('aria-selected', String(x === b)))
  document.querySelectorAll('.view').forEach((x) => x.classList.toggle('on', x.id === 'v-' + view))
}))

function render(s) {
  $('#n-find').textContent = s.counters.findings
  $('#n-map').textContent = s.counters.endpoints
  $('#n-acct').textContent = s.counters.accounts
  $('#n-log').textContent = s.events.length
  $('#foot').innerHTML =
    row(s.app.running ? '<span class="live"><i class="dot"></i>running</span>' : '<span>stopped</span>', dur(s.app.uptimeMs)) +
    row('target', esc(s.app.url.replace(/^https?:\/\/localhost/, ''))) +
    row('driver', esc(s.app.driver)) + row('planner', esc(s.app.planner)) +
    row('spend', '$' + s.counters.spend.toFixed(2)) + row('build', esc(s.app.build))

  $('#v-now').innerHTML = now(s)
  $('#v-findings').innerHTML = findings(s)
  $('#v-map').innerHTML = mapView(s)
  $('#v-accounts').innerHTML = accounts(s)
  $('#v-log').innerHTML = log(s)
  wireFindings()
}

const row = (k, v) => '<div class="row"><span>' + k + '</span><b>' + v + '</b></div>'
const counter = (k, v, small) => '<div class="counter"><div class="k">' + k + '</div><div class="v">' + v + (small ? ' <small>' + small + '</small>' : '') + '</div></div>'

function now(s) {
  const c = s.counters
  return '<h2>Now <span class="sub">' + esc(s.app.url) + ' · ' + dur(s.app.uptimeMs) + ' · ' +
    s.app.config.explorers + ' explorers, ' + s.app.config.hammerers + ' hammerers, ' + s.app.config.confirmers + ' confirmers</span></h2>' +
    '<div class="counters">' +
      counter('Pages', c.pages, c.pagesExplored + ' explored') +
      counter('Endpoints', c.endpoints, c.endpointsHammered + ' / ' + c.writeEndpoints + ' hammered') +
      counter('Fields poked', c.fieldsPoked, '/ ' + c.fields) +
      counter('Accounts', c.accounts, s.tenancy || '') +
      counter('Findings', c.findings, c.unconfirmed ? '+' + c.unconfirmed + ' unconf' : '') +
      counter('Frontier', c.frontier) +
      counter('Calls / action', c.perAction.toFixed(2)) +
      counter('Spend', '$' + c.spend.toFixed(2)) +
    '</div>' +
    (s.starved.length ? starved(s) : '') +
    '<div class="grid2" style="margin-top:16px"><div>' +
      panel('Explorers', s.workers.filter((w) => w.kind === 'explorer').length + ' active',
        s.workers.filter((w) => w.kind === 'explorer').map(exCard).join('') || '<div class="empty">no explorer has started yet</div>') +
      '<div style="height:16px"></div>' +
      panel('Hammerers', s.hammers.length ? 'last ' + s.hammers.length : 'idle',
        s.hammers.map((h) => '<div class="ham"><span class="ep">' + esc(h.endpoint) + '</span>' +
          '<span><span class="shape">' + esc(h.shape) + '</span> <span class="ms">' + h.workers + ' at once</span></span></div>').join('') ||
        '<div class="empty">nothing hammered yet — that starts once the map has a write endpoint in it</div>') +
    '</div><div>' +
      panel('Requests', s.counters.recordings + ' seen',
        '<div class="feed">' + s.feed.map((f) =>
          '<div class="r"><span class="m ' + esc(f.method) + '">' + esc(f.method) + '</span>' +
          '<span class="p">' + esc(f.path) + '</span>' +
          '<span class="s ' + (f.status >= 500 || f.status === 0 ? 'bad' : f.status >= 400 ? 'warn' : 'ok') + '">' + f.status + '</span>' +
          '<span class="ms">' + f.ms + 'ms</span><span class="w">' + esc(f.worker) + '</span></div>').join('') + '</div>') +
    '</div></div>'
}

function exCard(w) {
  const st = w.state === 'thinking' ? 'st-think' : w.state === 'stuck' ? 'st-stuck' : 'st-act'
  return '<div class="ex"><div class="top"><span class="who">' + esc(w.name) + '</span>' +
    '<span class="state ' + st + '">' + esc(w.state) + '</span></div>' +
    '<div class="where">' + esc(w.where || '—') + '</div>' +
    '<div class="did">last: ' + esc(w.did || '—') + '</div>' +
    (w.goal || w.account ? '<div class="goal">' + esc(w.goal || '') + (w.account ? ' · ' + esc(w.account) : '') + '</div>' : '') + '</div>'
}

const panel = (title, right, body) =>
  '<div class="panel"><div class="hd"><span>' + title + '</span><span>' + esc(right) + '</span></div>' + body + '</div>'

function starved(s) {
  return '<div class="pinned" style="margin-top:16px"><div class="h">Starved — tried and always refused</div>' +
    s.starved.map((x) => '<div class="s"><span>' + esc(x.action) + '</span><span>' + x.ok + '/' + x.tries + '</span><span>always ' + esc(x.statuses) + '</span></div>').join('') +
    '<div class="note">A swarm being refused looks exactly like a swarm finding nothing. Anything clean below means less than it looks.</div></div>'
}

function findings(s) {
  if (!s.findings.length) return '<h2>Findings</h2><div class="empty">Nothing has reproduced yet. Agents file suspicions; only replay turns one into a finding.</div>' + unconf(s)
  return '<h2>Findings <span class="sub">ranked by category, then how often it reproduced, then how far from signup</span></h2>' +
    s.findings.map((f, i) => {
      const cat = CAT[f.kind] || 'wrong'
      const part = f.reproduced < f.attempts ? ' part' : ''
      return '<details class="f" data-id="' + f.id + '"' + (openFinding === f.id ? ' open' : '') + '>' +
        '<summary><span class="id">#' + (i + 1) + '</span>' +
        '<span class="cat ' + cat + '">' + esc(f.kind) + '</span>' +
        '<span class="ttl">' + esc(f.title) + '</span>' +
        '<span class="conf' + part + '"><b>' + f.reproduced + '/' + f.attempts + '</b> reproduced</span>' +
        '<span class="reach">' + f.reach + ' steps</span></summary>' +
        '<div class="body"><p>' + esc(f.detail) + '</p>' +
        (f.steps.length ? '<div class="repro">' + f.steps.map((st, n) =>
          '<div class="rl"><span class="n">' + (n + 1) + '</span><span class="m ' + esc(st.method) + '">' + esc(st.method) + '</span>' +
          '<span class="p">' + esc(st.path) + '</span><span class="as">' + esc(st.as || '') + '</span>' +
          '<span class="s">' + esc(st.status) + '</span></div>' +
          (st.note ? '<div class="note">' + esc(st.note) + '</div>' : '')).join('') + '</div>' : '') +
        '<div class="meta">' +
          meta('State', f.state) + meta('Seen', f.occurrences + ' times') +
          meta('First', hhmm(f.firstSeen)) + meta('Last', hhmm(f.lastSeen)) +
          meta('Recordings', f.recordings.map((r) => '#' + r).join(' ') || '—') +
        '</div>' +
        '<button class="btn" data-recheck="' + f.id + '">Recheck against the app as it is now</button>' +
        '</div></details>'
    }).join('') + unconf(s)
}

const meta = (k, v) => '<div><div class="k">' + k + '</div><div class="v">' + esc(v) + '</div></div>'

function unconf(s) {
  if (!s.unconfirmed.length) return ''
  return '<div class="unconf"><h2>Not confirmed <span class="sub">filed by an agent, never reproduced. Kept because one that keeps coming back is itself interesting</span></h2>' +
    s.unconfirmed.map((u) => '<div class="u"><span>' + esc(u.expected) + '</span><span>saw</span><span>' + esc(u.observed) + '</span></div>').join('') + '</div>'
}

function mapView(s) {
  return '<h2>Map <span class="sub">untouched first — what you missed is more useful than what you covered</span></h2>' +
    panel('Endpoints', s.map.endpoints.length + '',
      '<table><tr><th></th><th>Method</th><th>Path</th><th>Calls</th><th>Statuses</th><th>Hammered</th></tr>' +
      s.map.endpoints.map((e) => '<tr><td>' + (e.hammered ? '' : '<span class="never">*</span>') + '</td>' +
        '<td class="m ' + esc(e.method) + '">' + esc(e.method) + '</td><td>' + esc(e.path) + '</td>' +
        '<td class="num">' + e.calls + '</td><td>' + esc(e.statuses) + '</td>' +
        '<td>' + (e.writes ? bar(e.hammered ? 1 : 0) : '<span class="tag">read</span>') + '</td></tr>').join('') + '</table>') +
    '<div style="height:16px"></div>' +
    panel('Screens', s.map.pages.length + '',
      '<table><tr><th></th><th>Pattern</th><th>Title</th><th>Visits</th></tr>' +
      s.map.pages.map((p) => '<tr><td>' + (p.explored ? '' : '<span class="never">*</span>') + '</td>' +
        '<td>' + esc(p.pattern) + '</td><td>' + esc(p.title || '') + '</td><td class="num">' + p.visits + '</td></tr>').join('') + '</table>') +
    '<div style="height:16px"></div>' +
    panel('Forms', s.map.forms.length + '',
      '<table><tr><th>Form</th><th>Fields</th><th>Value classes tried</th></tr>' +
      s.map.forms.map((f) => '<tr><td>' + esc(f.name || '(unnamed)') + '</td><td class="num">' + f.fields + '</td>' +
        '<td>' + bar(f.fields ? f.poked / f.fields : 0) + ' <span class="tag">' + f.poked + '/' + f.fields + '</span></td></tr>').join('') + '</table>')
}

const bar = (frac) => '<span class="bar' + (frac ? '' : ' none') + '"><i style="width:' + Math.round(frac * 100) + '%"></i></span>'

function accounts(s) {
  return '<h2>Accounts <span class="sub">every one of these signed itself up' + (s.tenancy ? ' · tenancy: ' + esc(s.tenancy) : '') + '</span></h2>' +
    panel('Accounts', s.accounts.length + '',
      '<table><tr><th>Email</th><th>Role</th><th>Verified</th><th>State</th><th>Requests</th><th>Made</th></tr>' +
      s.accounts.map((a) => '<tr><td>' + esc(a.email) + '</td><td>' + esc(a.role || '') + '</td>' +
        '<td>' + (a.verified ? 'yes' : 'no') + '</td><td>' + esc(a.state) + '</td>' +
        '<td class="num">' + a.requests + '</td><td>' + hhmm(a.created) + '</td></tr>').join('') + '</table>') +
    (s.tenancy === 'shared'
      ? '<p class="note">This app is one shared workspace: every account can read the same data. Cross-account reads are not leaks here, and Shoal will not report them as such.</p>'
      : s.tenancy === 'isolated'
      ? '<p class="note">Accounts are separated, so one account reading another\'s object is a leak and gets reported as one.</p>'
      : '<p class="note">Not enough accounts yet to know whether one reading another\'s data would be a bug or the point of the app.</p>')
}

function log(s) {
  return '<h2>Log <span class="sub">everything that made the run less than it appears</span></h2>' +
    (s.starved.length ? starved(s) : '') +
    '<div class="panel log">' + s.events.map((e) =>
      '<div class="l"><span class="t">' + hhmm(e.at) + '</span><span class="kind k-' + esc(e.kind) + '">' + esc(e.kind) + '</span><span>' + esc(e.message) + '</span></div>').join('') +
    (s.events.length ? '' : '<div class="empty">nothing to report</div>') + '</div>'
}

function wireFindings() {
  document.querySelectorAll('details.f').forEach((d) => d.addEventListener('toggle', () => { openFinding = d.open ? Number(d.dataset.id) : null }))
  document.querySelectorAll('[data-recheck]').forEach((b) => b.addEventListener('click', async (ev) => {
    ev.preventDefault()
    b.textContent = 'rechecking…'
    const r = await fetch('/api/recheck/' + b.dataset.recheck, { method: 'POST' }).then((x) => x.json()).catch(() => ({ error: 'could not reach shoal' }))
    b.textContent = r.error ? 'failed: ' + r.error : r.message || 'done'
  }))
}

let stream = null
function connect() {
  stream = new EventSource('/events')
  stream.onmessage = (m) => { $('#stale').hidden = true; render(JSON.parse(m.data)) }
  stream.onerror = () => {
    stream.close()
    $('#stale').hidden = false
    $('#stale').textContent = 'live stream dropped — polling every 5s'
    setTimeout(poll, 5000)
  }
}
async function poll() {
  try {
    render(await fetch('/api/state').then((r) => r.json()))
  } catch (e) { /* still down */ }
  setTimeout(() => (navigator.onLine ? connect() : poll()), 5000)
}
fetch('/api/state').then((r) => r.json()).then(render).then(connect).catch(poll)
`
