import express from "express";
import cors from "cors";
import crypto from "crypto";

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const INTERNAL_PORT = PUBLIC_PORT + 41;
process.env.PORT = String(INTERNAL_PORT);
await import("./server-v39.js");
process.env.PORT = String(PUBLIC_PORT);

const app = express();
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const WEB_ORIGIN = process.env.WEB_ORIGIN || "*";
const DEMO_MODE = process.env.DEMO_MODE === "true";

app.use(cors({
  origin: WEB_ORIGIN === "*" ? true : WEB_ORIGIN,
  allowedHeaders: ["Content-Type", "X-Telegram-Init-Data", "X-Demo-User"]
}));
app.use(express.json({ limit: "64kb" }));

async function sb(path, { method = "GET", body, prefer } = {}) {
  const headers = {
    apikey: SUPABASE_SECRET_KEY,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {})
  };
  if (!String(SUPABASE_SECRET_KEY || "").startsWith("sb_secret_")) {
    headers.Authorization = `Bearer ${SUPABASE_SECRET_KEY}`;
  }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const text = await r.text();
  if (!r.ok) throw new Error(text || `Database ${r.status}`);
  return text ? JSON.parse(text) : null;
}
const rpc = (name, body) => sb(`rpc/${name}`, { method: "POST", body });

function verifyInitData(initData) {
  if (!initData || !BOT_TOKEN) throw new Error("Telegram initData отсутствует");
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("hash отсутствует");
  params.delete("hash");

  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Date.now() / 1000 - authDate > 86400) {
    throw new Error("Telegram-сессия устарела");
  }

  const check = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const calculated = crypto.createHmac("sha256", secret).update(check).digest("hex");
  const a = Buffer.from(calculated, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("Неверная подпись Telegram");
  }
  return JSON.parse(params.get("user") || "{}");
}

function auth(req, res, next) {
  try {
    if (DEMO_MODE && req.headers["x-demo-user"]) {
      req.tgUser = { id: Number(req.headers["x-demo-user"]) };
      return next();
    }
    req.tgUser = verifyInitData(req.headers["x-telegram-init-data"]);
    next();
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
}

function friendly(error) {
  const text = String(error?.message || "");
  const m = text.match(/"message":"([^"]+)"/);
  return m?.[1] || text.replace(/^Database \d+:\s*/, "").slice(0, 180) || "Ошибка сервера";
}

function forwardedHeaders(req) {
  const headers = {};
  if (req.headers["x-telegram-init-data"]) {
    headers["X-Telegram-Init-Data"] = req.headers["x-telegram-init-data"];
  }
  if (req.headers["x-demo-user"]) {
    headers["X-Demo-User"] = req.headers["x-demo-user"];
  }
  headers["Content-Type"] = "application/json";
  return headers;
}

async function innerState(req) {
  const r = await fetch(`http://127.0.0.1:${INTERNAL_PORT}/api/state`, {
    headers: forwardedHeaders(req)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Не удалось обновить состояние");
  return d.state;
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    app: "business-zero-v4.0",
    economy: "atomic",
    anticheat: true,
    passiveIncome: "automatic",
    offlineCapHours: 8
  });
});

app.get("/api/passive/sync", auth, async (req, res) => {
  try {
    const result = await rpc("settle_passive_income_v40", {
      p_telegram_id: req.tgUser.id
    });
    const state = await innerState(req);
    res.json({
      ...result,
      state
    });
  } catch (e) {
    res.status(400).json({ error: friendly(e) });
  }
});

// Старые клиенты могут всё ещё показывать кнопку «Забрать доход».
// Нажатие больше не даёт отдельный бонус — оно лишь синхронизирует уже автоматический доход.
app.post("/api/collect", auth, async (req, res) => {
  try {
    const result = await rpc("settle_passive_income_v40", {
      p_telegram_id: req.tgUser.id
    });
    const state = await innerState(req);
    res.json({
      message: result.earned > 0
        ? `Автодоход начислен: +${Number(result.earned).toLocaleString("ru-RU")} ₽`
        : "Пассивный доход начисляется автоматически",
      state
    });
  } catch (e) {
    res.status(400).json({ error: friendly(e) });
  }
});

app.use(async (req, res) => {
  try {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!["host", "content-length", "connection"].includes(k) && v !== undefined) headers[k] = v;
    }
    const method = req.method.toUpperCase();
    const init = { method, headers, redirect: "manual" };
    if (!["GET", "HEAD"].includes(method)) init.body = JSON.stringify(req.body ?? {});

    const r = await fetch(`http://127.0.0.1:${INTERNAL_PORT}${req.originalUrl}`, init);
    res.status(r.status);
    r.headers.forEach((v, k) => {
      if (!["content-encoding", "transfer-encoding", "connection", "content-length"].includes(k.toLowerCase())) {
        res.setHeader(k, v);
      }
    });
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.status(502).json({ error: "Внутренний сервис временно недоступен" });
  }
});

app.listen(PUBLIC_PORT, () => {
  console.log(`Business Zero v4.0 gateway on :${PUBLIC_PORT} -> ${INTERNAL_PORT}`);
});
