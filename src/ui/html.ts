export const HTML = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shoal</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/app.css"></head>
<body>
<nav class="rail" id="rail"></nav>
<main class="main">
  <header class="head"><div style="min-width:0"><h1 id="title">Shoal</h1><div class="sub" id="subtitle"></div></div><div class="acts" id="acts"></div></header>
  <div class="content" id="content"></div>
</main>
<div class="veil" id="veil"></div>
<aside class="drawer" id="drawer" aria-hidden="true"></aside>
<div class="modal" id="modal"></div>
<div class="stale" id="stale" hidden></div>
<script src="/app.js"></script>
</body></html>`
