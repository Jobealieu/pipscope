import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, buildFeatures, analyze } from '../lib/engine.js';
import handler from '../api/candles.js';

// Seeded PRNG so tests are deterministic.
const rng = (s => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32))(42);

function synthBars(n, persist) {
  const bars = [];
  let c = 1.1, dir = 1;
  for (let i = 0; i < n; i++) {
    if (rng() > persist) dir = -dir; // persist=0.5 => random walk, higher => momentum
    const o = c;
    c = +(c + dir * (0.0002 + rng() * 0.0003)).toFixed(5);
    bars.push({ t: i * 300, o, h: Math.max(o, c) + 0.0001, l: Math.min(o, c) - 0.0001, c });
  }
  return bars;
}

test('normalize splits off the still-forming candle', () => {
  const raw = [[0, 1, 1, 1, 1], [300, 1, 1, 1, 1], [610, 1, 1, 1, 1]];
  const { bars, forming } = normalize(raw, '5m', 700);
  assert.equal(bars.length, 2);
  assert.equal(forming.t, 600);
  assert.equal(normalize(raw, '5m', 99999).forming, null);
});

test('features never look ahead: appending future bars leaves past rows unchanged', () => {
  const bars = synthBars(600, 0.5);
  const a = buildFeatures(bars.slice(0, 400)), b = buildFeatures(bars);
  assert.deepEqual(b.X.slice(0, a.X.length), a.X);
  assert.equal(a.y.at(-1), undefined); // live row has no label
});

test('models find a planted momentum edge out of sample', () => {
  const f = buildFeatures(synthBars(3000, 0.85));
  const { stats, model } = analyze(f.X, f.y);
  assert.ok(stats.acc > 0.75, `acc ${stats.acc}`);
  const p = model.predict(f.X.at(-1)).p;
  assert.ok(p > 0 && p < 1);
});

test('models do not invent an edge on a pure random walk', () => {
  const f = buildFeatures(synthBars(3000, 0.5));
  const { stats } = analyze(f.X, f.y);
  assert.ok(Math.abs(stats.acc - 0.5) < 0.06, `acc ${stats.acc}`);
});

test('api rejects pairs outside the whitelist', async () => {
  let code;
  const res = { status: c => ((code = c), res), json: () => res, setHeader() {} };
  await handler({ query: { pair: 'BTCUSD', tf: '5m' } }, res);
  assert.equal(code, 400);
});
