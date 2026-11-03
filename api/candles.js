// Vercel serverless proxy: free Yahoo Finance forex candles, whitelisted so it is not an open proxy.
export const PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY'];
const RANGE = { '5m': '60d', '1h': '730d' }; // Yahoo's max history per interval

export default async function handler(req, res) {
  const { pair = 'EURUSD', tf = '5m' } = req.query;
  if (!PAIRS.includes(pair) || !RANGE[tf]) return res.status(400).json({ error: 'unknown pair or timeframe' });
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${pair}=X?interval=${tf}&range=${RANGE[tf]}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    const result = (await r.json()).chart?.result?.[0];
    if (!result?.timestamp) throw new Error('upstream returned no candles');
    const q = result.indicators.quote[0], dp = pair.endsWith('JPY') ? 3 : 5;
    const round = v => +v.toFixed(dp);
    const candles = [];
    result.timestamp.forEach((t, i) => {
      if ([q.open[i], q.high[i], q.low[i], q.close[i]].every(v => v != null)) {
        candles.push([t, round(q.open[i]), round(q.high[i]), round(q.low[i]), round(q.close[i])]);
      }
    });
    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40');
    return res.status(200).json({ pair, tf, candles });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
