// Pure analysis engine: candles -> features -> models -> walk-forward backtest.
// Runs unchanged in the browser and in Node (tests). No dependencies.

export const PERIOD = { '5m': 300, '1h': 3600 };
const WARM = 200; // bars needed before every indicator is valid (EMA200)

export const FEATURES = [
  'ret1', 'ret3', 'ret6', 'ret12', 'rsi14', 'rsi3', 'macdHist', 'ema9_21', 'px_ema50', 'px_ema200',
  'bbPctB', 'bbWidth', 'stochK', 'body', 'upWick', 'loWick', 'volRegime', 'streak', 'hourSin', 'hourCos',
];

// Align timestamps to candle buckets and split off the still-forming candle.
export function normalize(raw, tf, now = Date.now() / 1000) {
  const p = PERIOD[tf];
  const byBucket = new Map();
  for (const [t, o, h, l, c] of raw) {
    const bt = Math.floor(t / p) * p;
    byBucket.set(bt, { t: bt, o, h, l, c });
  }
  const bars = [...byBucket.values()].sort((a, b) => a.t - b.t);
  const forming = bars.length && now < bars.at(-1).t + p ? bars.pop() : null;
  return { bars, forming };
}

const ema = (xs, n) => { const k = 2 / (n + 1), out = []; let e = xs[0]; for (const x of xs) out.push(e = x * k + e * (1 - k)); return out; };
const rma = (xs, n) => { const out = []; let e = xs[0]; for (const x of xs) out.push(e = (e * (n - 1) + x) / n); return out; };
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const rolling = (xs, n, f) => xs.map((_, i) => f(xs.slice(Math.max(0, i - n + 1), i + 1)));
const clamp = x => Math.max(-10, Math.min(10, Number.isFinite(x) ? x : 0));
const sigmoid = z => 1 / (1 + Math.exp(-z));

function rsi(c, n) {
  const up = [0], dn = [0];
  for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1]; up.push(Math.max(d, 0)); dn.push(Math.max(-d, 0)); }
  const u = rma(up, n), d = rma(dn, n);
  return u.map((v, i) => (v + d[i] === 0 ? 50 : (100 * v) / (v + d[i])));
}

// Every feature at bar i uses only bars <= i (causal). Label y = next close up (1) / down (0) / flat (null).
export function buildFeatures(bars) {
  const c = bars.map(b => b.c);
  const tr = bars.map((b, i) => (i ? Math.max(b.h - b.l, Math.abs(b.h - c[i - 1]), Math.abs(b.l - c[i - 1])) : b.h - b.l));
  const atr = rma(tr, 14), atrSlow = rma(tr, 100);
  const [e9, e12, e21, e26, e50, e200] = [9, 12, 21, 26, 50, 200].map(n => ema(c, n));
  const macd = e12.map((v, i) => v - e26[i]), signal = ema(macd, 9);
  const r14 = rsi(c, 14), r3 = rsi(c, 3);
  const m20 = rolling(c, 20, mean), s20 = rolling(c, 20, sd);
  const hi14 = rolling(bars.map(b => b.h), 14, a => Math.max(...a));
  const lo14 = rolling(bars.map(b => b.l), 14, a => Math.min(...a));

  const X = [], y = [], t = [];
  let streak = 0;
  for (let i = 1; i < bars.length; i++) {
    streak = c[i] > c[i - 1] ? Math.max(streak, 0) + 1 : c[i] < c[i - 1] ? Math.min(streak, 0) - 1 : 0;
    if (i < WARM) continue;
    const b = bars[i], a = atr[i] || 1e-9, ret = k => (c[i] - c[i - k]) / a;
    const hr = ((b.t % 86400) / 3600) * (Math.PI / 12);
    X.push([
      ret(1), ret(3), ret(6), ret(12),
      (r14[i] - 50) / 10, (r3[i] - 50) / 10,
      (macd[i] - signal[i]) / a, (e9[i] - e21[i]) / a, (c[i] - e50[i]) / a, (c[i] - e200[i]) / a,
      s20[i] ? (c[i] - m20[i]) / (2 * s20[i]) : 0, s20[i] / a,
      hi14[i] > lo14[i] ? ((c[i] - lo14[i]) / (hi14[i] - lo14[i])) * 2 - 1 : 0,
      (b.c - b.o) / a, (b.h - Math.max(b.o, b.c)) / a, (Math.min(b.o, b.c) - b.l) / a,
      atr[i] / (atrSlow[i] || a), Math.max(-5, Math.min(5, streak)) / 5,
      Math.sin(hr), Math.cos(hr),
    ].map(clamp));
    y.push(i + 1 < bars.length ? (c[i + 1] > c[i] ? 1 : c[i + 1] < c[i] ? 0 : null) : undefined);
    t.push(b.t);
  }
  const n = bars.length - 1;
  return {
    X, y, t,
    series: { e21, e50 },
    last: {
      rsi: r14[n], macdHist: macd[n] - signal[n], atr: atr[n],
      pctB: s20[n] ? (c[n] - (m20[n] - 2 * s20[n])) / (4 * s20[n]) : 0.5,
      stochK: hi14[n] > lo14[n] ? (100 * (c[n] - lo14[n])) / (hi14[n] - lo14[n]) : 50,
      trend: c[n] > e50[n] && e50[n] > e200[n] ? 'UP' : c[n] < e50[n] && e50[n] < e200[n] ? 'DOWN' : 'RANGE',
    },
  };
}

function standardizer(X) {
  const d = X[0].length, mu = new Array(d).fill(0), v = new Array(d).fill(0);
  for (const r of X) r.forEach((x, j) => (mu[j] += x / X.length));
  for (const r of X) r.forEach((x, j) => (v[j] += (x - mu[j]) ** 2 / X.length));
  const s = v.map(x => Math.sqrt(x) || 1);
  return x => x.map((xj, j) => (xj - mu[j]) / s[j]);
}

// L2-regularised logistic regression, full-batch gradient descent.
function trainLogistic(X, y, iters = 300, lr = 0.3, l2 = 1e-3) {
  const n = X.length, d = X[0].length, w = new Float64Array(d);
  let b = 0;
  const z = x => { let s = b; for (let j = 0; j < d; j++) s += w[j] * x[j]; return s; };
  for (let it = 0; it < iters; it++) {
    const gw = new Float64Array(d);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const e = sigmoid(z(X[i])) - y[i];
      gb += e;
      for (let j = 0; j < d; j++) gw[j] += e * X[i][j];
    }
    b -= (lr * gb) / n;
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + l2 * w[j]);
  }
  return { prob: x => sigmoid(z(x)), contrib: x => Array.from(w, (wj, j) => wj * x[j]) };
}

// Gradient-boosted decision stumps (Newton steps on log-loss, quantile-binned splits).
function trainBoost(X, y, rounds = 150, lr = 0.1, bins = 16, lambda = 1) {
  const n = X.length, d = X[0].length;
  const cuts = [], B = [];
  for (let j = 0; j < d; j++) {
    const v = X.map(r => r[j]).sort((a, b) => a - b);
    cuts[j] = [...new Set(Array.from({ length: bins - 1 }, (_, k) => v[Math.floor(((k + 1) * n) / bins)]))];
    B[j] = Uint8Array.from(X, r => { let k = 0; while (k < cuts[j].length && cuts[j][k] < r[j]) k++; return k; });
  }
  const pos = y.reduce((s, v) => s + v, 0) / n;
  const base = Math.log((pos + 1e-9) / (1 - pos + 1e-9));
  const F = new Float64Array(n).fill(base), trees = [], importance = new Array(d).fill(0);
  const g = new Float64Array(n), h = new Float64Array(n);
  for (let r = 0; r < rounds; r++) {
    let Gt = 0, Ht = 0;
    for (let i = 0; i < n; i++) { const p = sigmoid(F[i]); g[i] = y[i] - p; h[i] = p * (1 - p); Gt += g[i]; Ht += h[i]; }
    let best = null;
    for (let j = 0; j < d; j++) {
      const nb = cuts[j].length + 1, G = new Float64Array(nb), H = new Float64Array(nb);
      for (let i = 0; i < n; i++) { G[B[j][i]] += g[i]; H[B[j][i]] += h[i]; }
      let GL = 0, HL = 0;
      for (let k = 0; k < nb - 1; k++) {
        GL += G[k]; HL += H[k];
        const GR = Gt - GL, HR = Ht - HL;
        const gain = (GL * GL) / (HL + lambda) + (GR * GR) / (HR + lambda) - (Gt * Gt) / (Ht + lambda);
        if (!best || gain > best.gain) best = { gain, j, k, cut: cuts[j][k], left: GL / (HL + lambda), right: GR / (HR + lambda) };
      }
    }
    if (!best) break;
    trees.push(best);
    importance[best.j] += best.gain;
    for (let i = 0; i < n; i++) F[i] += lr * (B[best.j][i] <= best.k ? best.left : best.right);
  }
  return {
    prob: x => sigmoid(trees.reduce((s, t) => s + lr * (x[t.j] <= t.cut ? t.left : t.right), base)),
    importance,
  };
}

// Ensemble = average of both models. hiThr = top-20% confidence cutoff measured on training data.
export function fit(X, y) {
  const s = standardizer(X), Z = X.map(s);
  const lr = trainLogistic(Z, y), gb = trainBoost(Z, y);
  const conf = Z.map(z => Math.abs((lr.prob(z) + gb.prob(z)) / 2 - 0.5)).sort((a, b) => a - b);
  return {
    hiThr: conf[Math.floor(conf.length * 0.8)],
    importance: gb.importance,
    predict(x) {
      const z = s(x), a = lr.prob(z), b = gb.prob(z);
      return { p: (a + b) / 2, lr: a, gb: b, contrib: lr.contrib(z) };
    },
  };
}

// Chronological split: train on the first 75%, score on the unseen last 25%, then refit on everything for live use.
export function analyze(X, y, split = 0.75) {
  const rows = X.map((x, i) => [x, y[i]]).filter(([, v]) => v === 0 || v === 1);
  const cut = Math.floor(rows.length * split), train = rows.slice(0, cut), test = rows.slice(cut);
  const m = fit(train.map(r => r[0]), train.map(r => r[1]));
  let hit = 0, lrHit = 0, gbHit = 0, ups = 0, hiN = 0, hiHit = 0;
  for (const [x, v] of test) {
    const r = m.predict(x), up = v === 1, ok = r.p > 0.5 === up;
    hit += ok; lrHit += r.lr > 0.5 === up; gbHit += r.gb > 0.5 === up; ups += v;
    if (Math.abs(r.p - 0.5) >= m.hiThr) { hiN++; hiHit += ok; }
  }
  const n = test.length, acc = hit / n, hiAcc = hiN ? hiHit / hiN : null;
  return {
    model: fit(rows.map(r => r[0]), rows.map(r => r[1])),
    stats: {
      n, acc, lrAcc: lrHit / n, gbAcc: gbHit / n, hiN, hiAcc, coverage: hiN / n,
      baseline: Math.max(ups / n, 1 - ups / n),
      z: (acc - 0.5) / Math.sqrt(0.25 / n),
      hiZ: hiN ? (hiAcc - 0.5) / Math.sqrt(0.25 / hiN) : 0,
    },
  };
}
