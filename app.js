import { PERIOD, normalize, buildFeatures, analyze, FEATURES } from './lib/engine.js';

const PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY'];
const TFS = ['5m', '1h'];
const PAYOUT = 0.8; // typical binary-option payout; breakeven win rate = 1 / (1 + payout)
const BREAKEVEN = 1 / (1 + PAYOUT);
const SESSIONS = [['SYD', 21, 6], ['TYO', 0, 9], ['LDN', 7, 16], ['NYC', 12, 21]];
const LABELS = {
  ret1: 'last candle move', ret3: '3-candle momentum', ret6: '6-candle momentum', ret12: '12-candle momentum',
  rsi14: 'RSI 14', rsi3: 'RSI 3 (short-term stretch)', macdHist: 'MACD histogram', ema9_21: 'EMA 9 vs 21',
  px_ema50: 'price vs EMA 50', px_ema200: 'price vs EMA 200', bbPctB: 'Bollinger position', bbWidth: 'Bollinger width',
  stochK: 'stochastic %K', body: 'candle body', upWick: 'upper wick', loWick: 'lower wick',
  volRegime: 'volatility regime', streak: 'up/down streak', hourSin: 'time of day', hourCos: 'time of day',
};

const $ = s => document.querySelector(s);
const pct = (x, d = 1) => (x == null ? '--' : `${(x * 100).toFixed(d)}%`);
const hhmmss = s => [s / 3600, (s / 60) % 60, s % 60].map(v => String(Math.floor(v)).padStart(2, '0')).join(':');
const pipSize = pair => (pair.endsWith('JPY') ? 0.01 : 0.0001);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const yieldUI = () => new Promise(r => setTimeout(r, 16));

const state = {
  pair: PAIRS.includes(localStorage.pair) ? localStorage.pair : 'EURUSD',
  tf: TFS.includes(localStorage.tf) ? localStorage.tf : '5m',
  models: {}, // `${pair}|${tf}` -> { key, model, stats }
  view: null,
  busy: false,
};
let chart, candleSeries, e21Series, e50Series;

// ---------- data + model ----------
async function load(pair, tf, onStep) {
  onStep(`fetching ${pair} ${tf} candles`);
  const r = await fetch(`/api/candles?pair=${pair}&tf=${tf}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  const { bars, forming } = normalize(j.candles, tf);
  if (bars.length < 400) throw new Error(`only ${bars.length} candles returned`);
  const f = buildFeatures(bars);
  const slot = `${pair}|${tf}`, key = `${slot}|${bars.at(-1).t}`;
  if (state.models[slot]?.key !== key) {
    onStep(`training ${tf} ensemble on ${f.X.length.toLocaleString()} candles`);
    await yieldUI();
    state.models[slot] = { key, ...analyze(f.X, f.y) };
  }
  const { model, stats } = state.models[slot];
  return { pair, tf, bars, forming, f, stats, hiThr: model.hiThr, pred: model.predict(f.X.at(-1)) };
}

async function run(showLoading) {
  if (state.busy) return;
  state.busy = true;
  const pair = state.pair;
  const steps = [];
  const onStep = s => { steps.push(s); if (showLoading) renderBoot(steps); };
  if (showLoading) renderBoot(steps);
  try {
    const views = {};
    for (const tf of TFS) views[tf] = await load(pair, tf, onStep);
    if (pair !== state.pair) return; // user switched pair mid-flight
    state.view = views;
    recordSignals(Object.values(views));
    render(showLoading);
  } catch (e) {
    renderError(e);
  } finally {
    state.busy = false;
    if (pair !== state.pair) run(true);
  }
}

// ---------- signal log (localStorage) ----------
function recordSignals(views) {
  const log = JSON.parse(localStorage.log || '[]');
  for (const v of views) {
    if (v.forming) {
      const id = `${v.pair}|${v.tf}|${v.forming.t}`;
      if (!log.some(e => e.id === id)) {
        log.push({ id, pair: v.pair, tf: v.tf, t: v.forming.t, ref: v.bars.at(-1).c, up: v.pred.p > 0.5, p: v.pred.p, hi: Math.abs(v.pred.p - 0.5) >= v.hiThr });
      }
    }
    for (const e of log) {
      if (e.pair !== v.pair || e.tf !== v.tf || e.res) continue;
      const bar = v.bars.find(b => b.t === e.t);
      if (bar) e.res = bar.c === e.ref ? 'flat' : bar.c > e.ref === e.up ? 'hit' : 'miss';
    }
  }
  localStorage.log = JSON.stringify(log.slice(-300));
}

// ---------- rendering ----------
function scramble(el, text) {
  if (reduceMotion) { el.textContent = text; return; }
  const glyphs = '0123456789#$%&@<>/';
  let frame = 0;
  const id = setInterval(() => {
    frame++;
    el.textContent = [...text].map((ch, i) => (i < frame / 2 || ch === ' ' ? ch : glyphs[(Math.random() * glyphs.length) | 0])).join('');
    if (frame / 2 >= text.length) clearInterval(id);
  }, 30);
}

function renderBoot(steps) {
  const lines = ['pipscope engine v1', `target ${state.pair}`, ...steps].map(s => `<p>&gt; ${s}</p>`).join('');
  $('#verdict-body').innerHTML = `<div class="boot">${lines}</div>`;
  $('#bt-n').textContent = '';
  for (const id of ['#confluence', '#indicators', '#backtest', '#drivers']) $(id).innerHTML = '<div class="skel"></div>'.repeat(4);
}

function renderError(e) {
  $('#verdict-body').innerHTML = `<div class="err"><p>&gt; error: ${String(e.message).replace(/</g, '&lt;')}</p><p class="dim">Data source unreachable or rate-limited.</p><button id="retry">Retry</button></div>`;
  $('#retry').onclick = () => run(true);
}

function render(fresh) {
  const v = state.view[state.tf];
  const dp = v.pair.endsWith('JPY') ? 3 : 5;
  const live = !!v.forming;

  // chart
  const candles = [...v.bars, ...(v.forming ? [v.forming] : [])].map(b => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c }));
  candleSeries.applyOptions({ priceFormat: { type: 'price', precision: dp, minMove: 10 ** -dp } });
  candleSeries.setData(candles);
  e21Series.setData(v.bars.map((b, i) => ({ time: b.t, value: v.f.series.e21[i] })));
  e50Series.setData(v.bars.map((b, i) => ({ time: b.t, value: v.f.series.e50[i] })));
  if (fresh) chart.timeScale().setVisibleLogicalRange({ from: candles.length - 160, to: candles.length + 4 });
  $('#chart-title').textContent = `> ${v.pair.slice(0, 3)}/${v.pair.slice(3)} ${v.tf.toUpperCase()}  ${v.bars.at(-1).c.toFixed(dp)}`;

  // verdict
  const { p } = v.pred, up = p > 0.5, conf = Math.max(p, 1 - p), hi = Math.abs(p - 0.5) >= v.hiThr;
  $('#v-title').textContent = live ? `> next ${v.tf} candle` : '> market closed, call for reopen';
  $('#verdict-body').innerHTML = `
    <div class="call ${up ? 'up' : 'down'}"><i class="ph-bold ph-arrow-fat-${up ? 'up' : 'down'}"></i><span id="call-text"></span></div>
    <div class="prob ${up ? 'up' : 'down'}">${pct(conf)} <span class="dim">probability</span></div>
    <span class="tag ${hi ? 'up' : 'dim'}">${hi ? 'HIGH CONVICTION' : 'LOW CONVICTION'}</span>
    <p class="dim">logistic ${pct(v.pred.lr)} up / boosted ${pct(v.pred.gb)} up</p>
    <p class="dim">close above ${v.bars.at(-1).c.toFixed(dp)} = UP</p>`;
  scramble($('#call-text'), up ? 'UP' : 'DOWN');

  // multi-timeframe confluence
  const rows = TFS.map(tf => {
    const x = state.view[tf], u = x.pred.p > 0.5;
    return { tf, u, html: `<div class="row"><span>${tf.toUpperCase()}</span><span class="${u ? 'up' : 'down'}"><i class="ph-bold ph-caret-${u ? 'up' : 'down'}"></i> ${u ? 'UP' : 'DOWN'} ${pct(Math.max(x.pred.p, 1 - x.pred.p))}</span><span class="dim">trend ${x.f.last.trend}</span></div>` };
  });
  const aligned = rows[0].u === rows[1].u;
  $('#confluence').innerHTML = rows.map(r => r.html).join('') +
    `<p class="summary ${aligned ? (rows[0].u ? 'up' : 'down') : 'dim'}">${aligned ? `ALIGNED ${rows[0].u ? 'UP' : 'DOWN'}: both timeframes agree` : 'MIXED: timeframes disagree, stand aside'}</p>`;

  // indicators
  const L = v.f.last;
  $('#indicators').innerHTML = [
    ['RSI 14', L.rsi.toFixed(1) + (L.rsi > 70 ? ' overbought' : L.rsi < 30 ? ' oversold' : '')],
    ['MACD hist', `<span class="${L.macdHist >= 0 ? 'up' : 'down'}">${(L.macdHist / pipSize(v.pair)).toFixed(2)} pips</span>`],
    ['ATR 14', `${(L.atr / pipSize(v.pair)).toFixed(1)} pips`],
    ['Bollinger %B', L.pctB.toFixed(2)],
    ['Stochastic %K', L.stochK.toFixed(1)],
    ['Trend (EMA50/200)', `<span class="${L.trend === 'UP' ? 'up' : L.trend === 'DOWN' ? 'down' : 'dim'}">${L.trend}</span>`],
  ].map(([k, val]) => `<dt>${k}</dt><dd>${val}</dd>`).join('');

  // backtest
  const s = v.stats, beats = s.hiAcc != null && s.hiAcc > BREAKEVEN && s.hiZ > 2;
  $('#bt-n').textContent = `${s.n.toLocaleString()} unseen candles`;
  $('#backtest').innerHTML = `<dl class="kv">
      <dt>all calls accuracy</dt><dd>${pct(s.acc)}</dd>
      <dt>logistic / boosted</dt><dd>${pct(s.lrAcc)} / ${pct(s.gbAcc)}</dd>
      <dt>high-conviction accuracy</dt><dd class="${s.hiAcc > BREAKEVEN ? 'up' : ''}">${pct(s.hiAcc)}</dd>
      <dt>high-conviction coverage</dt><dd>${pct(s.coverage, 0)} of candles</dd>
      <dt>always-same-side baseline</dt><dd>${pct(s.baseline)}</dd>
      <dt>breakeven at ${PAYOUT * 100}% payout</dt><dd>${pct(BREAKEVEN)}</dd>
      <dt>edge z-score (all / high)</dt><dd>${s.z.toFixed(1)} / ${s.hiZ.toFixed(1)}</dd>
    </dl>
    <p class="bt-verdict ${beats ? 'up' : 'down'}">${beats
      ? 'High-conviction calls beat payout breakeven in the backtest. Past edge can vanish; size small.'
      : `No edge above the ${pct(BREAKEVEN)} breakeven. Treat this pair and timeframe as noise.`}</p>`;

  // drivers: logistic contributions for the live candle
  const contrib = v.pred.contrib.map((c, j) => ({ name: FEATURES[j], c })).sort((a, b) => Math.abs(b.c) - Math.abs(a.c)).slice(0, 6);
  const max = Math.abs(contrib[0].c) || 1;
  $('#drivers').innerHTML = contrib.map(d => `<div class="driver"><span>${LABELS[d.name]}</span><span class="meter ${d.c > 0 ? 'up' : 'down'}" style="width:${Math.max(4, (Math.abs(d.c) / max) * 64)}px" title="${d.c > 0 ? 'pushes UP' : 'pushes DOWN'}"></span></div>`).join('') +
    '<p class="dim" style="margin-top:8px">green pushes up, red pushes down</p>';

  renderLog();
}

function renderLog() {
  const log = JSON.parse(localStorage.log || '[]');
  const done = log.filter(e => e.res === 'hit' || e.res === 'miss');
  const hits = done.filter(e => e.res === 'hit').length;
  $('#log-rate').textContent = done.length ? `${hits}/${done.length} hit (${pct(hits / done.length)})` : '';
  if (!log.length) { $('#log').innerHTML = '<p class="empty">No calls yet. Keep this tab open while the market is live and every call is scored here.</p>'; return; }
  const rows = log.slice(-10).reverse().map(e => {
    const time = new Date(e.t * 1000).toISOString().slice(11, 16);
    const res = e.res === 'hit' ? '<span class="up">HIT</span>' : e.res === 'miss' ? '<span class="down">MISS</span>' : e.res === 'flat' ? '<span class="dim">FLAT</span>' : '<span class="dim">open</span>';
    return `<tr><td>${time}</td><td>${e.pair} ${e.tf}</td><td class="${e.up ? 'up' : 'down'}">${e.up ? 'UP' : 'DN'} ${pct(Math.max(e.p, 1 - e.p), 0)}${e.hi ? '*' : ''}</td><td>${res}</td></tr>`;
  }).join('');
  $('#log').innerHTML = `<table><thead><tr><th>UTC</th><th>pair</th><th>call</th><th>result</th></tr></thead><tbody>${rows}</tbody></table><p class="dim" style="margin-top:6px">* high conviction</p>`;
}

// ---------- chrome: pair tabs, timeframe, clock, sessions ----------
function setPressed() {
  document.querySelectorAll('#pairs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.pair === state.pair));
  document.querySelectorAll('.tf button').forEach(b => b.setAttribute('aria-pressed', b.dataset.tf === state.tf));
}

function tickClock() {
  const now = new Date(), h = now.getUTCHours();
  $('#clock').textContent = `${now.toISOString().slice(11, 19)} UTC`;
  $('#sessions').innerHTML = SESSIONS.map(([n, a, b]) => `<span class="${(a < b ? h >= a && h < b : h >= a || h < b) ? 'on' : ''}">${n}</span>`).join('');
  const v = state.view?.[state.tf];
  if (!v) return;
  if (!v.forming) { $('#countdown').textContent = 'closed'; return; }
  const left = v.forming.t + PERIOD[v.tf] - now / 1000;
  $('#countdown').textContent = left > 0 ? `closes in ${hhmmss(left)}` : 'scoring...';
  if (left < -5 && !state.busy) run(false); // candle closed: fetch, score the call, predict the next one
}

function init() {
  $('#pairs').innerHTML = PAIRS.map(p => `<button data-pair="${p}">${p.slice(0, 3)}/${p.slice(3)}</button>`).join('');
  $('#pairs').onclick = e => {
    const p = e.target.closest('button')?.dataset.pair;
    if (!p || p === state.pair) return;
    state.pair = localStorage.pair = p;
    setPressed();
    run(true);
  };
  document.querySelector('.tf').onclick = e => {
    const tf = e.target.closest('button')?.dataset.tf;
    if (!tf || tf === state.tf) return;
    state.tf = localStorage.tf = tf;
    setPressed();
    if (state.view) render(true);
  };
  setPressed();

  const LC = window.LightweightCharts;
  chart = LC.createChart($('#chart'), {
    autoSize: true,
    layout: { background: { color: 'transparent' }, textColor: '#6f8276', fontFamily: "'JetBrains Mono', monospace" },
    grid: { vertLines: { color: '#141c17' }, horzLines: { color: '#141c17' } },
    rightPriceScale: { borderColor: '#1b2620' },
    timeScale: { borderColor: '#1b2620', timeVisible: true },
    crosshair: { mode: LC.CrosshairMode.Normal },
  });
  candleSeries = chart.addSeries(LC.CandlestickSeries, {
    upColor: '#3fd98c', downColor: '#e8615a', borderVisible: false, wickUpColor: '#3fd98c', wickDownColor: '#e8615a',
  });
  e21Series = chart.addSeries(LC.LineSeries, { color: '#c9d7cd', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  e50Series = chart.addSeries(LC.LineSeries, { color: '#6f8276', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });

  tickClock();
  setInterval(tickClock, 1000);
  setInterval(() => !state.busy && run(false), 60_000); // keep the forming candle fresh
  run(true);
}

window.addEventListener('DOMContentLoaded', init);
