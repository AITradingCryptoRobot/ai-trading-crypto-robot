require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("Set JWT_SECRET to a random string of at least 32 characters in .env");
  process.exit(1);
}

const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "platform.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS bot_states (
  user_id INTEGER PRIMARY KEY,
  running INTEGER NOT NULL DEFAULT 0,
  symbol TEXT NOT NULL DEFAULT 'BTCUSDT',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS paper_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  price REAL NOT NULL,
  quote_value REAL NOT NULL,
  strategy TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

const userByEmail = db.prepare("SELECT * FROM users WHERE email = ?");
const insertUser = db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)");
const ensureBot = db.prepare("INSERT OR IGNORE INTO bot_states(user_id) VALUES(?)");

app.use(helmet({ contentSecurityPolicy: {
  directives: {
    defaultSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    fontSrc: ["'self'", "https://fonts.gstatic.com"],
    scriptSrc: ["'self'"],
    imgSrc: ["'self'", "data:"],
    connectSrc: ["'self'", "https://api.binance.com"]
  }
}}));
app.use(express.json({ limit: "20kb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }));

function makeToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "12h" });
}
function setAuthCookie(res, token) {
  res.cookie("atr_session", token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    maxAge: 12 * 60 * 60 * 1000, path: "/"
  });
}
function auth(req, res, next) {
  try {
    const token = req.cookies.atr_session;
    if (!token) return res.status(401).json({ error: "Please sign in." });
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Your session has expired. Please sign in again." });
  }
}
function adminOnly(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin access required." });
  next();
}
function safeUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, created_at: user.created_at };
}

app.post("/api/auth/register", async (req, res) => {
  if (process.env.ALLOW_REGISTRATION === "false") return res.status(403).json({ error: "Registration is currently closed." });
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: "Enter a name between 2 and 80 characters." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 12) return res.status(400).json({ error: "Use a password with at least 12 characters." });
  if (userByEmail.get(email)) return res.status(409).json({ error: "An account with this email already exists." });
  try {
    const hash = await bcrypt.hash(password, 12);
    const role = process.env.ADMIN_EMAIL && email === process.env.ADMIN_EMAIL.toLowerCase() ? "admin" : "customer";
    const result = insertUser.run(name, email, hash, role);
    const user = db.prepare("SELECT * FROM users WHERE id=?").get(result.lastInsertRowid);
    ensureBot.run(user.id);
    setAuthCookie(res, makeToken(user));
    res.json({ user: safeUser(user) });
  } catch (e) {
    res.status(500).json({ error: "Could not create account." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = userByEmail.get(email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: "Email or password is incorrect." });
  ensureBot.run(user.id);
  setAuthCookie(res, makeToken(user));
  res.json({ user: safeUser(user) });
});
app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("atr_session", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  res.json({ ok: true });
});
app.get("/api/auth/me", auth, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  res.json({ user: safeUser(user) });
});

const allowedSymbols = new Set(["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT"]);
async function binance(pathname) {
  const response = await fetch("https://api.binance.com" + pathname, { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Binance market data is temporarily unavailable.");
  return response.json();
}
app.get("/api/market/tickers", async (req, res) => {
  try {
    const symbols = [...allowedSymbols];
    const data = await binance("/api/v3/ticker/24hr?symbols=" + encodeURIComponent(JSON.stringify(symbols)));
    res.set("Cache-Control", "public, max-age=10");
    res.json(data.map(x => ({
      symbol: x.symbol, price: Number(x.lastPrice),
      changePercent: Number(x.priceChangePercent), volume: Number(x.quoteVolume)
    })));
  } catch (e) { res.status(503).json({ error: e.message || "Market data unavailable." }); }
});
app.get("/api/market/klines/:symbol", async (req, res) => {
  const symbol = String(req.params.symbol).toUpperCase();
  if (!allowedSymbols.has(symbol)) return res.status(400).json({ error: "Unsupported symbol." });
  try {
    const interval = ["1m","5m","15m","1h","4h","1d"].includes(req.query.interval) ? req.query.interval : "1h";
    const data = await binance(`/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=100`);
    res.json(data.map(k => ({ time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] })));
  } catch (e) { res.status(503).json({ error: e.message || "Chart data unavailable." }); }
});

app.get("/api/dashboard", auth, (req, res) => {
  const bot = db.prepare("SELECT * FROM bot_states WHERE user_id=?").get(req.user.id);
  const trades = db.prepare("SELECT * FROM paper_trades WHERE user_id=? ORDER BY id DESC LIMIT 50").all(req.user.id);
  const buyCost = db.prepare("SELECT COALESCE(SUM(quote_value),0) AS n FROM paper_trades WHERE user_id=? AND side='BUY'").get(req.user.id).n;
  const sellValue = db.prepare("SELECT COALESCE(SUM(quote_value),0) AS n FROM paper_trades WHERE user_id=? AND side='SELL'").get(req.user.id).n;
  res.json({ mode: "PAPER", bot, trades, stats: { tradeCount: trades.length, buyCost, sellValue, realizedDifference: sellValue - buyCost } });
});
app.post("/api/bot/start", auth, (req, res) => {
  const symbol = String(req.body.symbol || "BTCUSDT").toUpperCase();
  if (!allowedSymbols.has(symbol)) return res.status(400).json({ error: "Unsupported trading pair." });
  db.prepare("INSERT INTO bot_states(user_id,running,symbol,updated_at) VALUES(?,1,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET running=1,symbol=excluded.symbol,updated_at=CURRENT_TIMESTAMP").run(req.user.id, symbol);
  res.json({ ok: true, mode: "PAPER", message: "Paper strategy enabled. No real orders will be placed." });
});
app.post("/api/bot/stop", auth, (req, res) => {
  db.prepare("UPDATE bot_states SET running=0,updated_at=CURRENT_TIMESTAMP WHERE user_id=?").run(req.user.id);
  res.json({ ok: true, message: "Paper strategy stopped." });
});
app.get("/api/admin/summary", auth, adminOnly, (req, res) => {
  const users = db.prepare("SELECT id,name,email,role,created_at FROM users ORDER BY id DESC LIMIT 200").all();
  const count = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  const tradeCount = db.prepare("SELECT COUNT(*) AS n FROM paper_trades").get().n;
  res.json({ users, count, tradeCount });
});

// Subscription endpoint is deliberately informational until a payment provider
// and business/legal requirements are configured.
app.get("/api/plans", (req, res) => res.json([
  { id: "starter", name: "Starter", price: null, status: "Contact for pricing" },
  { id: "pro", name: "Professional", price: null, status: "Contact for pricing" },
  { id: "enterprise", name: "Enterprise", price: null, status: "Custom" }
]));

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, () => console.log(`AI Trading Crypto Robot running at http://localhost:${PORT}`));
