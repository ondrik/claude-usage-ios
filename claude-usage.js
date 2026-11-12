// Variables used by Scriptable.
// icon-color: deep-brown; icon-glyph: tachometer-alt;
//
// Claude usage widget for Scriptable (iOS).
// Shows the 5-hour session limit and the weekly limit of your Claude plan.
//
// Setup:
//   1. On a computer with Claude Code: `claude setup-token` -> copy the sk-ant-oat01-... token.
//   2. Run this script once inside the Scriptable app; it asks for the token and
//      stores it in the iOS Keychain. Run it again to view/replace the token.
//   3. Add a Scriptable widget (small / medium / lock-screen) and pick this script.
//
// Data source: undocumented anthropic-ratelimit-unified-* response headers of a
// 1-token request (each refresh uses a few tokens of your quota); may change.

const KEYCHAIN_KEY = "claude_usage_oauth_token";
const CACHE_FILE = "claude-usage-cache.json";
const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const PING_MODEL = "claude-haiku-5-5";
const REFRESH_MINUTES = 15;

const COLORS = {
  bg: Color.dynamic(new Color("#F5F1EA"), new Color("#1F1E1C")),
  fg: Color.dynamic(new Color("#1F1E1C"), new Color("#F5F1EA")),
  dim: Color.dynamic(new Color("#7A766E"), new Color("#9A958C")),
  track: Color.dynamic(new Color("#E3DDD2"), new Color("#3A3835")),
  ok: new Color("#D97757"),     // Claude orange
  warn: new Color("#E0A030"),
  crit: new Color("#D64545"),
};

// ---------- data ----------

async function getToken() {
  if (Keychain.contains(KEYCHAIN_KEY)) return Keychain.get(KEYCHAIN_KEY);
  if (config.runsInWidget) return null;
  return await askToken();
}

async function askToken() {
  const a = new Alert();
  a.title = "Claude token";
  a.message = "Paste the token from `claude setup-token` (sk-ant-oat01-…).";
  a.addSecureTextField("sk-ant-oat01-…", "");
  a.addAction("Save");
  a.addCancelAction("Cancel");
  if ((await a.present()) === -1) return null;
  const t = a.textFieldValue(0).trim();
  if (t) Keychain.set(KEYCHAIN_KEY, t);
  return t || null;
}

function cachePath() {
  const fm = FileManager.local();
  return fm.joinPath(fm.cacheDirectory(), CACHE_FILE);
}

function readCache() {
  try {
    const fm = FileManager.local();
    const p = cachePath();
    if (fm.fileExists(p)) return JSON.parse(fm.readString(p));
  } catch (e) {}
  return null;
}

function writeCache(obj) {
  try { FileManager.local().writeString(cachePath(), JSON.stringify(obj)); } catch (e) {}
}

// Send a 1-token Haiku request and read the unified rate-limit headers from the
// response (works with `claude setup-token` tokens, which only have user:inference).
async function fetchUsage(token) {
  const req = new Request(MESSAGES_URL);
  req.method = "POST";
  req.headers = {
    "Authorization": `Bearer ${token}`,
    "anthropic-beta": "oauth-2025-04-20",
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  };
  req.body = JSON.stringify({
    model: PING_MODEL,
    max_tokens: 1,
    system: "You are Claude Code, Anthropic's official CLI for Claude.",
    messages: [{ role: "user", content: "hi" }],
  });
  req.timeoutInterval = 20;
  const body = await req.loadString();
  const res = req.response || {};
  const h = {};
  for (const [k, v] of Object.entries(res.headers || {})) h[k.toLowerCase()] = v;
  const win = (name) => {
    const u = h[`anthropic-ratelimit-unified-${name}-utilization`];
    const r = h[`anthropic-ratelimit-unified-${name}-reset`];
    if (u === undefined) return null;
    return {
      pct: Number(u) * 100,
      resetsAt: r ? new Date(Number(r) * 1000).toISOString() : null,
    };
  };
  const session = win("5h"), weekly = win("7d");
  if (!session && !weekly) throw new Error(`HTTP ${res.statusCode}: ${body.slice(0, 120)}`);
  return { session, weekly, fetchedAt: new Date().toISOString() };
}

async function loadData() {
  const token = await getToken();
  if (!token) return { error: "No token – run the script in Scriptable to set it." };
  try {
    const d = await fetchUsage(token);
    writeCache(d);
    return d;
  } catch (e) {
    const c = readCache();
    if (c) return { ...c, stale: true, error: String(e.message || e) };
    return { error: String(e.message || e) };
  }
}

// ---------- formatting ----------

function colorFor(pct) {
  if (pct >= 90) return COLORS.crit;
  if (pct >= 70) return COLORS.warn;
  return COLORS.ok;
}

function timeLeft(iso) {
  if (!iso) return "";
  const s = (new Date(iso) - new Date()) / 1000;
  if (s <= 0) return "now";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

function barImage(pct, width, height) {
  const ctx = new DrawContext();
  ctx.size = new Size(width, height);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const r = height / 2;
  const track = new Path();
  track.addRoundedRect(new Rect(0, 0, width, height), r, r);
  ctx.addPath(track);
  ctx.setFillColor(COLORS.track);
  ctx.fillPath();
  const w = Math.max(height, (width * Math.min(100, Math.max(0, pct))) / 100);
  if (pct > 0) {
    const fill = new Path();
    fill.addRoundedRect(new Rect(0, 0, w, height), r, r);
    ctx.addPath(fill);
    ctx.setFillColor(colorFor(pct));
    ctx.fillPath();
  }
  return ctx.getImage();
}

function ringImage(pct, size, lineWidth, color, trackColor) {
  const ctx = new DrawContext();
  ctx.size = new Size(size, size);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const c = size / 2, rad = c - lineWidth / 2;
  const drawArc = (from, to, col) => {
    const steps = Math.max(2, Math.ceil((to - from) * 120));
    const p = new Path();
    for (let i = 0; i <= steps; i++) {
      const a = -Math.PI / 2 + 2 * Math.PI * (from + ((to - from) * i) / steps);
      const pt = new Point(c + rad * Math.cos(a), c + rad * Math.sin(a));
      i === 0 ? p.move(pt) : p.addLine(pt);
    }
    ctx.addPath(p);
    ctx.setStrokeColor(col);
    ctx.setLineWidth(lineWidth);
    ctx.strokePath();
  };
  drawArc(0, 1, trackColor);
  const f = Math.min(1, Math.max(0, pct / 100));
  if (f > 0) drawArc(0, f, color);
  return ctx.getImage();
}

// ---------- widgets ----------

function addRow(stack, label, w, barWidth) {
  const pct = w ? w.pct : 0;
  const head = stack.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();
  const l = head.addText(label);
  l.font = Font.semiboldSystemFont(12);
  l.textColor = COLORS.dim;
  head.addSpacer();
  const v = head.addText(w ? `${Math.round(pct)}%` : "–");
  v.font = Font.boldRoundedSystemFont(16);
  v.textColor = w ? colorFor(pct) : COLORS.dim;
  stack.addSpacer(3);
  const img = stack.addImage(barImage(pct, barWidth, 7));
  img.imageSize = new Size(barWidth, 7);
  stack.addSpacer(2);
  const r = stack.addText(w && w.resetsAt ? `resets in ${timeLeft(w.resetsAt)}` : " ");
  r.font = Font.systemFont(10);
  r.textColor = COLORS.dim;
}

function footer(w, data) {
  w.addSpacer();
  const f = w.addStack();
  const t = f.addText(data.stale ? "⚠︎ offline · " : "Claude · ");
  t.font = Font.systemFont(9);
  t.textColor = data.stale ? COLORS.warn : COLORS.dim;
  if (data.fetchedAt) {
    const d = f.addDate(new Date(data.fetchedAt));
    d.applyTimeStyle();
    d.font = Font.systemFont(9);
    d.textColor = COLORS.dim;
  }
}

function errorWidget(w, msg) {
  const t = w.addText("Claude usage");
  t.font = Font.boldSystemFont(13);
  t.textColor = COLORS.fg;
  w.addSpacer(6);
  const e = w.addText(msg);
  e.font = Font.systemFont(10);
  e.textColor = COLORS.crit;
  e.minimumScaleFactor = 0.6;
}

function buildSmall(data) {
  const w = new ListWidget();
  w.backgroundColor = COLORS.bg;
  w.setPadding(14, 14, 10, 14);
  if (!data.session && data.error) { errorWidget(w, data.error); return w; }
  addRow(w, "Session", data.session, 128);
  w.addSpacer(8);
  addRow(w, "Weekly", data.weekly, 128);
  footer(w, data);
  return w;
}

function buildMedium(data) {
  const w = new ListWidget();
  w.backgroundColor = COLORS.bg;
  w.setPadding(14, 16, 10, 16);
  if (!data.session && data.error) { errorWidget(w, data.error); return w; }
  const row = w.addStack();
  row.layoutHorizontally();
  for (const [label, win] of [["5-hour session", data.session], ["Weekly", data.weekly]]) {
    const col = row.addStack();
    col.layoutVertically();
    col.centerAlignContent();
    const pct = win ? win.pct : 0;
    const ringStack = col.addStack();
    ringStack.size = new Size(72, 72);
    ringStack.backgroundImage = ringImage(pct, 72, 8, colorFor(pct), COLORS.track);
    ringStack.centerAlignContent();
    const v = ringStack.addText(win ? `${Math.round(pct)}%` : "–");
    v.font = Font.boldRoundedSystemFont(18);
    v.textColor = COLORS.fg;
    col.addSpacer(4);
    const l = col.addText(label);
    l.font = Font.semiboldSystemFont(11);
    l.textColor = COLORS.fg;
    const r = col.addText(win && win.resetsAt ? `resets ${timeLeft(win.resetsAt)}` : " ");
    r.font = Font.systemFont(10);
    r.textColor = COLORS.dim;
    if (label !== "Weekly") row.addSpacer();
  }
  footer(w, data);
  return w;
}

function buildAccessoryRect(data) {
  const w = new ListWidget();
  if (!data.session) {
    const t = w.addText("Claude: " + (data.error || "no data"));
    t.font = Font.systemFont(11);
    return w;
  }
  const line = (label, win) => {
    const s = w.addStack();
    s.centerAlignContent();
    const l = s.addText(label);
    l.font = Font.semiboldSystemFont(12);
    s.addSpacer(4);
    const img = s.addImage(barImage(win ? win.pct : 0, 60, 6));
    img.imageSize = new Size(60, 6);
    img.tintColor = Color.white();
    s.addSpacer(4);
    const v = s.addText(win ? `${Math.round(win.pct)}%` : "–");
    v.font = Font.boldRoundedSystemFont(12);
  };
  line("5h", data.session);
  line("7d", data.weekly);
  const r = w.addText(data.session.resetsAt ? `session resets ${timeLeft(data.session.resetsAt)}` : "");
  r.font = Font.systemFont(10);
  return w;
}

function buildAccessoryCircular(data) {
  const w = new ListWidget();
  const pct = data.session ? data.session.pct : 0;
  const s = w.addStack();
  s.size = new Size(58, 58);
  s.backgroundImage = ringImage(pct, 58, 6, Color.white(), new Color("#FFFFFF", 0.25));
  s.centerAlignContent();
  const t = s.addText(data.session ? `${Math.round(pct)}` : "–");
  t.font = Font.boldRoundedSystemFont(16);
  return w;
}

// ---------- main ----------

if (!config.runsInWidget && Keychain.contains(KEYCHAIN_KEY)) {
  const a = new Alert();
  a.title = "Claude usage";
  a.addAction("Preview widget");
  a.addAction("Replace token");
  a.addDestructiveAction("Delete token");
  a.addCancelAction("Cancel");
  const choice = await a.present();
  if (choice === 1) await askToken();
  if (choice === 2) { Keychain.remove(KEYCHAIN_KEY); Script.complete(); return; }
  if (choice === -1) { Script.complete(); return; }
}

const data = await loadData();
const family = config.widgetFamily || "medium";
let widget;
switch (family) {
  case "accessoryRectangular": widget = buildAccessoryRect(data); break;
  case "accessoryCircular": widget = buildAccessoryCircular(data); break;
  case "small": widget = buildSmall(data); break;
  default: widget = buildMedium(data);
}
widget.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60 * 1000);

if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();
Script.complete();
