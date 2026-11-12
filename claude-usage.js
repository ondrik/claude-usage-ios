// Variables used by Scriptable.
// icon-color: deep-brown; icon-glyph: tachometer-alt;
//
// Claude usage widget for Scriptable (iOS).
// Shows the 5-hour session limit and the weekly limit of one or more Claude accounts.
//
// Setup:
//   1. For each account, on a computer with Claude Code: `claude setup-token`
//      -> copy the sk-ant-oat01-... token.
//   2. Run this script inside the Scriptable app and use "Add account" for each
//      token. Tokens are stored in the iOS Keychain.
//   3. Add a Scriptable widget (small / medium / large / lock-screen) and pick this
//      script. Leave "Parameter" empty to show all accounts, or put an account
//      name there to show just that one.
//
// Data source: undocumented anthropic-ratelimit-unified-* response headers of a
// 1-token request (each refresh uses a few tokens of your quota); may change.

const ACCOUNTS_KEY = "claude_usage_accounts";
const LEGACY_KEY = "claude_usage_oauth_token"; // single-token storage of v1
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

// ---------- accounts ----------

function saveAccounts(accounts) {
  Keychain.set(ACCOUNTS_KEY, JSON.stringify(accounts));
}

function loadAccounts() {
  let accounts = [];
  if (Keychain.contains(ACCOUNTS_KEY)) {
    try { accounts = JSON.parse(Keychain.get(ACCOUNTS_KEY)) || []; } catch (e) {}
  }
  if (Keychain.contains(LEGACY_KEY)) { // migrate the single token from v1
    const t = Keychain.get(LEGACY_KEY);
    if (t && !accounts.some((a) => a.token === t)) accounts.push({ name: "Claude", token: t });
    saveAccounts(accounts);
    Keychain.remove(LEGACY_KEY);
  }
  return accounts;
}

// ---------- data ----------

function cachePath() {
  const fm = FileManager.local();
  return fm.joinPath(fm.cacheDirectory(), CACHE_FILE);
}

function readCache() {
  try {
    const fm = FileManager.local();
    const p = cachePath();
    if (fm.fileExists(p)) {
      const c = JSON.parse(fm.readString(p));
      if (c && !c.session) return c; // ignore v1 single-account cache
    }
  } catch (e) {}
  return {};
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
  if (res.statusCode === 401) throw new Error("Invalid or revoked token (HTTP 401).");
  if (!session && !weekly) throw new Error(`HTTP ${res.statusCode}: ${body.slice(0, 120)}`);
  return { session, weekly, fetchedAt: new Date().toISOString() };
}

// Fetch all accounts in parallel; fall back to cached values on failure.
async function loadAll(accounts) {
  const cache = readCache();
  const results = await Promise.all(accounts.map(async (a) => {
    try {
      return { name: a.name, ...(await fetchUsage(a.token)) };
    } catch (e) {
      const error = String(e.message || e);
      const c = cache[a.name];
      return c ? { ...c, name: a.name, stale: true, error } : { name: a.name, error };
    }
  }));
  for (const r of results) if (!r.error) cache[r.name] = r;
  writeCache(cache);
  return results;
}

// ---------- formatting ----------

function colorFor(pct) {
  if (pct >= 90) return COLORS.crit;
  if (pct >= 70) return COLORS.warn;
  return COLORS.ok;
}

function timeLeft(iso, compact) {
  if (!iso) return "";
  const s = (new Date(iso) - new Date()) / 1000;
  if (s <= 0) return "now";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  const sep = compact ? "" : " ";
  if (d > 0) return `${d}d${sep}${h}h`;
  if (h > 0) return `${h}h${sep}${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

function pctText(w) {
  return w ? `${Math.round(w.pct)}%` : "–";
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

// ---------- shared widget pieces ----------

function newWidget(padding) {
  const w = new ListWidget();
  w.backgroundColor = COLORS.bg;
  w.setPadding(...padding);
  return w;
}

function footer(w, label, items) {
  w.addSpacer();
  const stale = items.some((d) => d.stale || (d.error && !d.session));
  const times = items.filter((d) => d.fetchedAt).map((d) => new Date(d.fetchedAt));
  const f = w.addStack();
  const t = f.addText(`${stale ? "⚠︎ " : ""}${label} · `);
  t.font = Font.systemFont(9);
  t.textColor = stale ? COLORS.warn : COLORS.dim;
  t.lineLimit = 1;
  if (times.length) {
    const d = f.addDate(new Date(Math.min(...times)));
    d.applyTimeStyle();
    d.font = Font.systemFont(9);
    d.textColor = COLORS.dim;
  }
}

function messageWidget(title, msg) {
  const w = newWidget([14, 14, 14, 14]);
  const t = w.addText(title);
  t.font = Font.boldSystemFont(13);
  t.textColor = COLORS.fg;
  w.addSpacer(6);
  const e = w.addText(msg);
  e.font = Font.systemFont(10);
  e.textColor = COLORS.crit;
  e.minimumScaleFactor = 0.6;
  return w;
}

function accessoryMessage(msg) {
  const w = new ListWidget();
  const t = w.addText(msg);
  t.font = Font.systemFont(11);
  t.minimumScaleFactor = 0.6;
  return w;
}

// ---------- single-account widgets ----------

function addRow(stack, label, win, barWidth) {
  const pct = win ? win.pct : 0;
  const head = stack.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();
  const l = head.addText(label);
  l.font = Font.semiboldSystemFont(12);
  l.textColor = COLORS.dim;
  head.addSpacer();
  const v = head.addText(pctText(win));
  v.font = Font.boldRoundedSystemFont(16);
  v.textColor = win ? colorFor(pct) : COLORS.dim;
  stack.addSpacer(3);
  const img = stack.addImage(barImage(pct, barWidth, 7));
  img.imageSize = new Size(barWidth, 7);
  stack.addSpacer(2);
  const r = stack.addText(win && win.resetsAt ? `resets in ${timeLeft(win.resetsAt)}` : " ");
  r.font = Font.systemFont(10);
  r.textColor = COLORS.dim;
}

function singleSmall(d) {
  if (!d.session && d.error) return messageWidget(d.name, d.error);
  const w = newWidget([14, 14, 10, 14]);
  addRow(w, "Session", d.session, 128);
  w.addSpacer(8);
  addRow(w, "Weekly", d.weekly, 128);
  footer(w, d.name, [d]);
  return w;
}

function singleMedium(d) {
  if (!d.session && d.error) return messageWidget(d.name, d.error);
  const w = newWidget([14, 16, 10, 16]);
  const row = w.addStack();
  row.layoutHorizontally();
  const cols = [["5-hour session", d.session], ["Weekly", d.weekly]];
  cols.forEach(([label, win], i) => {
    const col = row.addStack();
    col.layoutVertically();
    col.centerAlignContent();
    const pct = win ? win.pct : 0;
    const ringStack = col.addStack();
    ringStack.size = new Size(72, 72);
    ringStack.backgroundImage = ringImage(pct, 72, 8, colorFor(pct), COLORS.track);
    ringStack.centerAlignContent();
    const v = ringStack.addText(pctText(win));
    v.font = Font.boldRoundedSystemFont(18);
    v.textColor = COLORS.fg;
    col.addSpacer(4);
    const l = col.addText(label);
    l.font = Font.semiboldSystemFont(11);
    l.textColor = COLORS.fg;
    const r = col.addText(win && win.resetsAt ? `resets ${timeLeft(win.resetsAt)}` : " ");
    r.font = Font.systemFont(10);
    r.textColor = COLORS.dim;
    if (i < cols.length - 1) row.addSpacer();
  });
  footer(w, d.name, [d]);
  return w;
}

function singleAccessoryRect(d) {
  if (!d.session) return accessoryMessage(`${d.name}: ${d.error || "no data"}`);
  const w = new ListWidget();
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
    const v = s.addText(pctText(win));
    v.font = Font.boldRoundedSystemFont(12);
  };
  line("5h", d.session);
  line("7d", d.weekly);
  const r = w.addText(`${d.name} · ${d.session.resetsAt ? timeLeft(d.session.resetsAt) : ""}`);
  r.font = Font.systemFont(10);
  r.lineLimit = 1;
  return w;
}

function singleAccessoryCircular(d) {
  const w = new ListWidget();
  const pct = d.session ? d.session.pct : 0;
  const s = w.addStack();
  s.size = new Size(58, 58);
  s.backgroundImage = ringImage(pct, 58, 6, Color.white(), new Color("#FFFFFF", 0.25));
  s.centerAlignContent();
  const t = s.addText(d.session ? `${Math.round(pct)}` : "–");
  t.font = Font.boldRoundedSystemFont(16);
  return w;
}

// ---------- multi-account widgets ----------

function cell(row, text, width, font, color) {
  const c = row.addStack();
  c.size = new Size(width, 0);
  c.addSpacer();
  const t = c.addText(text);
  t.font = font;
  t.textColor = color;
  t.lineLimit = 1;
  return t;
}

// Small: one line per account with the two percentages.
function multiSmall(items) {
  const w = newWidget([12, 14, 10, 14]);
  const head = w.addStack();
  head.centerAlignContent();
  const ht = head.addText("Claude");
  ht.font = Font.semiboldSystemFont(11);
  ht.textColor = COLORS.dim;
  head.addSpacer();
  cell(head, "5h", 36, Font.semiboldSystemFont(10), COLORS.dim);
  cell(head, "7d", 36, Font.semiboldSystemFont(10), COLORS.dim);
  w.addSpacer(4);
  const shown = items.slice(0, 5);
  for (const d of shown) {
    const row = w.addStack();
    row.centerAlignContent();
    const n = row.addText(d.name);
    n.font = Font.mediumSystemFont(12);
    n.textColor = d.stale || !d.session ? COLORS.warn : COLORS.fg;
    n.lineLimit = 1;
    row.addSpacer();
    for (const win of [d.session, d.weekly]) {
      cell(row, pctText(win), 36, Font.boldRoundedSystemFont(13), win ? colorFor(win.pct) : COLORS.dim);
    }
    w.addSpacer(3);
  }
  if (items.length > shown.length) {
    const more = w.addText(`+${items.length - shown.length} more`);
    more.font = Font.systemFont(9);
    more.textColor = COLORS.dim;
  }
  footer(w, "Claude", items);
  return w;
}

// Medium / large: name on one line, two bars with percentages and reset times below.
function multiList(items, maxRows) {
  const w = newWidget([12, 16, 10, 16]);
  const shown = items.slice(0, maxRows);
  shown.forEach((d, i) => {
    const head = w.addStack();
    head.centerAlignContent();
    const n = head.addText(d.name);
    n.font = Font.semiboldSystemFont(12);
    n.textColor = COLORS.fg;
    n.lineLimit = 1;
    head.addSpacer();
    if (d.error) {
      const e = head.addText(d.stale ? "⚠︎ offline" : "⚠︎ error");
      e.font = Font.systemFont(9);
      e.textColor = d.stale ? COLORS.warn : COLORS.crit;
    }
    w.addSpacer(2);
    const row = w.addStack();
    row.centerAlignContent();
    if (!d.session && !d.weekly) {
      const e = row.addText(d.error || "no data");
      e.font = Font.systemFont(9);
      e.textColor = COLORS.crit;
      e.lineLimit = 1;
      e.minimumScaleFactor = 0.7;
    } else {
      [["5h", d.session], ["7d", d.weekly]].forEach(([label, win], j) => {
        const l = row.addText(label);
        l.font = Font.semiboldSystemFont(10);
        l.textColor = COLORS.dim;
        row.addSpacer(3);
        const img = row.addImage(barImage(win ? win.pct : 0, 44, 6));
        img.imageSize = new Size(44, 6);
        cell(row, pctText(win), 34, Font.boldRoundedSystemFont(11), win ? colorFor(win.pct) : COLORS.dim);
        const r = row.addText(win && win.resetsAt ? ` ${timeLeft(win.resetsAt, true)}` : "");
        r.font = Font.systemFont(9);
        r.textColor = COLORS.dim;
        r.lineLimit = 1;
        if (j === 0) row.addSpacer();
      });
    }
    if (i < shown.length - 1) w.addSpacer(6);
  });
  if (items.length > shown.length) {
    w.addSpacer(4);
    const more = w.addText(`+${items.length - shown.length} more`);
    more.font = Font.systemFont(9);
    more.textColor = COLORS.dim;
  }
  footer(w, "Claude", items);
  return w;
}

function multiAccessoryRect(items) {
  const w = new ListWidget();
  for (const d of items.slice(0, 3)) {
    const s = w.addStack();
    const n = s.addText(d.name);
    n.font = Font.semiboldSystemFont(12);
    n.lineLimit = 1;
    s.addSpacer();
    const v = s.addText(d.session || d.weekly ? `${pctText(d.session)} · ${pctText(d.weekly)}` : "–");
    v.font = Font.boldRoundedSystemFont(12);
  }
  return w;
}

// ---------- rendering ----------

async function buildWidget(family, param) {
  const accessory = family.startsWith("accessory");
  const accounts = loadAccounts();
  if (!accounts.length) {
    const msg = "No accounts – run the script in Scriptable to add one.";
    return accessory ? accessoryMessage(msg) : messageWidget("Claude usage", msg);
  }
  let selected = accounts;
  if (param && param.trim()) {
    const p = param.trim().toLowerCase();
    selected = accounts.filter((a) => a.name.toLowerCase() === p);
    if (!selected.length) {
      const msg = `No account named "${param.trim()}".`;
      return accessory ? accessoryMessage(msg) : messageWidget("Claude usage", msg);
    }
  } else if (family === "accessoryCircular") {
    selected = [accounts[0]]; // only room for one
  }
  const items = await loadAll(selected);

  if (items.length === 1) {
    const d = items[0];
    switch (family) {
      case "accessoryRectangular": return singleAccessoryRect(d);
      case "accessoryCircular": return singleAccessoryCircular(d);
      case "small": return singleSmall(d);
      default: return singleMedium(d);
    }
  }
  switch (family) {
    case "accessoryRectangular": return multiAccessoryRect(items);
    case "small": return multiSmall(items);
    case "large": case "extraLarge": return multiList(items, 7);
    default: return multiList(items, 3);
  }
}

// ---------- account management (in-app) ----------

async function choose(title, message, options) {
  const a = new Alert();
  a.title = title;
  if (message) a.message = message;
  for (const o of options) a.addAction(o);
  a.addCancelAction("Back");
  return await a.presentSheet();
}

async function info(title, message) {
  const a = new Alert();
  a.title = title;
  a.message = message;
  a.addAction("OK");
  await a.present();
}

async function promptToken(title, message, name) {
  const a = new Alert();
  a.title = title;
  a.message = message;
  if (name !== undefined) a.addTextField("Name (e.g. Work)", name);
  a.addSecureTextField("sk-ant-oat01-…", "");
  a.addAction("Save");
  a.addCancelAction("Cancel");
  if ((await a.present()) === -1) return null;
  const vals = [];
  for (let i = 0; i < (name !== undefined ? 2 : 1); i++) vals.push(a.textFieldValue(i).trim());
  return name !== undefined ? { name: vals[0], token: vals[1] } : { token: vals[0] };
}

// Test a token before saving it; returns true if it should be saved.
async function checkToken(token) {
  try {
    const d = await fetchUsage(token);
    await info("Token works", `Session ${pctText(d.session)}, weekly ${pctText(d.weekly)}.`);
    return true;
  } catch (e) {
    const a = new Alert();
    a.title = "Token check failed";
    a.message = String(e.message || e);
    a.addAction("Save anyway");
    a.addCancelAction("Cancel");
    return (await a.present()) === 0;
  }
}

async function addAccount(accounts) {
  const v = await promptToken("Add account", "Paste a token from `claude setup-token`.", "");
  if (!v) return;
  if (!v.name || !v.token) return info("Missing value", "Both a name and a token are needed.");
  if (accounts.some((a) => a.name.toLowerCase() === v.name.toLowerCase())) {
    return info("Name taken", `There already is an account named "${v.name}".`);
  }
  if (!(await checkToken(v.token))) return;
  accounts.push({ name: v.name, token: v.token });
  saveAccounts(accounts);
}

async function manageAccount(accounts, idx) {
  const acc = accounts[idx];
  const opts = ["Rename", "Replace token"];
  if (idx > 0) opts.push("Move up");
  opts.push("Delete");
  const i = await choose(acc.name, null, opts);
  if (i === -1) return;
  const op = opts[i];
  if (op === "Rename") {
    const a = new Alert();
    a.title = "Rename";
    a.addTextField("Name", acc.name);
    a.addAction("Save");
    a.addCancelAction("Cancel");
    if ((await a.present()) === -1) return;
    const name = a.textFieldValue(0).trim();
    if (!name) return;
    if (accounts.some((x, j) => j !== idx && x.name.toLowerCase() === name.toLowerCase())) {
      return info("Name taken", `There already is an account named "${name}".`);
    }
    acc.name = name;
  } else if (op === "Replace token") {
    const v = await promptToken("Replace token", `New token for "${acc.name}".`);
    if (!v || !v.token || !(await checkToken(v.token))) return;
    acc.token = v.token;
  } else if (op === "Move up") {
    [accounts[idx - 1], accounts[idx]] = [accounts[idx], accounts[idx - 1]];
  } else if (op === "Delete") {
    const a = new Alert();
    a.title = `Delete "${acc.name}"?`;
    a.addDestructiveAction("Delete");
    a.addCancelAction("Cancel");
    if ((await a.present()) === -1) return;
    accounts.splice(idx, 1);
  }
  saveAccounts(accounts);
}

async function mainMenu() {
  for (;;) {
    const accounts = loadAccounts();
    const opts = [];
    if (accounts.length) opts.push("Preview small", "Preview medium", "Preview large");
    opts.push("Add account");
    if (accounts.length) opts.push("Manage accounts");
    const msg = accounts.length ? `Accounts: ${accounts.map((a) => a.name).join(", ")}` : "No accounts yet.";
    const i = await choose("Claude usage", msg, opts);
    if (i === -1) return;
    const op = opts[i];
    if (op.startsWith("Preview")) {
      const family = op.split(" ")[1];
      const widget = await buildWidget(family, args.widgetParameter);
      if (family === "small") await widget.presentSmall();
      else if (family === "large") await widget.presentLarge();
      else await widget.presentMedium();
    } else if (op === "Add account") {
      await addAccount(accounts);
    } else {
      const j = await choose("Manage accounts", null, accounts.map((a) => a.name));
      if (j !== -1) await manageAccount(accounts, j);
    }
  }
}

// ---------- main ----------

if (config.runsInWidget) {
  const widget = await buildWidget(config.widgetFamily || "medium", args.widgetParameter);
  widget.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60 * 1000);
  Script.setWidget(widget);
} else {
  await mainMenu();
}
Script.complete();
