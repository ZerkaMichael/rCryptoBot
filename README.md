# rCryptoBot

![Version](https://img.shields.io/badge/version-1.1.1-blue)
![Node](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen)
![License](https://img.shields.io/badge/license-ISC-green)

Telegram bot for traders who want real-time price data, smart alerts, and concise AI market briefings in one place.

## Highlights
- **Realtime market feed** refreshed every 10 seconds with automatic fallbacks across CryptoCompare, CoinCap, and CoinGecko.
- **Intelligent alerting** for both manual price triggers and automatic 3% volatility moves, with built-in cooldowns to avoid spam.
- **AI-powered news** pipeline that consolidates Reddit, CryptoPanic, major RSS feeds, Google News, X/Twitter, and on-chain activity into a single executive briefing.
- **Order book sentiment** snapshot that scores bid/ask imbalance so you know how the book is stacked before acting.
- **Market anomaly detection** surfaces whale moves, exchange flows, liquidation risk, and other unusual activity.

## Quick Start
1. **Install**
   ```bash
   git clone https://github.com/yourusername/rCryptoBot.git
   cd rCryptoBot
   npm install
   ```
2. **Configure keys**
   ```bash
   cp config/config.example.js config/config.js
   ```
   Update `config/config.js` with your Telegram token, OpenAI key, and (optionally) an X/Twitter bearer token.
3. **Run**
   ```bash
   node bot.js
   ```
   Open Telegram, message your bot, and type `/start` to see the command list.

## Core Commands
| Command | Purpose |
| --- | --- |
| `/crypto` | Snapshot of the top market movers |
| `/price <symbol>` | Real-time quote with market cap and volume |
| `/news <symbol>` | AI briefing with news, sentiment, whale moves, and order book read |
| `/alert <symbol> <price>` | One-off price alert |
| `/autoalerts` | Toggle automatic 3% volatility alerts |
| `/alerts`, `/clearalerts`, `/settings` | Manage your alerts and preferences |

## Tech Stack
- **Runtime**: Node.js (>= 14)
- **Messaging**: `node-telegram-bot-api`
- **Data**: CryptoCompare, CoinCap, CoinGecko, Binance, KuCoin, Gate.io, Reddit, CryptoPanic, Google News, X/Twitter
- **Analysis**: OpenAI GPT-3.5 Turbo for summarization

## Roadmap
- Historical chart snapshots inside Telegram
- Expanded localization and multi-language feeds
- Lightweight web dashboard companion

## Changelog
- **1.1.1** — Added multi-exchange order book sentiment to `/news` and tightened symbol filtering
- **1.1.0** — Expanded news aggregation (CryptoPanic, RSS, Google News), optional X/Twitter integration, and upgraded quality scoring.
- **1.0.0** — Initial release with price feeds, alerts, Reddit briefings, and activity detector.

## License
ISC License — see [`LICENSE`](LICENSE).
