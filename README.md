# AI Trading Crypto Robot

A starter full-stack application featuring:
- Responsive black-and-gold web interface
- Email/password registration and login
- Password hashing with bcrypt
- HTTP-only JWT session cookie
- SQLite persistence
- Public Binance spot market ticker and candle data
- Customer dashboard, paper-bot controls and trade-history foundation
- Admin summary for the configured admin email
- Basic API rate limiting and Helmet security headers

## Important current limitations

This is an MVP scaffold, not a production investment or brokerage platform.
The bot controls are paper-mode only. The current implementation does not
execute simulated orders automatically yet, does not connect private Binance
accounts, does not accept deposits, and does not process payments. The moving
average strategy is described as an educational strategy concept, not AI.
The dashboard's paper trade history is ready for the next implementation step.

## Requirements

- Node.js 18 or newer
- npm

## Run locally

1. Copy `.env.example` to `.env`.
2. Set `JWT_SECRET` to a unique random secret of at least 32 characters.
3. Keep `ALLOW_REGISTRATION=true` during initial setup.
4. Set `ADMIN_EMAIL` to the email address you will use for the admin account.
5. Install dependencies: `npm install`
6. Start: `npm start`
7. Visit http://localhost:3000
8. Register using the configured admin email. The first account with that email receives the admin role.

For production, set `NODE_ENV=production`, use HTTPS, set a strong secret,
restrict registration after onboarding, back up the database, and use a managed
database and persistent storage.

## Binance integration

The app currently uses public Binance endpoints only:
- `/api/v3/ticker/24hr`
- `/api/v3/klines`

No API key is required for public market data. No real orders can be submitted.

## Before enabling live trading

A separate, explicitly reviewed implementation is required for private exchange
connectivity. Never put exchange secrets in frontend code. Use server-side secret
storage, least-privilege API keys, IP restrictions where available, withdrawals
disabled, per-user authorization, audit logs, strict risk limits, order
idempotency, kill switches, monitoring, and a testnet rollout. Obtain legal and
regulatory advice for the jurisdictions in which the service will operate.

## Business details

AI Trading Crypto Robot
Email: aitradingcryptorobot@gmail.com
Phone: +1 601 436 6665
Address supplied: No. 1234, New York, United States

The address should be completed with a verifiable street, city, state and ZIP
code before publishing.
