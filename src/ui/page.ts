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
@media (max-width:900px){.step{grid-template-columns:1fr}.step .thumb{border-right:0;border-bottom:1px solid var(--line)}.step .thumb img{max-height:120px}}

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

/* ---------- steps: what the judge saw ---------- */
.steps{display:flex;flex-direction:column;gap:8px}
.step{display:grid;grid-template-columns:212px minmax(0,1fr);gap:0;background:var(--panel);border:1px solid var(--line);border-radius:7px;overflow:hidden}
.step.hit{border-color:#4a2e18}
.step .thumb{position:relative;background:#06080a;border-right:1px solid var(--line);cursor:zoom-in;min-height:118px}
.step .thumb img{display:block;width:100%;height:100%;max-height:150px;object-fit:cover;object-position:top}
.step .thumb .nopic{color:var(--dimmer);font-size:11px;padding:12px}
.step .thumb .ph{position:absolute;left:6px;top:6px;font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:1px 6px;border-radius:3px;background:rgba(11,13,15,.85);border:1px solid var(--line)}
.ph-explore{color:var(--dim)}.ph-mission{color:var(--accent)}.ph-form{color:var(--money)}.ph-rewalk{color:var(--auth)}
.step .body{padding:9px 12px;display:flex;flex-direction:column;gap:5px;min-width:0}
.step .l1{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
.step .who{color:#e8eef1}
.step .who .acct{color:var(--dimmer);font-size:11px;margin-left:6px}
.step .t{color:var(--dimmer);font-size:11px;white-space:nowrap}
.step .where{color:var(--tx);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.step .where .kind{font-size:10.5px;color:var(--dim);border:1px solid var(--line);padding:0 5px;border-radius:3px;margin-left:6px}
.step .act{color:var(--dim);font-size:12px}
.step .act b{color:var(--tx);font-weight:500}
.step .dec{color:var(--dim);font-size:12px}
.step .dec b{color:var(--accent);font-weight:500}
.step .same{color:var(--dimmer);font-size:11px}
.probs{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:2px}
.pr{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--dim)}
.pr .bar{width:64px}
.pr .bar i{background:var(--dim)}
.pr.hot .bar i{background:var(--loss)}
.pr.hot{color:var(--tx)}
.pr .pv{color:var(--dimmer);min-width:24px;text-align:right}
.verdicts{display:flex;flex-wrap:wrap;gap:6px}
.vd{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;padding:2px 7px;border-radius:3px;border:1px solid}
.step .l3{display:flex;justify-content:space-between;color:var(--dimmer);font-size:11px;margin-top:auto}
.morebtn{all:unset;cursor:pointer;color:var(--accent);font-size:12px;padding:10px 0;display:block}
.newpill{all:unset;cursor:pointer;position:sticky;top:0;z-index:2;display:block;text-align:center;background:var(--panel2);border:1px solid var(--accent-dim);color:var(--accent);border-radius:20px;padding:4px 12px;font-size:11.5px;margin:0 auto 8px;width:max-content}

/* judge strip on Now */
.judge{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:7px;overflow:hidden;margin-top:16px}
.latest{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;margin-top:8px}
.lt{background:var(--panel);border:1px solid var(--line);border-radius:6px;overflow:hidden;cursor:zoom-in}
.lt img{display:block;width:100%;height:96px;object-fit:cover;object-position:top;background:#06080a}
.lt .cap{padding:6px 8px;font-size:11px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lt .cap b{color:var(--tx);font-weight:500;display:block;overflow:hidden;text-overflow:ellipsis}

/* suspicions */
.sus{border:1px solid var(--line);border-radius:7px;background:var(--panel);margin-bottom:6px;overflow:hidden}
.sus>summary{padding:9px 12px;cursor:pointer;list-style:none;display:grid;grid-template-columns:96px 178px 1fr 70px 78px;gap:10px;align-items:center;font-size:12px}
.sus>summary::-webkit-details-marker{display:none}
.sus>summary:hover{background:var(--panel2)}
.st-pill{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;padding:2px 7px;border-radius:20px;border:1px solid;text-align:center}
.st-open{color:var(--warn);border-color:#4a3d1c}.st-confirmed{color:var(--ok);border-color:#1f4a2c}.st-unreproduced{color:var(--dimmer);border-color:var(--line)}.st-dismissed{color:var(--dimmer);border-color:var(--line)}
.sus .chk{color:var(--tx);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sus .ttl{color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sus .pp{text-align:right;color:var(--dim)}
.sus .tm{text-align:right;color:var(--dimmer);font-size:11px}
.sus .body{padding:4px 12px 12px;border-top:1px solid var(--line);font-size:12px;color:var(--dim)}
.sus .body .kv{display:grid;grid-template-columns:90px 1fr;gap:4px 10px;margin:8px 0}
.sus .body .kv span:nth-child(odd){color:var(--dimmer);text-transform:uppercase;letter-spacing:.08em;font-size:10.5px}
.trail{background:#0d1013;border:1px solid var(--line);border-radius:5px;padding:8px 11px;margin-top:8px}
.trail .tr{display:grid;grid-template-columns:20px 1fr 160px;gap:8px;padding:2px 0;color:var(--tx)}
.trail .tr .n{color:var(--dimmer)}.trail .tr .u{color:var(--dimmer);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.filters{display:flex;gap:6px;margin:0 0 10px}
.filters button{all:unset;cursor:pointer;font-size:11.5px;color:var(--dim);border:1px solid var(--line);padding:3px 9px;border-radius:20px}
.filters button[aria-pressed=true]{color:#e8eef1;border-color:var(--accent-dim);background:#0f1f1e}

/* modal */
.modal{position:fixed;inset:0;background:rgba(6,8,10,.86);display:none;z-index:9;overflow:auto;padding:28px}
.modal.on{display:block}
.modal .box{max-width:1180px;margin:0 auto;background:var(--panel);border:1px solid var(--line);border-radius:8px;display:grid;grid-template-columns:minmax(0,1.3fr) minmax(320px,1fr);overflow:hidden}
.modal .pic{background:#06080a;border-right:1px solid var(--line);display:flex;align-items:flex-start;justify-content:center}
.modal .pic img{display:block;max-width:100%}
.modal .info{padding:14px 16px;font-size:12px;overflow:auto;max-height:calc(100vh - 56px)}
.modal .info h3{margin:0 0 4px;font-size:13px;color:#e8eef1;font-weight:600}
.modal .info .sub2{color:var(--dimmer);margin-bottom:12px}
.modal .q{display:grid;grid-template-columns:1fr 100px 34px;gap:8px;align-items:center;padding:3px 0;border-bottom:1px solid rgba(30,36,41,.5);color:var(--dim)}
.modal .q.hot{color:var(--tx)}
.modal .q .bar{width:100px}.modal .q.hot .bar i{background:var(--loss)}
.modal .q .pv{text-align:right;color:var(--dimmer)}
.modal .close{all:unset;cursor:pointer;color:var(--dim);float:right;font-size:18px;line-height:1;padding:0 2px}
.modal .close:hover{color:#e8eef1}
.ops{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.op{font-size:11px;padding:2px 7px;border-radius:3px;border:1px solid var(--line);color:var(--dim)}
.op.pick{color:var(--accent);border-color:var(--accent-dim)}
.kv2{display:grid;grid-template-columns:110px 1fr;gap:3px 10px;margin:10px 0;color:var(--dim)}
.kv2 span:first-child{color:var(--dimmer);text-transform:uppercase;letter-spacing:.08em;font-size:10.5px}
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
    <button role="tab" aria-selected="false" data-v="steps">Steps <span class="n" id="n-steps">0</span></button>
    <button role="tab" aria-selected="false" data-v="suspicions">Suspicions <span class="n" id="n-sus">0</span></button>
    <button role="tab" aria-selected="false" data-v="findings">Findings <span class="n" id="n-find">0</span></button>
    <button role="tab" aria-selected="false" data-v="map">Map <span class="n" id="n-map">0</span></button>
    <button role="tab" aria-selected="false" data-v="accounts">Accounts <span class="n" id="n-acct">0</span></button>
    <button role="tab" aria-selected="false" data-v="log">Log <span class="n" id="n-log">0</span></button>
  </div>
  <div class="railfoot" id="foot"></div>
</nav>
<main class="main">
  <section class="view on" id="v-now"></section>
  <section class="view" id="v-steps"></section>
  <section class="view" id="v-suspicions"></section>
  <section class="view" id="v-findings"></section>
  <section class="view" id="v-map"></section>
  <section class="view" id="v-accounts"></section>
  <section class="view" id="v-log"></section>
</main>
<div class="stale" id="stale" hidden></div>
<div class="modal" id="modal"></div>
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
let susFilter = 'all'
let openSus = null
let lastState = null

document.querySelectorAll('.nav button').forEach((b) => b.addEventListener('click', () => {
  view = b.dataset.v
  document.querySelectorAll('.nav button').forEach((x) => x.setAttribute('aria-selected', String(x === b)))
  document.querySelectorAll('.view').forEach((x) => x.classList.toggle('on', x.id === 'v-' + view))
}))

function render(s) {
  lastState = s
  $('#n-steps').textContent = s.judge.steps
  $('#n-sus').textContent = s.judge.suspicions.open + s.judge.suspicions.confirmed
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
  // The filmstrip is not redrawn under the reader's cursor. New steps are
  // slid in at the top only while the view is at the top; otherwise a pill
  // counts them until it is clicked.
  if (view === 'steps' && $('#steps-list')) refreshSteps(s)
  else $('#v-steps').innerHTML = stepsView(s)
  $('#v-suspicions').innerHTML = suspicionsView(s)
  $('#v-findings').innerHTML = findings(s)
  $('#v-map').innerHTML = mapView(s)
  $('#v-accounts').innerHTML = accounts(s)
  $('#v-log').innerHTML = log(s)
  wireFindings()
  wireSteps()
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
    judgeStrip(s) +
    latest(s) +
    '<div class="grid2" style="margin-top:16px"><div>' +
      panel('Agents', s.workers.filter((w) => w.kind === 'explorer' || w.kind === 'crew').length + ' active',
        s.workers.filter((w) => w.kind === 'explorer' || w.kind === 'crew').map(exCard).join('') || '<div class="empty">no agent has started yet</div>') +
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

function judgeStrip(s) {
  const j = s.judge
  const perMin = s.app.uptimeMs > 0 ? (j.steps / (s.app.uptimeMs / 60000)).toFixed(1) : '0'
  return '<h2 style="margin-top:22px">Judge <span class="sub">one Jev request per step: the choice of the next action and the contract on the last</span></h2>' +
    '<div class="judge" style="margin-top:0">' +
      counter('Screens judged', j.steps, perMin + ' / min') +
      counter('Fired', j.withVerdict, 'screens with a verdict') +
      counter('Suspicions', j.suspicions.open, 'open') +
      counter('Confirmed', j.suspicions.confirmed, j.suspicions.unreproduced + ' did not hold') +
      counter('Rewalks', j.rewalks) +
      counter('Jev latency', j.medianMs + '<small>ms</small>', 'median') +
      counter('Jev spend', '$' + j.usd.toFixed(3), (j.tokens / 1000).toFixed(0) + 'k tokens') +
    '</div>'
}

function latest(s) {
  const hits = s.steps.filter((x) => x.verdicts.length).slice(0, 6)
  if (!hits.length) return ''
  return '<h2 style="margin-top:22px">Latest verdicts <span class="sub">suspicions, not findings — each one is walked again in a fresh account before it counts</span></h2>' +
    '<div class="latest">' + hits.map((x) =>
      '<div class="lt" data-step="' + x.id + '">' + (x.shot ? '<img src="/shots/' + x.shot + '" alt="">' : '<div style="height:96px"></div>') +
      '<div class="cap"><b>' + esc(x.verdicts[0].check) + (x.verdicts[0].p < 1 ? ' ' + Math.round(x.verdicts[0].p * 100) + '%' : '') + '</b>' + esc(x.path) + '</div></div>').join('') + '</div>'
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

const VK = { fault: 'fault', wrong: 'wrong', 'data-loss': 'loss', auth: 'auth', leak: 'leak', money: 'money', race: 'race' }
const vdBadge = (v) => '<span class="vd cat ' + (VK[v.kind] || 'wrong') + '">' + esc(v.check.replace('screen.', '')) + (v.p < 1 ? ' ' + Math.round(v.p * 100) + '%' : '') + '</span>'
const pr = (k, p) => '<span class="pr' + (p >= 0.85 ? ' hot' : '') + '"><span>' + esc(k.replace('screen.', '')) + '</span>' +
  '<span class="bar"><i style="width:' + Math.round(p * 100) + '%"></i></span><span class="pv">' + Math.round(p * 100) + '</span></span>'

function stepsView(s) {
  if (!s.steps.length) return '<h2>Steps</h2><div class="empty">Nothing judged yet. Every screen an agent lands on will appear here with what Jev answered about it.</div>'
  return '<h2>Steps <span class="sub">every screen, newest first — the action that led there, what Jev was asked, what it answered, what code made of it</span></h2>' +
    '<div class="steps" id="steps-list">' + s.steps.map(stepCard).join('') + '</div>' +
    '<button class="morebtn" id="more-steps">earlier steps…</button>'
}

let pendingSteps = []
function refreshSteps(s) {
  const list = $('#steps-list')
  const top = list.firstElementChild ? Number(list.firstElementChild.dataset.step) : 0
  const fresh = s.steps.filter((x) => x.id > top && !pendingSteps.some((p) => p.id === x.id))
  pendingSteps = fresh.concat(pendingSteps)
  const main = document.querySelector('.main')
  if (!pendingSteps.length) return
  if (main.scrollTop < 60 && !$('#modal').classList.contains('on')) flushSteps()
  else {
    let pill = $('#newsteps')
    if (!pill) {
      pill = document.createElement('button')
      pill.id = 'newsteps'
      pill.className = 'newpill'
      pill.addEventListener('click', () => { flushSteps(); main.scrollTo({ top: 0 }) })
      list.parentElement.insertBefore(pill, list)
    }
    pill.textContent = pendingSteps.length + ' new step' + (pendingSteps.length === 1 ? '' : 's') + ' ↑'
  }
}
function flushSteps() {
  const list = $('#steps-list')
  if (!list) return
  const html = pendingSteps.sort((a, b) => b.id - a.id).map(stepCard).join('')
  pendingSteps = []
  list.insertAdjacentHTML('afterbegin', html)
  const pill = $('#newsteps')
  if (pill) pill.remove()
  wireSteps()
}

function stepCard(x) {
  const dec = x.decision
  const decLine = dec
    ? (dec.operation === 'DONE' || dec.operation === 'BLOCKED' || dec.operation === 'WAIT'
        ? 'Jev: <b>' + esc(dec.operation) + '</b> ' + Math.round(dec.confidence * 100) + '%'
        : 'Jev: <b>' + esc(dec.operation) + '</b> → ' + (dec.target ? esc(dec.target.role) + ' "' + esc(dec.target.name) + '"' : '?') +
          (dec.option ? ' = ' + esc(dec.option) : '') + ' <span class="pv">' + Math.round((dec.targetConfidence == null ? dec.confidence : dec.targetConfidence) * 100) + '%</span>')
    : x.phase === 'explore' ? 'code picked the next untried link' : x.phase === 'rewalk' ? 'walked again in a fresh account' + (x.rewalkOf ? ' for suspicion #' + x.rewalkOf : '') : ''
  return '<div class="step' + (x.verdicts.length ? ' hit' : '') + '" data-step="' + x.id + '">' +
    '<div class="thumb">' + (x.shot ? '<img loading="lazy" src="/shots/' + x.shot + '" alt="">' : '<div class="nopic">no picture</div>') +
      '<span class="ph ph-' + esc(x.phase) + '">' + esc(x.phase) + '</span></div>' +
    '<div class="body">' +
      '<div class="l1"><span class="who">' + esc(x.worker) + (x.account ? '<span class="acct">' + esc(x.account) + '</span>' : '') + '</span><span class="t">' + clock(x.at) + '</span></div>' +
      '<div class="where">' + esc(x.path) + (x.kind ? '<span class="kind">' + esc(x.kind) + '</span>' : '') + '</div>' +
      '<div class="act">← <b>' + esc(x.action) + '</b>' + (x.changed ? '' : ' <span class="same">· screen unchanged</span>') + '</div>' +
      (decLine ? '<div class="dec">' + decLine + '</div>' : '') +
      '<div class="probs">' + x.top.map(([k, p]) => pr(k, p)).join('') + '</div>' +
      (x.verdicts.length ? '<div class="verdicts">' + x.verdicts.map(vdBadge).join('') + '</div>' : '') +
      '<div class="l3"><span>' + (x.goal ? esc(x.goal.slice(0, 90)) : '') + '</span><span>' + (x.cached ? 'cached' : (x.tokens / 1000).toFixed(1) + 'k tok · ' + x.ms + 'ms') + '</span></div>' +
    '</div></div>'
}

function suspicionsView(s) {
  const all = s.suspicions
  const counts = { all: all.length, open: 0, confirmed: 0, unreproduced: 0 }
  all.forEach((x) => { if (counts[x.state] != null) counts[x.state]++ })
  const rows = all.filter((x) => susFilter === 'all' || x.state === susFilter)
  return '<h2>Suspicions <span class="sub">what looked wrong. Open ones are being walked again; only what holds every time becomes a finding</span></h2>' +
    '<div class="filters">' + ['all', 'open', 'confirmed', 'unreproduced'].map((f) =>
      '<button data-sf="' + f + '" aria-pressed="' + (susFilter === f) + '">' + f + ' ' + counts[f] + '</button>').join('') + '</div>' +
    (rows.length ? rows.map(susCard).join('') : '<div class="empty">nothing here</div>')
}

function susCard(x) {
  return '<details class="sus" data-sus="' + x.id + '"' + (openSus === x.id ? ' open' : '') + '><summary>' +
    '<span class="st-pill st-' + esc(x.state) + '">' + esc(x.state) + (x.retries ? ' ·' + x.retries : '') + '</span>' +
    '<span class="chk">' + esc(x.check) + '</span>' +
    '<span class="ttl">' + esc(x.title) + '</span>' +
    '<span class="pp">' + (x.p == null ? esc(x.source) : x.p >= 1 ? 'code' : Math.round(x.p * 100) + '%') + '</span>' +
    '<span class="tm">' + hhmm(x.at) + '</span></summary>' +
    '<div class="body"><div class="kv">' +
      '<span>expected</span><span>' + esc(x.expected) + '</span>' +
      '<span>observed</span><span>' + esc(x.observed) + '</span>' +
      '<span>screen</span><span>' + esc(x.screen || '—') + '</span>' +
      '<span>by</span><span>' + esc(x.worker) + (x.recording ? ' · recording #' + x.recording : '') + '</span>' +
    '</div>' +
    (x.trail.length ? '<div class="trail">' + x.trail.map((t, i) =>
      '<div class="tr"><span class="n">' + (i + 1) + '</span><span>' + esc(trailStep(t)) + '</span><span class="u">' + esc(t.url) + '</span></div>').join('') + '</div>' : '') +
    '</div></details>'
}

function trailStep(t) {
  if (t.op === 'goto') return 'open ' + t.path
  if (t.op === 'click') return 'click ' + t.role + ' "' + t.name + '"'
  if (t.op === 'type') return 'type "' + (t.text.length > 40 ? t.text.slice(0, 37) + '…' : t.text) + '" into "' + t.name + '"'
  if (t.op === 'select') return 'choose "' + t.value + '" in "' + t.name + '"'
  if (t.op === 'press') return 'press ' + t.key
  return t.op
}

async function openStep(id) {
  const m = $('#modal')
  m.classList.add('on')
  m.innerHTML = '<div class="box"><div class="pic"></div><div class="info">loading…</div></div>'
  let x
  try { x = await fetch('/api/step/' + id).then((r) => r.json()) } catch (e) { m.querySelector('.info').textContent = 'could not load'; return }
  const nouls = Object.entries(x.answers).filter(([, v]) => typeof v === 'number').sort((a, b) => b[1] - a[1])
  const d = x.decisionFull
  m.innerHTML = '<div class="box"><div class="pic">' + (x.shot ? '<img src="/shots/' + x.shot + '" alt="">' : '<div class="empty">no picture</div>') + '</div>' +
    '<div class="info"><button class="close" id="mclose">×</button>' +
    '<h3>' + esc(x.path) + (x.kind ? ' <span class="tag">' + esc(x.kind) + '</span>' : '') + '</h3>' +
    '<div class="sub2">' + esc(x.worker) + ' · ' + esc(x.phase) + ' · ' + clock(x.at) + (x.account ? ' · ' + esc(x.account) : '') + '</div>' +
    '<div class="kv2"><span>action</span><span>' + esc(x.action) + (x.changed ? '' : ' (screen unchanged)') + '</span>' +
    (x.goal ? '<span>goal</span><span>' + esc(x.goal) + '</span>' : '') +
    (Object.keys(x.entered || {}).length ? '<span>entered</span><span>' + esc(Object.entries(x.entered).map(([k, v]) => k + ' = ' + v).join(' · ')) + '</span>' : '') +
    '<span>cost</span><span>' + (x.cached ? 'cached' : x.tokens + ' tokens · ' + x.ms + ' ms · $' + (x.tokens * 0.042 / 1e6).toFixed(5)) + '</span></div>' +
    (x.verdicts.length ? '<div class="verdicts" style="margin:6px 0 10px">' + x.verdicts.map(vdBadge).join('') + '</div>' : '') +
    (d ? '<h3 style="margin-top:12px">Jev chose</h3><div class="ops">' + Object.entries(d.operations).sort((a, b) => b[1] - a[1]).map(([k, p]) =>
        '<span class="op' + (k === d.operation ? ' pick' : '') + '">' + esc(k) + ' ' + Math.round(p * 100) + '%</span>').join('') + '</div>' +
      (d.target ? '<div class="kv2"><span>target</span><span>' + esc(d.target.role) + ' "' + esc(d.target.name) + '"' + (d.option ? ' = ' + esc(d.option) : '') + ' · ' + Math.round((d.targetConfidence == null ? d.confidence : d.targetConfidence) * 100) + '% confident</span></div>' : '') : '') +
    '<h3 style="margin-top:12px">The contract <span class="sub">' + nouls.length + ' questions, one request</span></h3>' +
    nouls.map(([k, p]) => '<div class="q' + (p >= 0.85 ? ' hot' : '') + '"><span>' + esc(k) + '</span><span class="bar"><i style="width:' + Math.round(p * 100) + '%"></i></span><span class="pv">' + Math.round(p * 100) + '</span></div>').join('') +
    '</div></div>'
  $('#mclose').addEventListener('click', () => m.classList.remove('on'))
}

// Handlers are assigned, not added: this runs after every redraw, and a
// listener added each time is a click that fires n times on the nth redraw.
let loadingMore = false
function wireSteps() {
  document.querySelectorAll('[data-step]').forEach((el) => (el.onclick = (ev) => {
    if (ev.target.closest('.thumb') || el.classList.contains('lt')) openStep(Number(el.dataset.step))
  }))
  document.querySelectorAll('[data-sf]').forEach((b) => (b.onclick = () => { susFilter = b.dataset.sf; if (lastState) $('#v-suspicions').innerHTML = suspicionsView(lastState); wireSteps() }))
  document.querySelectorAll('details.sus').forEach((d) => (d.ontoggle = () => { openSus = d.open ? Number(d.dataset.sus) : null }))
  const more = $('#more-steps')
  if (more) more.onclick = async () => {
    if (loadingMore) return
    loadingMore = true
    const list = $('#steps-list')
    const last = list.lastElementChild
    const before = last ? Number(last.dataset.step) : 0
    more.textContent = 'loading…'
    const rows = await fetch('/api/steps?before=' + before + '&limit=60').then((r) => r.json()).catch(() => [])
    rows.forEach((x) => list.insertAdjacentHTML('beforeend', stepCard(x)))
    more.textContent = rows.length ? 'earlier steps…' : 'that is all of them'
    loadingMore = false
    wireSteps()
  }
}
$('#modal').addEventListener('click', (ev) => { if (ev.target === $('#modal')) $('#modal').classList.remove('on') })
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') $('#modal').classList.remove('on') })

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
