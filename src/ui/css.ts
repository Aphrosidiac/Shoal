/**
 * The ANK Ops language, measured from a reference back office on
 * 2026-09-18 and carried here value for value: one warm ground shared by
 * rail, head and page with no borders; white cards with a hairline AND a
 * soft lift; the primary action is charcoal; the green is for the active
 * nav item and the one obvious next step on a page, and it carries ink,
 * never white; status is a tinted chip with regular-weight text; table
 * headers are sentence-case grey; Inter 14/20.
 *
 * Hand-rolled CSS rather than the Vue components, because this page has no
 * build step and must start at 2am on somebody else's machine.
 */
export const CSS = String.raw`
:root{
  --font:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  --ink-900:#1a1a1a;--ink-800:#2b2b2b;--ink-700:#424242;--ink-600:#5c5c5c;--ink-500:#767676;--ink-400:#9a9a9a;--ink-300:#bdbdbd;
  --line-200:#e3e1df;--line-100:#efedeb;
  --ground:#f6f4f3;--card:#ffffff;--sand:#e9e7e6;
  --green-700:#2f7a2b;--green-600:#3d8f39;--green-500:#76c66e;--green-400:#7dd56f;--green-100:#cdeec5;--green-50:#eef5e9;
  --steel-600:#4b6fd3;--steel-400:#6887db;--steel-50:#eaeffb;
  --success-600:#2f7a2b;--success-50:#eef5e9;--success-200:#cfe6c8;
  --warning-600:#a86a1c;--warning-50:#f9f2e1;--warning-500:#e6a24c;
  --info-600:#3557b8;--info-50:#eaeffb;
  --violet-600:#6a48c9;--violet-50:#f1edfd;
  --danger-600:#c9553f;--danger-700:#a8432f;--danger-50:#f9ebe7;--danger-500:#d15c49;
  --callout-blue:#eaf0fe;--callout-green:#e1f0dd;--callout-amber:#fbf3df;--callout-red:#f9ebe7;--muted:#f0efed;
  --r-xs:6px;--r-sm:10px;--r-md:16px;--r-lg:18px;
  --sh-sm:0 1px 2px rgb(0 0 0/.04),0 4px 14px rgb(0 0 0/.045);
  --sh-md:0 4px 16px rgb(0 0 0/.06),0 1px 3px rgb(0 0 0/.04);
  --sh-lg:0 24px 48px rgb(0 0 0/.12),0 2px 6px rgb(0 0 0/.06);
  --ease:cubic-bezier(.2,.8,.2,1);
}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
html,body,*{scrollbar-width:none}*::-webkit-scrollbar{width:0;height:0;display:none}
body{background:var(--ground);color:var(--ink-800);font:14px/1.4286 var(--font);-webkit-font-smoothing:antialiased;font-feature-settings:"cv11","ss01";
  display:grid;grid-template-columns:240px minmax(0,1fr);height:100vh;overflow:hidden}
h1,h2,h3,h4{color:var(--ink-900);font-weight:600;letter-spacing:-.015em;margin:0}
a{color:var(--green-700);text-decoration:none}
button{font:inherit}
:focus-visible{outline:2px solid var(--ink-900);outline-offset:2px;border-radius:6px}
.num{font-variant-numeric:tabular-nums}
.mono{font-family:var(--mono);font-size:12.5px}
.hide{display:none!important}

/* ---------- rail ---------- */
.rail{display:flex;flex-direction:column;padding:18px 16px 14px;overflow:auto}
.brand{display:flex;align-items:center;gap:10px;padding:2px 8px 14px}
.brand .mark{width:32px;height:32px;border-radius:10px;background:var(--ink-700);display:grid;place-items:center}
.brand b{font-size:17px;font-weight:600;color:var(--ink-900);letter-spacing:-.01em}
.brand span{color:var(--ink-500);font-weight:400}
.group{margin-top:14px}
.group .lbl{font-size:12px;line-height:16px;color:var(--ink-500);padding:0 12px 6px}
.nav{display:flex;flex-direction:column;gap:2px}
.nav a{display:flex;align-items:center;gap:10px;height:36px;padding:0 12px;border-radius:var(--r-sm);color:var(--ink-800);font-weight:500;font-size:14px;
  transition:background-color 120ms var(--ease),color 120ms var(--ease)}
.nav a:hover{background:var(--sand)}
.nav a[aria-current=page]{background:var(--green-400);color:var(--ink-900)}
.nav a svg{width:18px;height:18px;flex:none;color:var(--ink-600)}
.nav a[aria-current=page] svg{color:var(--ink-900)}
.nav a .cnt{margin-left:auto}
.railfoot{margin-top:auto;padding:14px 6px 0;font-size:12px;color:var(--ink-500);display:flex;flex-direction:column;gap:5px}
.railfoot b{color:var(--ink-800);font-weight:500}
.railfoot .kv{display:flex;justify-content:space-between;gap:8px}
.railfoot .kv span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px}

/* ---------- main + head ---------- */
.main{display:flex;flex-direction:column;min-width:0;overflow:hidden}
.head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:22px 28px 14px;flex:none}
.head h1{font-size:22px;line-height:28px;letter-spacing:-.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.head .sub{font-size:12px;line-height:16px;color:var(--ink-500);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.head .acts{display:flex;align-items:center;gap:8px;flex:none}
.content{flex:1;overflow:auto;padding:4px 28px 40px;min-width:0}
.stack{display:flex;flex-direction:column;gap:16px}
.grid{display:grid;grid-template-columns:minmax(0,1fr);gap:16px}
@media(min-width:1180px){.grid.two{grid-template-columns:minmax(0,1.6fr) minmax(320px,1fr)}.grid.half{grid-template-columns:1fr 1fr}}
.col{display:flex;flex-direction:column;gap:16px;min-width:0}

/* ---------- primitives ---------- */
.card{background:var(--card);border:1px solid var(--line-100);border-radius:var(--r-md);box-shadow:var(--sh-sm);min-width:0;overflow:hidden}
.card.green{background:var(--callout-green);border-color:#cfe6c8;box-shadow:none}
.card.muted{background:var(--muted);border-color:transparent;box-shadow:none}
.card.dark{background:var(--ink-700);color:#fff;border-color:transparent}
.card>.hd{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px 4px}
.card>.hd.flush{padding-bottom:12px}
.card>.hd .t{display:flex;align-items:center;gap:10px;min-width:0;flex:1}
.card>.hd .t .tt{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;min-width:0}
.card>.hd h3{font-size:15px;line-height:24px;font-weight:600;white-space:nowrap}
.card>.hd .s{font-size:13px;line-height:18px;color:var(--ink-500);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.card>.hd .a{display:flex;gap:8px;flex:none;align-items:center}
.card>.bd{padding:12px 20px 20px}
.card>.bd.flush{padding:0}
.card>.ft{border-top:1px solid var(--line-100);background:var(--ground);padding:14px 20px;font-size:13px;color:var(--ink-600)}
.card.dark .s,.card.dark h3{color:#fff}
.ibox{width:32px;height:32px;border-radius:10px;background:#515056;color:#fff;display:grid;place-items:center;flex:none}
.ibox svg{width:16px;height:16px}
.ibox.sm{width:28px;height:28px;border-radius:9px}.ibox.sm svg{width:14px;height:14px}
.ibox.blue{background:var(--steel-600)}.ibox.green{background:var(--green-600)}.ibox.red{background:var(--danger-600)}.ibox.amber{background:var(--warning-500);color:var(--ink-900)}.ibox.grey{background:var(--sand);color:var(--ink-700)}

.cnt{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:var(--r-xs);font-size:12px;font-weight:500;background:var(--sand);color:var(--ink-600)}
.cnt.red{background:var(--danger-50);color:var(--danger-600)}.cnt.green{background:var(--success-50);color:var(--success-600)}.cnt.amber{background:var(--warning-50);color:var(--warning-600)}

.chip{display:inline-flex;align-items:center;gap:4px;white-space:nowrap;border-radius:999px;height:22px;padding:0 8px;font-size:12px;font-weight:500;background:#f0f0ee;color:var(--ink-600)}
.chip.sm{height:18px;padding:0 6px;font-size:11px}
.chip.green{background:var(--success-50);color:var(--success-600)}.chip.amber{background:var(--warning-50);color:var(--warning-600)}
.chip.red{background:var(--danger-50);color:var(--danger-600)}.chip.blue{background:var(--info-50);color:var(--info-600)}
.chip.violet{background:var(--violet-50);color:var(--violet-600)}.chip.dark{background:var(--ink-700);color:#fff}
.chip.outline{background:var(--card);border:1px solid var(--line-200)}

.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;font-weight:500;cursor:pointer;border:0;height:36px;border-radius:var(--r-sm);padding:0 14px;font-size:14px;
  transition:background-color 120ms var(--ease),border-color 120ms var(--ease),color 120ms var(--ease),transform 120ms var(--ease)}
.btn:active{transform:scale(.97)}
.btn:disabled{opacity:.4;cursor:not-allowed;transform:none}
.btn.primary{background:var(--ink-700);color:#fff}.btn.primary:hover{background:var(--ink-800)}
.btn.secondary{background:var(--card);color:var(--ink-800);border:1px solid var(--line-200)}.btn.secondary:hover{background:var(--ground)}
.btn.accent{background:var(--green-400);color:var(--ink-900)}.btn.accent:hover{background:var(--green-500)}
.btn.ghost{background:transparent;color:var(--ink-600)}.btn.ghost:hover{background:var(--sand);color:var(--ink-900)}
.btn.danger-ghost{background:var(--card);color:var(--danger-600);border:1px solid var(--line-200)}.btn.danger-ghost:hover{background:var(--danger-50)}
.btn.sm{height:30px;padding:0 10px;font-size:13px;border-radius:9px}
.btn.lg{height:44px;padding:0 18px;font-size:15px;border-radius:12px}
.btn svg{width:16px;height:16px}

.field{width:100%;height:36px;border-radius:var(--r-sm);border:1px solid var(--line-200);background:var(--card);padding:0 12px;font:inherit;font-size:14px;color:var(--ink-800);transition:border-color 120ms var(--ease),box-shadow 120ms var(--ease)}
.field::placeholder{color:var(--ink-400)}
.field:focus{outline:none;border-color:var(--ink-400);box-shadow:0 0 0 3px rgb(0 0 0/.05)}
label.f{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--ink-600);min-width:0}
label.f b{font-weight:500;color:var(--ink-700)}
.hint{font-size:12px;color:var(--ink-500);line-height:16px}

.eyebrow{font-size:12px;line-height:16px;font-weight:500;color:var(--ink-500);white-space:nowrap}
table{width:100%;border-collapse:collapse;font-size:14px}
th{text-align:left;padding:10px 20px;border-bottom:1px solid var(--line-100);font-size:12px;line-height:16px;font-weight:500;color:var(--ink-500);white-space:nowrap}
td{padding:11px 20px;border-bottom:1px solid var(--line-100);vertical-align:middle}
tr:last-child td{border-bottom:0}
tbody tr:hover td{background:#faf9f8}
td.r,th.r{text-align:right}
td.dim{color:var(--ink-500)}

.tabs{display:inline-flex;align-items:center;gap:2px;background:var(--sand);border-radius:11px;padding:3px;max-width:100%;overflow-x:auto}
.tabs button{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:8px;font-size:13px;font-weight:500;color:var(--ink-600);white-space:nowrap;transition:color 160ms}
.tabs button:hover{color:var(--ink-900)}
.tabs button[aria-selected=true]{background:var(--card);color:var(--ink-900);box-shadow:0 1px 2px rgb(0 0 0/.06),0 1px 1px rgb(0 0 0/.03)}
.filters{display:flex;flex-wrap:wrap;gap:6px}
.filters button{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:999px;font-size:13px;font-weight:500;color:var(--ink-600);background:var(--card);border:1px solid var(--line-200);transition:all 160ms var(--ease)}
.filters button:hover{border-color:var(--ink-300);color:var(--ink-900)}
.filters button[aria-pressed=true]{background:var(--ink-700);border-color:var(--ink-700);color:#fff}
.filters button[aria-pressed=true] .cnt{background:rgb(255 255 255/.18);color:#fff}
.toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}

.kpis{display:grid;grid-template-columns:1fr 1fr}
@media(min-width:1180px){.kpis{grid-template-columns:repeat(4,1fr)}.kpis.five{grid-template-columns:repeat(5,1fr)}}
.kpi{display:flex;align-items:center;gap:12px;padding:16px 20px;min-width:0;border-right:1px solid var(--line-100);border-bottom:1px solid var(--line-100)}
@media(min-width:1180px){.kpi{border-bottom:0}.kpi:last-child{border-right:0}}
@media(max-width:1179px){.kpi:nth-child(even){border-right:0}.kpi:nth-last-child(-n+2){border-bottom:0}}
.kpi .l{font-size:13px;line-height:18px;color:var(--ink-500)}
.kpi .v{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px}
.kpi .v b{font-size:22px;line-height:28px;font-weight:600;letter-spacing:-.02em;color:var(--ink-900);white-space:nowrap}
.kpi .v small{font-size:13px;color:var(--ink-500)}
.kpi .s{font-size:12px;line-height:16px;color:var(--ink-500);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

.meter{display:flex;flex-direction:column;gap:6px;padding:4px 0}
.meter .l{display:flex;justify-content:space-between;gap:12px;font-size:13px;line-height:18px}
.meter .l span:first-child{color:var(--ink-600);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.meter .l b{font-weight:500;color:var(--ink-900);flex:none}
.track{position:relative;height:6px;border-radius:999px;background:#efefeb;overflow:hidden;width:100%}
.track i{display:block;height:100%;border-radius:999px;background:var(--green-500);transition:width 400ms var(--ease)}
.track.blue i{background:var(--steel-400)}.track.amber i{background:var(--warning-500)}.track.red i{background:var(--danger-500)}.track.grey i{background:var(--ink-300)}
.track.bare{width:88px;display:inline-block;vertical-align:middle}

.rows>.row{display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid var(--line-100);min-width:0}
.rows>.row:last-child{border-bottom:0}
.rows>.row.link{cursor:pointer}.rows>.row.link:hover{background:#faf9f8}
.row .tx{min-width:0;flex:1}
.row .tx b{display:block;font-weight:500;color:var(--ink-900);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .tx span{display:block;font-size:13px;line-height:18px;color:var(--ink-500);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .end{flex:none;display:flex;align-items:center;gap:8px}
.row .chev{color:var(--ink-400);flex:none}
.avatar{width:32px;height:32px;border-radius:999px;display:grid;place-items:center;color:#fff;font-size:12px;font-weight:600;flex:none}
.step-n{width:28px;height:28px;border-radius:999px;border:1px solid var(--line-200);display:grid;place-items:center;font-size:13px;font-weight:500;color:var(--ink-500);flex:none;background:var(--card)}
.step-n.done{background:var(--green-400);border-color:var(--green-400);color:var(--ink-900)}

.callout{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-radius:var(--r-md);font-size:13px;line-height:18px;color:var(--ink-800)}
.callout.blue{background:var(--callout-blue)}.callout.green{background:var(--callout-green)}.callout.amber{background:var(--callout-amber)}.callout.red{background:var(--callout-red)}.callout.grey{background:var(--muted)}
.callout b{font-weight:600}

.empty{display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px;padding:36px 20px;color:var(--ink-500);font-size:13px}
.empty .ibox{background:var(--sand);color:var(--ink-600);width:40px;height:40px;border-radius:12px}
.empty b{font-size:14px;color:var(--ink-900);font-weight:600}

/* ---------- two-pane ---------- */
.pane{display:grid;grid-template-columns:minmax(0,1fr);min-height:420px}
@media(min-width:1000px){.pane{grid-template-columns:minmax(300px,.85fr) minmax(0,1.4fr)}.pane>.list{border-right:1px solid var(--line-100)}}
.pane>.list{overflow:auto;max-height:calc(100vh - 230px)}
.pane>.detail{overflow:auto;max-height:calc(100vh - 230px);padding:20px 24px}
.item{display:flex;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line-100);cursor:pointer;min-width:0}
.item:hover{background:#faf9f8}
.item[aria-selected=true]{background:var(--ground)}
.item .tx{min-width:0;flex:1}
.item .tx b{display:block;font-weight:500;color:var(--ink-900);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}
.item .tx .m{display:flex;gap:6px;align-items:center;margin-top:5px;flex-wrap:wrap}
.item .tx .w{font-size:12.5px;color:var(--ink-500);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--mono)}
.item .t{font-size:12px;color:var(--ink-500);flex:none;white-space:nowrap}
.dhead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:6px}
.dhead h3{font-size:17px;line-height:24px}
.dmeta{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 14px}
.dp{color:var(--ink-600);line-height:1.6;max-width:72ch;margin:0 0 14px;white-space:pre-line}
.section{font-size:12px;line-height:16px;font-weight:500;color:var(--ink-500);margin:18px 0 8px}
.steps{border:1px solid var(--line-100);border-radius:12px;overflow:hidden}
.steps .st{display:grid;grid-template-columns:28px 1fr auto;gap:10px;align-items:center;padding:9px 12px;border-bottom:1px solid var(--line-100);font-size:13px}
.steps .st:last-child{border-bottom:0}
.steps .st .n{width:22px;height:22px;border-radius:999px;background:var(--sand);display:grid;place-items:center;font-size:11px;color:var(--ink-600)}
.steps .st .w{color:var(--ink-500);font-family:var(--mono);font-size:12px;white-space:nowrap}
.steps .st .note{grid-column:2/4;color:var(--danger-600);font-size:12.5px}
.kv{display:grid;grid-template-columns:120px 1fr;gap:6px 12px;font-size:13px;margin:8px 0}
.kv span:nth-child(odd){color:var(--ink-500)}
.kv span:nth-child(even){color:var(--ink-800);word-break:break-word}
.evidence{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
.evidence a{display:block;border:1px solid var(--line-100);border-radius:12px;overflow:hidden;background:#fff;box-shadow:var(--sh-sm)}
.evidence img{display:block;width:100%;height:120px;object-fit:cover;object-position:top}
.evidence .cap{padding:6px 10px;font-size:12px;color:var(--ink-500)}

/* ---------- live filmstrip ---------- */
.film{display:flex;flex-direction:column;gap:12px}
.frame{display:grid;grid-template-columns:240px minmax(0,1fr);background:var(--card);border:1px solid var(--line-100);border-radius:var(--r-md);box-shadow:var(--sh-sm);overflow:hidden}
.frame.hit{border-color:#f3c9bf}
@media(max-width:820px){.frame{grid-template-columns:1fr}}
.frame .shot{position:relative;background:var(--ground);border-right:1px solid var(--line-100);cursor:zoom-in;min-height:150px}
@media(max-width:820px){.frame .shot{border-right:0;border-bottom:1px solid var(--line-100)}}
.frame .shot img{display:block;width:100%;height:100%;max-height:170px;object-fit:cover;object-position:top}
.frame .shot .ph{position:absolute;left:10px;top:10px}
.frame .shot .none{display:grid;place-items:center;height:150px;color:var(--ink-400);font-size:12px}
.frame .fb{padding:14px 18px;display:flex;flex-direction:column;gap:6px;min-width:0}
.frame .l1{display:flex;justify-content:space-between;gap:10px;align-items:center}
.frame .l1 .who{display:flex;align-items:center;gap:8px;min-width:0}
.frame .l1 .who b{font-weight:500;color:var(--ink-900)}
.frame .l1 .who span{font-size:12px;color:var(--ink-500);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.frame .l1 .t{font-size:12px;color:var(--ink-500);white-space:nowrap}
.frame .where{font-family:var(--mono);font-size:13px;color:var(--ink-900);display:flex;align-items:center;gap:8px;min-width:0}
.frame .where span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.frame .act{font-size:13px;color:var(--ink-600)}.frame .act b{font-weight:500;color:var(--ink-800)}
.frame .dec{font-size:13px;color:var(--ink-600);display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.frame .probs{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:2px 20px;margin-top:4px}
.frame .pr{display:grid;grid-template-columns:1fr 60px 28px;gap:8px;align-items:center;font-size:12px;color:var(--ink-500)}
.frame .pr span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.frame .pr .track{height:5px}.frame .pr .track i{background:var(--ink-300)}
.frame .pr.hot{color:var(--ink-900)}.frame .pr.hot .track i{background:var(--danger-500)}
.frame .pr .pv{text-align:right;font-variant-numeric:tabular-nums}
.frame .l3{display:flex;justify-content:space-between;gap:10px;font-size:12px;color:var(--ink-500);margin-top:auto;padding-top:4px}
.frame .l3 span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.newpill{position:sticky;top:0;z-index:2;align-self:center}

/* ---------- drawer + modal ---------- */
.veil{position:fixed;inset:0;background:rgb(26 26 26/.28);z-index:20;display:none}
.veil.on{display:block}
.drawer{position:fixed;top:12px;right:12px;bottom:12px;width:min(920px,calc(100vw - 24px));background:var(--card);border-radius:var(--r-lg);box-shadow:var(--sh-lg);z-index:21;display:none;grid-template-rows:auto 1fr;overflow:hidden}
.drawer.on{display:grid}
.drawer .dh{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;border-bottom:1px solid var(--line-100)}
.drawer .dh h3{font-size:15px}
.drawer .db{overflow:auto;padding:20px}
.drawer .split{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(300px,.85fr);gap:20px}
@media(max-width:900px){.drawer .split{grid-template-columns:1fr}}
.drawer .pic{border:1px solid var(--line-100);border-radius:12px;overflow:hidden;background:var(--ground)}
.drawer .pic img{display:block;width:100%}
.q{display:grid;grid-template-columns:1fr 110px 30px;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line-100);font-size:13px;color:var(--ink-600)}
.q.hot{color:var(--ink-900);font-weight:500}.q.hot .track i{background:var(--danger-500)}
.q .pv{text-align:right;color:var(--ink-500);font-variant-numeric:tabular-nums}
.ops{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 10px}
.modal{position:fixed;inset:0;z-index:31;display:none;place-items:center;padding:20px}
.modal.on{display:grid}
.modal .box{background:var(--card);border-radius:var(--r-md);box-shadow:var(--sh-lg);width:min(560px,100%);padding:22px 24px}
.modal .box h3{font-size:17px;margin-bottom:4px}
.modal .box .p{color:var(--ink-500);font-size:13px;margin:0 0 16px}
.form{display:grid;gap:14px}
.form .two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.form .end{display:flex;justify-content:flex-end;gap:8px;margin-top:6px}
.err{color:var(--danger-600);font-size:13px}
.x{all:unset;cursor:pointer;width:30px;height:30px;border-radius:8px;display:grid;place-items:center;color:var(--ink-500)}.x:hover{background:var(--sand);color:var(--ink-900)}
.stale{position:fixed;right:16px;bottom:14px;background:var(--callout-amber);color:var(--warning-600);border-radius:10px;padding:8px 12px;font-size:12.5px;z-index:5}
.log .l{display:grid;grid-template-columns:70px 110px 1fr;gap:12px;padding:9px 20px;border-bottom:1px solid var(--line-100);font-size:13px}
.log .l:last-child{border-bottom:0}
.log .t{color:var(--ink-500);font-variant-numeric:tabular-nums}
.runlog{font-family:var(--mono);font-size:12px;line-height:1.55;color:var(--ink-700);white-space:pre-wrap;padding:14px 20px;max-height:340px;overflow:auto;background:#faf9f8}

@media(max-width:900px){
  body{grid-template-columns:1fr;grid-template-rows:auto 1fr}
  .rail{flex-direction:row;align-items:center;gap:8px;padding:10px 12px;overflow-x:auto;border-bottom:1px solid var(--line-100)}
  .brand{padding:0 8px 0 0}.group{margin:0;display:contents}.group .lbl{display:none}.nav{flex-direction:row}.railfoot{display:none}
  .head{padding:16px 16px 10px}.content{padding:4px 16px 30px}.pane>.list,.pane>.detail{max-height:none}
}
@media(prefers-reduced-motion:reduce){*{transition-duration:.01ms!important;animation:none!important}}
`
