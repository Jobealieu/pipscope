# PIPSCOPE

A free forex dashboard that gives the probability that the next **5-minute** or **1-hour** candle closes up or down. It also shows how accurate those calls were on data the model never saw.

## What it does

- **10 major pairs.** EUR/USD, GBP/USD, USD/JPY, AUD/USD, USD/CAD, USD/CHF, NZD/USD, EUR/GBP, EUR/JPY and GBP/JPY.
- **Data.** 60 days of 5-minute candles and 2 years of 1-hour candles from Yahoo Finance. No API key needed.
- **20 features.** Momentum, RSI, MACD, EMA structure, Bollinger Bands, stochastic, candle shape, volatility regime, streaks and time of day.
- **2 models, averaged.** L2 logistic regression and gradient-boosted decision stumps. Both are written in plain JavaScript and train in your browser in about 1 second.
- **Walk-forward backtest.** The models train on the first 75% of history and are scored on the unseen last 25%. You see:
  - accuracy
  - accuracy on the high-conviction calls (the top 20% most confident)
  - a baseline
  - the 55.6% breakeven win rate at an 80% payout
  - a z-score that tells you whether the edge is real or noise
- **Multi-timeframe check.** It shows whether the 5-minute and 1-hour calls agree.
- **"Why this call".** Lists the features pushing the current prediction up or down.
- **Live track record.** Every call is stored in your browser and scored when its candle closes.

## Honest expectations

Short-term forex direction is close to a coin flip. Out-of-sample accuracy is usually 50–54% overall, and sometimes 55–59% on high-conviction calls. At typical binary-option payouts you need more than 55.6% just to break even. The dashboard tells you when a pair or timeframe has no edge, so believe it. This is not financial advice.

## Run locally

```bash
npm run dev   # http://localhost:3000
npm test      # engine and API tests (node:test, no dependencies)
```

## Layout

| Path | Role |
| --- | --- |
| `api/candles.js` | Vercel serverless proxy to Yahoo, limited to a whitelist of pairs |
| `lib/engine.js` | Features, models and backtest; runs in both the browser and Node |
| `app.js`, `index.html`, `style.css` | Dashboard (no build step) |
| `dev.js` | Local server that copies Vercel's routing |

## Deploy (free)

Import the repo into Vercel on the Hobby plan. There's no build step: the static files are served from the root, and `api/` becomes a serverless function.
