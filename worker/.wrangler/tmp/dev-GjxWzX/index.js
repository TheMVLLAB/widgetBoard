var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/aggregate.ts
var DATE_TYPES = /* @__PURE__ */ new Set(["date", "created_time", "last_edited_time"]);
var NUMBER_TYPES = /* @__PURE__ */ new Set(["number", "formula", "rollup"]);
var CATEGORY_TYPES = /* @__PURE__ */ new Set(["select", "status", "multi_select", "checkbox"]);
var DAY = /^\d{4}-\d{2}-\d{2}$/;
function validDate(s) {
  return !s || DAY.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && (/* @__PURE__ */ new Date(`${s}T00:00:00Z`)).toISOString().slice(0, 10) === s;
}
__name(validDate, "validDate");
function parseChartRequest(x) {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("\uC124\uC815\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  const input = x;
  const get = /* @__PURE__ */ __name((key, max = 128) => typeof input[key] === "string" ? input[key].trim().slice(0, max) : "", "get");
  const sourceKey2 = get("sourceKey", 40), dateFieldId = get("dateFieldId"), valueFieldId = get("valueFieldId"), categoryFieldId = get("categoryFieldId");
  const groupBy = get("groupBy"), aggregate = get("aggregate");
  const dateFrom = get("dateFrom", 10), dateTo = get("dateTo", 10);
  if (!/^[a-zA-Z][\w-]{0,39}$/.test(sourceKey2) || !["month", "day", "category"].includes(groupBy) || !["sum", "count", "avg"].includes(aggregate)) throw new Error("\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 \uCC28\uD2B8 \uC124\uC815\uC785\uB2C8\uB2E4.");
  if (!validDate(dateFrom) || !validDate(dateTo) || dateFrom && dateTo && dateFrom > dateTo) throw new Error("\uB0A0\uC9DC \uBC94\uC704\uAC00 \uC798\uBABB\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
  if (dateFrom && dateTo && (Date.parse(dateTo) - Date.parse(dateFrom)) / 864e5 > 366) throw new Error("\uCD5C\uB300 366\uC77C \uBC94\uC704\uB9CC \uC870\uD68C\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
  return { sourceKey: sourceKey2, dateFieldId, valueFieldId, categoryFieldId, groupBy, aggregate, dateFrom, dateTo };
}
__name(parseChartRequest, "parseChartRequest");
function validateFields(cfg, fields) {
  const byId = /* @__PURE__ */ __name((id) => fields.find((p) => p.id === id), "byId");
  if (cfg.groupBy !== "category" || cfg.dateFrom || cfg.dateTo) {
    const date = byId(cfg.dateFieldId);
    if (!date || !DATE_TYPES.has(date.type)) throw new Error("\uB0A0\uC9DC \uC18D\uC131\uC744 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.");
  }
  if (cfg.groupBy === "category") {
    const category = byId(cfg.categoryFieldId);
    if (!category || !CATEGORY_TYPES.has(category.type)) throw new Error("\uCE74\uD14C\uACE0\uB9AC \uC18D\uC131\uC744 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.");
  }
  if (cfg.aggregate !== "count") {
    const value = byId(cfg.valueFieldId);
    if (!value || !NUMBER_TYPES.has(value.type)) throw new Error("\uC22B\uC790 \uC18D\uC131\uC744 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.");
  }
}
__name(validateFields, "validateFields");
function property(page, id) {
  return Object.values(page.properties || {}).find((p) => p?.id === id);
}
__name(property, "property");
function getDate(page, id) {
  if (id === "__created_time") return page.created_time?.slice(0, 10) || null;
  if (id === "__last_edited_time") return page.last_edited_time?.slice(0, 10) || null;
  const p = property(page, id);
  if (!p) return null;
  if (p.type === "date") return p.date?.start?.slice(0, 10) || null;
  return null;
}
__name(getDate, "getDate");
function getNumber(page, id) {
  const p = property(page, id);
  if (!p) return null;
  const v = p.type === "number" ? p.number : p.type === "formula" ? p.formula?.number : p.type === "rollup" ? p.rollup?.number : null;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
__name(getNumber, "getNumber");
function getCategories(page, id) {
  const p = property(page, id);
  if (!p) return ["\uBBF8\uBD84\uB958"];
  if (p.type === "select") return [p.select?.name || "\uBBF8\uBD84\uB958"];
  if (p.type === "status") return [p.status?.name || "\uBBF8\uBD84\uB958"];
  if (p.type === "checkbox") return [p.checkbox ? "\uC644\uB8CC" : "\uBBF8\uC644\uB8CC"];
  if (p.type === "multi_select") return p.multi_select?.length ? p.multi_select.map((t) => t.name) : ["\uBBF8\uBD84\uB958"];
  return ["\uBBF8\uBD84\uB958"];
}
__name(getCategories, "getCategories");
function aggregatePages(pages, cfg) {
  const groups = /* @__PURE__ */ new Map();
  let recordCount = 0;
  for (const page of pages) {
    const date = cfg.dateFieldId ? getDate(page, cfg.dateFieldId) : null;
    if ((cfg.groupBy !== "category" || cfg.dateFrom || cfg.dateTo) && !date) continue;
    if (cfg.dateFrom && date < cfg.dateFrom || cfg.dateTo && date > cfg.dateTo) continue;
    const n = cfg.aggregate === "count" ? 1 : getNumber(page, cfg.valueFieldId);
    if (n === null) continue;
    const labels = cfg.groupBy === "category" ? [...new Set(getCategories(page, cfg.categoryFieldId))] : [cfg.groupBy === "month" ? date.slice(0, 7) : date];
    recordCount++;
    for (const label of labels) {
      const old = groups.get(label) || { total: 0, count: 0 };
      groups.set(label, { total: old.total + n, count: old.count + 1 });
    }
  }
  if (groups.size > 36) throw new Error("\uADF8\uB8F9\uC774 36\uAC1C\uB97C \uCD08\uACFC\uD569\uB2C8\uB2E4. \uAE30\uAC04\uC774\uB098 \uBD84\uB958\uB97C \uC904\uC5EC \uC8FC\uC138\uC694.");
  const data = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "ko")).map(([label, s]) => ({ label, value: cfg.aggregate === "avg" ? Number((s.total / s.count).toFixed(2)) : s.total }));
  return { data, recordCount, groupCount: data.length };
}
__name(aggregatePages, "aggregatePages");
function fieldsFromSchema(dataSource) {
  const props = Object.entries(dataSource.properties || {}).map(([name, p]) => ({ id: String(p.id || name), name, type: String(p.type || "unknown") }));
  return [...props, { id: "__created_time", name: "\uC0DD\uC131\uC77C", type: "created_time" }, { id: "__last_edited_time", name: "\uC218\uC815\uC77C", type: "last_edited_time" }];
}
__name(fieldsFromSchema, "fieldsFromSchema");

// src/oauth.ts
var encoder = new TextEncoder();
function randomToken(bytes = 32) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}
__name(randomToken, "randomToken");
function epoch() {
  return Math.floor(Date.now() / 1e3);
}
__name(epoch, "epoch");
async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
}
__name(sha256, "sha256");
function keyBytes(hex) {
  if (!/^[a-f0-9]{64}$/i.test(hex)) throw new Error("TOKEN_ENCRYPTION_KEY must be 64 hexadecimal characters");
  return new Uint8Array(hex.match(/../g).map((x) => parseInt(x, 16)));
}
__name(keyBytes, "keyBytes");
async function encrypt(plaintext, hexKey) {
  const key = await crypto.subtle.importKey("raw", keyBytes(hexKey), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const result = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plaintext)));
  return `v1:${Array.from(iv, (b) => b.toString(16).padStart(2, "0")).join("")}:${Array.from(result, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
__name(encrypt, "encrypt");
async function decrypt(cipher, hexKey) {
  const [version, ivhex, datahex] = cipher.split(":");
  if (version !== "v1" || !/^[a-f0-9]{24}$/i.test(ivhex) || !datahex || !/^(?:[a-f0-9]{2})+$/i.test(datahex)) throw new Error("Invalid encrypted token");
  const key = await crypto.subtle.importKey("raw", keyBytes(hexKey), "AES-GCM", false, ["decrypt"]);
  const iv = new Uint8Array(ivhex.match(/../g).map((x) => parseInt(x, 16)));
  const data = new Uint8Array(datahex.match(/../g).map((x) => parseInt(x, 16)));
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data));
}
__name(decrypt, "decrypt");
async function exchangeNotionToken(clientId, clientSecret, body) {
  const response = await fetch("https://api.notion.com/v1/oauth/token", { method: "POST", headers: { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Notion OAuth failed (${response.status})`);
  const info = await response.json();
  if (!info.access_token || !info.refresh_token || !info.bot_id || !info.workspace_id) throw new Error("Notion OAuth token response is incomplete");
  return info;
}
__name(exchangeNotionToken, "exchangeNotionToken");

// src/index.ts
var API = "https://api.notion.com/v1";
var NOTION_VERSION = "2026-03-11";
var noStore = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" };
var ApiError = class extends Error {
  static {
    __name(this, "ApiError");
  }
  status;
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
};
var send = /* @__PURE__ */ __name((value, status = 200, headers) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...noStore, ...headers } }), "send");
function front(env) {
  const url = new URL(env.FRONTEND_URL);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost") || url.username || url.password || url.search || url.hash || url.pathname.includes("..")) throw new Error("Invalid FRONTEND_URL");
  return url;
}
__name(front, "front");
function checkEnv(env) {
  if (!env.DB || !env.NOTION_CLIENT_ID || !env.NOTION_CLIENT_SECRET || !env.NOTION_REDIRECT_URI || !env.TOKEN_ENCRYPTION_KEY || !env.FRONTEND_URL) return false;
  return /^[a-f0-9]{64}$/i.test(env.TOKEN_ENCRYPTION_KEY);
}
__name(checkEnv, "checkEnv");
function allowCors(resp, req, env) {
  const origin = req.headers.get("Origin");
  try {
    if (origin && origin === front(env).origin) {
      resp.headers.set("Access-Control-Allow-Origin", origin);
      resp.headers.set("Vary", "Origin");
    }
  } catch {
  }
  return resp;
}
__name(allowCors, "allowCors");
function guardOrigin(req, env) {
  const origin = req.headers.get("Origin");
  if (origin && origin !== front(env).origin) throw new ApiError("\uD5C8\uC6A9\uB418\uC9C0 \uC54A\uC740 \uCD9C\uCC98\uC785\uB2C8\uB2E4.", 403);
}
__name(guardOrigin, "guardOrigin");
async function bodyJson(req) {
  if (Number(req.headers.get("Content-Length") || 0) > 8192) throw new ApiError("\uC694\uCCAD \uD06C\uAE30 \uCD08\uACFC", 413);
  const str = await req.text();
  if (str.length > 8192) throw new ApiError("\uC694\uCCAD \uD06C\uAE30 \uCD08\uACFC", 413);
  try {
    return JSON.parse(str);
  } catch {
    throw new ApiError("JSON \uD615\uC2DD \uC624\uB958");
  }
}
__name(bodyJson, "bodyJson");
function pathPart(str) {
  return /^[a-f0-9-]{36}$/i.test(str);
}
__name(pathPart, "pathPart");
function sourceKey(id) {
  return "n" + id.replace(/-/g, "").toLowerCase();
}
__name(sourceKey, "sourceKey");
function sourceId(key) {
  if (!/^n[a-f0-9]{32}$/.test(key)) throw new ApiError("\uC798\uBABB\uB41C \uB370\uC774\uD130 \uC18C\uC2A4 ID");
  return key.slice(1).replace(/^(.{8})(.{4})(.{4})(.{4})(.*)$/, "$1-$2-$3-$4-$5");
}
__name(sourceId, "sourceId");
function redirectAuth(env, ticket) {
  const url = front(env);
  url.hash = `/auth/complete?ticket=${encodeURIComponent(ticket)}`;
  return new Response(null, { status: 302, headers: { Location: url.href, ...noStore } });
}
__name(redirectAuth, "redirectAuth");
function cookie(req, name) {
  const match = req.headers.get("Cookie")?.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"));
  return match?.[1] || "";
}
__name(cookie, "cookie");
function oauthCookie(value, env) {
  return `wp_oauth=${value}; HttpOnly; SameSite=Lax; Path=/api/auth/notion; Max-Age=${value ? 600 : 0}${new URL(env.NOTION_REDIRECT_URI).protocol === "https:" ? "; Secure" : ""}`;
}
__name(oauthCookie, "oauthCookie");
async function rateLimit(req, env, scope, max) {
  const ip = req.headers.get("CF-Connecting-IP") || "local-test";
  const hash = await sha256(`${scope}:${ip}`);
  const now = epoch(), start = now - now % 300;
  const row = await env.DB.prepare("INSERT INTO rate_windows(key,window_start,request_count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET request_count=CASE WHEN window_start<? THEN 1 ELSE request_count+1 END,window_start=excluded.window_start RETURNING request_count").bind(hash, start, start).first();
  if ((row?.request_count || 0) > max) throw new ApiError("\uC694\uCCAD\uC774 \uB108\uBB34 \uB9CE\uC2B5\uB2C8\uB2E4. \uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.", 429);
}
__name(rateLimit, "rateLimit");
async function sessionUser(req, env) {
  const token = req.headers.get("Authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) throw new ApiError("\uB85C\uADF8\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.", 401);
  const hash = await sha256(token);
  const row = await env.DB.prepare("SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?").bind(hash, epoch()).first();
  if (!row) throw new ApiError("\uB85C\uADF8\uC778\uC774 \uB9CC\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4. Notion\uC744 \uB2E4\uC2DC \uC5F0\uACB0\uD574 \uC8FC\uC138\uC694.", 401);
  return row.user_id;
}
__name(sessionUser, "sessionUser");
async function myConnections(env, userId) {
  return (await env.DB.prepare("SELECT * FROM connections WHERE user_id=? LIMIT 20").bind(userId).all()).results;
}
__name(myConnections, "myConnections");
async function connection(env, userId, id) {
  const conn = await env.DB.prepare("SELECT * FROM connections WHERE id=? AND user_id=?").bind(id, userId).first();
  if (!conn) throw new ApiError("\uC5F0\uACB0\uB41C \uC6CC\uD06C\uC2A4\uD398\uC774\uC2A4\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.", 404);
  return conn;
}
__name(connection, "connection");
async function notionRaw(token, path, payload) {
  return fetch(`${API}${path}`, { method: payload === void 0 ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" }, ...payload === void 0 ? {} : { body: JSON.stringify(payload) } });
}
__name(notionRaw, "notionRaw");
async function notion(env, conn, path, payload) {
  let response = await notionRaw(await decrypt(conn.access_cipher, env.TOKEN_ENCRYPTION_KEY), path, payload);
  if (response.status === 401) {
    let updated = conn;
    try {
      const fresh = await exchangeNotionToken(env.NOTION_CLIENT_ID, env.NOTION_CLIENT_SECRET, { grant_type: "refresh_token", refresh_token: await decrypt(conn.refresh_cipher, env.TOKEN_ENCRYPTION_KEY) });
      const encAccess = await encrypt(fresh.access_token, env.TOKEN_ENCRYPTION_KEY);
      const encRefresh = await encrypt(fresh.refresh_token, env.TOKEN_ENCRYPTION_KEY);
      await env.DB.prepare("UPDATE connections SET access_cipher=?,refresh_cipher=?,updated_at=? WHERE id=? AND refresh_cipher=?").bind(encAccess, encRefresh, epoch(), conn.id, conn.refresh_cipher).run();
    } catch {
    }
    updated = await connection(env, conn.user_id, conn.id);
    response = await notionRaw(await decrypt(updated.access_cipher, env.TOKEN_ENCRYPTION_KEY), path, payload);
  }
  if (!response.ok) {
    if (response.status === 401) throw new ApiError("Notion \uC5F0\uACB0\uC774 \uB9CC\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uC5F0\uACB0\uD574 \uC8FC\uC138\uC694.", 401);
    if (response.status === 403 || response.status === 404) throw new ApiError("Notion \uD398\uC774\uC9C0\uC758 \uC811\uADFC \uAD8C\uD55C\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.", 403);
    if (response.status === 429) throw new ApiError("Notion \uC694\uCCAD \uD55C\uB3C4\uC5D0 \uB3C4\uB2EC\uD588\uC2B5\uB2C8\uB2E4.", 503);
    throw new ApiError(`Notion API \uC624\uB958 (${response.status})`, 502);
  }
  return response.json();
}
__name(notion, "notion");
async function findSource(env, userId, key) {
  const ds = sourceId(key);
  const row = await env.DB.prepare("SELECT * FROM source_grants WHERE user_id=? AND source_id=? ORDER BY last_seen DESC LIMIT 1").bind(userId, ds).first();
  if (!row) throw new ApiError("\uBCF8\uC778\uC774 \uC5F0\uACB0\uD55C DB\uAC00 \uC544\uB2D9\uB2C8\uB2E4. \uB370\uC774\uD130 \uC18C\uC2A4\uB97C \uB2E4\uC2DC \uBD88\uB7EC\uC624\uC138\uC694.", 404);
  return { row, conn: await connection(env, userId, row.connection_id) };
}
__name(findSource, "findSource");
async function listSources(env, userId) {
  const found = /* @__PURE__ */ new Map();
  for (const conn of await myConnections(env, userId)) {
    let cursor;
    for (let page = 0; page < 5; page++) {
      const info = await notion(env, conn, "/search", { page_size: 100, filter: { property: "object", value: "data_source" }, ...cursor ? { start_cursor: cursor } : {} });
      if (!Array.isArray(info.results)) throw new ApiError("Notion \uAC80\uC0C9 \uACB0\uACFC \uC624\uB958", 502);
      for (const item of info.results) {
        if (item.object !== "data_source" || !pathPart(String(item.id))) continue;
        const title = Array.isArray(item.title) ? item.title.map((t) => t.plain_text || "").join("") : "";
        const key = sourceKey(item.id);
        await env.DB.prepare("INSERT INTO source_grants (id,user_id,connection_id,source_id,title,last_seen) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,connection_id,source_id) DO UPDATE SET title=excluded.title,last_seen=excluded.last_seen").bind(crypto.randomUUID(), userId, conn.id, item.id, title || "Untitled", epoch()).run();
        if (!found.has(key)) found.set(key, { key, title: title || "Untitled", fieldCount: Object.keys(item.properties || {}).length, workspace: conn.workspace_name });
      }
      if (!info.has_more) break;
      if (!info.next_cursor) throw new ApiError("Notion \uAC80\uC0C9 \uCEE4\uC11C \uC624\uB958", 502);
      if (page === 4) throw new ApiError("DB\uAC00 \uB108\uBB34 \uB9CE\uC2B5\uB2C8\uB2E4. \uAC80\uC0C9 \uD55C\uB3C4\uB97C \uC870\uC815\uD574 \uC8FC\uC138\uC694.", 422);
      cursor = info.next_cursor;
    }
  }
  return [...found.values()];
}
__name(listSources, "listSources");
async function chartAggregate(env, userId, requested) {
  let cfg;
  try {
    cfg = parseChartRequest(requested);
  } catch (err) {
    throw new ApiError(err.message);
  }
  const { row, conn } = await findSource(env, userId, cfg.sourceKey);
  const schema = await notion(env, conn, `/data_sources/${row.source_id}`);
  const fields = fieldsFromSchema(schema);
  try {
    validateFields(cfg, fields);
  } catch (err) {
    throw new ApiError(err.message);
  }
  const date = fields.find((f) => f.id === cfg.dateFieldId);
  const conditions = [];
  if (date && (cfg.dateFrom || cfg.dateTo)) {
    const fieldType = date.type === "created_time" ? "created_time" : date.type === "last_edited_time" ? "last_edited_time" : "date";
    for (const [op, v] of [["on_or_after", cfg.dateFrom], ["on_or_before", cfg.dateTo]]) {
      if (!v) continue;
      conditions.push(fieldType === "date" ? { property: date.name, date: { [op]: v } } : { timestamp: fieldType, [fieldType]: { [op]: v } });
    }
  }
  const filter = conditions.length === 2 ? { and: conditions } : conditions[0];
  const pages = [];
  let cursor;
  for (let iteration = 0; iteration < 11; iteration++) {
    const data = await notion(env, conn, `/data_sources/${row.source_id}/query`, { page_size: 100, ...filter ? { filter } : {}, ...cursor ? { start_cursor: cursor } : {} });
    if (!Array.isArray(data.results)) throw new ApiError("Notion \uC870\uD68C \uACB0\uACFC \uC624\uB958", 502);
    pages.push(...data.results);
    if (pages.length > 1e3) throw new ApiError("\uC9D1\uACC4 \uD56D\uBAA9 1,000\uAC1C \uCD08\uACFC: \uAE30\uAC04\uC744 \uC904\uC5EC \uC8FC\uC138\uC694.", 422);
    if (!data.has_more) {
      try {
        return { source: row, config: cfg, result: { ...aggregatePages(pages, cfg), updatedAt: (/* @__PURE__ */ new Date()).toISOString() } };
      } catch (err) {
        throw new ApiError(err.message, 422);
      }
    }
    if (!data.next_cursor) throw new ApiError("Notion \uC870\uD68C \uCEE4\uC11C \uC624\uB958", 502);
    cursor = data.next_cursor;
  }
  throw new ApiError("\uC9D1\uACC4 \uD56D\uBAA9\uC774 \uB108\uBB34 \uB9CE\uC2B5\uB2C8\uB2E4.", 422);
}
__name(chartAggregate, "chartAggregate");
async function widgetOwner(env, userId, id) {
  if (!pathPart(id)) throw new ApiError("\uC704\uC82F ID \uC624\uB958");
  const row = await env.DB.prepare("SELECT * FROM widgets WHERE id=? AND user_id=?").bind(id, userId).first();
  if (!row) throw new ApiError("\uC18C\uC720\uD55C \uC704\uC82F\uC774 \uC544\uB2D9\uB2C8\uB2E4.", 404);
  return row;
}
__name(widgetOwner, "widgetOwner");
async function main(req, env) {
  const url = new URL(req.url), path = url.pathname;
  if (path === "/api/health" && req.method === "GET") return send({ ok: true, version: "0.3", notionVersion: NOTION_VERSION });
  if (!checkEnv(env)) throw new ApiError("OAuth/D1 \uD658\uACBD\uBCC0\uC218\uAC00 \uC124\uC815\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.", 503);
  if (path === "/api/auth/notion/start" && req.method === "GET") {
    await rateLimit(req, env, "oauth-start", 12);
    const state = randomToken();
    await env.DB.prepare("INSERT INTO oauth_states(state_hash,expires_at) VALUES (?,?)").bind(await sha256(state), epoch() + 600).run();
    const auth = new URL("https://api.notion.com/v1/oauth/authorize");
    auth.searchParams.set("client_id", env.NOTION_CLIENT_ID);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("owner", "user");
    auth.searchParams.set("redirect_uri", env.NOTION_REDIRECT_URI);
    auth.searchParams.set("state", state);
    return new Response(null, { status: 302, headers: { Location: auth.href, "Set-Cookie": oauthCookie(state, env), ...noStore } });
  }
  if (path === "/api/auth/notion/callback" && req.method === "GET") {
    const state = url.searchParams.get("state") || "";
    const stateCookie = cookie(req, "wp_oauth");
    if (!/^[a-f0-9]{64}$/.test(state) || state !== stateCookie) throw new ApiError("OAuth state \uAC80\uC99D \uC2E4\uD328", 403);
    const row = await env.DB.prepare("DELETE FROM oauth_states WHERE state_hash=? AND expires_at>? RETURNING state_hash").bind(await sha256(state), epoch()).first();
    if (!row) throw new ApiError("\uC774\uBBF8 \uC0AC\uC6A9\uD588\uAC70\uB098 \uB9CC\uB8CC\uB41C \uB85C\uADF8\uC778 \uC2DC\uB3C4\uC785\uB2C8\uB2E4.", 403);
    if (url.searchParams.get("error")) throw new ApiError("Notion \uC5F0\uACB0\uC774 \uCDE8\uC18C\uB418\uC5C8\uC2B5\uB2C8\uB2E4.", 400);
    const code = url.searchParams.get("code") || "";
    if (!code || code.length > 512) throw new ApiError("Notion \uC778\uC99D \uCF54\uB4DC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.");
    const token = await exchangeNotionToken(env.NOTION_CLIENT_ID, env.NOTION_CLIENT_SECRET, { grant_type: "authorization_code", code, redirect_uri: env.NOTION_REDIRECT_URI });
    const userId2 = token.owner?.type === "user" ? token.owner.user?.id : "";
    if (!userId2) throw new ApiError("Notion \uC0AC\uC6A9\uC790\uB97C \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.", 400);
    const old = await env.DB.prepare("SELECT id FROM connections WHERE user_id=? AND workspace_id=?").bind(userId2, token.workspace_id).first();
    await env.DB.prepare("INSERT INTO users (id,created_at) VALUES (?,?) ON CONFLICT(id) DO NOTHING").bind(userId2, epoch()).run();
    await env.DB.prepare("INSERT INTO connections (id,user_id,workspace_id,workspace_name,bot_id,access_cipher,refresh_cipher,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id,workspace_id) DO UPDATE SET workspace_name=excluded.workspace_name,bot_id=excluded.bot_id,access_cipher=excluded.access_cipher,refresh_cipher=excluded.refresh_cipher,updated_at=excluded.updated_at").bind(old?.id || crypto.randomUUID(), userId2, token.workspace_id, token.workspace_name || "Notion Workspace", token.bot_id, await encrypt(token.access_token, env.TOKEN_ENCRYPTION_KEY), await encrypt(token.refresh_token, env.TOKEN_ENCRYPTION_KEY), epoch()).run();
    const ticket = randomToken();
    await env.DB.prepare("INSERT INTO auth_tickets (ticket_hash,user_id,expires_at) VALUES (?,?,?)").bind(await sha256(ticket), userId2, epoch() + 90).run();
    const response = redirectAuth(env, ticket);
    response.headers.set("Set-Cookie", oauthCookie("", env));
    return response;
  }
  guardOrigin(req, env);
  if (path === "/api/auth/ticket" && req.method === "POST") {
    await rateLimit(req, env, "ticket", 30);
    const value = (await bodyJson(req)).ticket;
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new ApiError("\uC778\uC99D \uCF54\uB4DC\uAC00 \uC798\uBABB\uB418\uC5C8\uC2B5\uB2C8\uB2E4.", 401);
    const record = await env.DB.prepare("DELETE FROM auth_tickets WHERE ticket_hash=? AND expires_at>? RETURNING user_id").bind(await sha256(value), epoch()).first();
    if (!record) throw new ApiError("\uC778\uC99D \uCF54\uB4DC\uAC00 \uB9CC\uB8CC\uB418\uC5C8\uAC70\uB098 \uC0AC\uC6A9\uB418\uC5C8\uC2B5\uB2C8\uB2E4.", 401);
    const token = randomToken();
    await env.DB.prepare("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)").bind(await sha256(token), record.user_id, epoch() + 7200).run();
    return send({ token, expiresIn: 7200 });
  }
  if (path.startsWith("/api/public/widgets/") && req.method === "GET") {
    const id = path.split("/").pop() || "";
    if (!pathPart(id)) throw new ApiError("\uC704\uC82F\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.", 404);
    const row = await env.DB.prepare("SELECT snapshot_json,chart_type,title,snapshot_at FROM widgets WHERE id=? AND visibility='public' AND snapshot_json IS NOT NULL").bind(id).first();
    if (!row) throw new ApiError("\uBE44\uACF5\uAC1C\uC774\uAC70\uB098 \uD574\uC81C\uB41C \uC704\uC82F\uC785\uB2C8\uB2E4.", 404);
    return send({ title: row.title, chartType: row.chart_type, ...JSON.parse(row.snapshot_json), updatedAt: new Date(row.snapshot_at * 1e3).toISOString() });
  }
  const userId = await sessionUser(req, env);
  if (path === "/api/auth/logout" && req.method === "POST") {
    const token = req.headers.get("Authorization")?.replace(/^Bearer /, "") || "";
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=? AND user_id=?").bind(await sha256(token), userId).run();
    return send({ ok: true });
  }
  if (path === "/api/me" && req.method === "GET") {
    const entries = await myConnections(env, userId);
    return send({ userId, workspaces: entries.map((c) => ({ id: c.id, name: c.workspace_name })) });
  }
  if (path === "/api/notion/connections" && req.method === "GET") return send({ connections: (await myConnections(env, userId)).map((c) => ({ id: c.id, name: c.workspace_name })) });
  if (path === "/api/notion/disconnect" && req.method === "POST") {
    const id = (await bodyJson(req)).connectionId;
    if (typeof id !== "string") throw new ApiError("\uC5F0\uACB0 ID \uC624\uB958");
    await connection(env, userId, id);
    await env.DB.prepare("DELETE FROM connections WHERE id=? AND user_id=?").bind(id, userId).run();
    return send({ ok: true, notice: "\uC11C\uBC84\uC5D0 \uC800\uC7A5\uB41C \uC5F0\uACB0 \uC815\uBCF4\uB97C \uC81C\uAC70\uD588\uC2B5\uB2C8\uB2E4. Notion\uC5D0\uC11C\uB3C4 \uC5F0\uACB0\uC744 \uD574\uC81C\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." });
  }
  if (path === "/api/notion/data-sources" && req.method === "GET") return send({ sources: await listSources(env, userId) });
  const schema = path.match(/^\/api\/notion\/data-sources\/(n[a-f0-9]{32})\/schema$/);
  if (schema && req.method === "GET") {
    const { row, conn } = await findSource(env, userId, schema[1]);
    return send({ key: schema[1], fields: fieldsFromSchema(await notion(env, conn, `/data_sources/${row.source_id}`)) });
  }
  if (path === "/api/widgets/charts/preview" && req.method === "POST") return send((await chartAggregate(env, userId, await bodyJson(req))).result);
  if (path === "/api/widgets" && req.method === "GET") {
    const rows = (await env.DB.prepare("SELECT id,title,visibility,chart_type,updated_at FROM widgets WHERE user_id=? ORDER BY updated_at DESC LIMIT 100").bind(userId).all()).results;
    return send({ widgets: rows });
  }
  if (path === "/api/widgets" && req.method === "POST") {
    const raw = await bodyJson(req), type = raw.chartType, title = raw.title;
    if (!["bar", "line", "donut"].includes(String(type))) throw new ApiError("\uCC28\uD2B8 \uC720\uD615\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
    const { source, config } = await chartAggregate(env, userId, raw.config);
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO widgets(id,user_id,source_grant_id,title,chart_type,config_json,visibility,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(id, userId, source.id, typeof title === "string" ? title.slice(0, 80) : "My Notion chart", type, JSON.stringify(config), "private", epoch(), epoch()).run();
    return send({ id, visibility: "private" }, 201);
  }
  const pub = path.match(/^\/api\/widgets\/([a-f0-9-]{36})\/publish$/i);
  if (pub && req.method === "POST") {
    const row = await widgetOwner(env, userId, pub[1]);
    const payload = await bodyJson(req);
    if (payload.confirm !== "PUBLISH_AGGREGATES") throw new ApiError("\uC9D1\uACC4 \uB370\uC774\uD130 \uACF5\uAC1C\uC5D0 \uBA85\uC2DC\uC801\uC73C\uB85C \uB3D9\uC758\uD574\uC57C \uD569\uB2C8\uB2E4.");
    const { result } = await chartAggregate(env, userId, JSON.parse(row.config_json));
    await env.DB.prepare("UPDATE widgets SET visibility='public',snapshot_json=?,snapshot_at=?,updated_at=? WHERE id=? AND user_id=?").bind(JSON.stringify(result), epoch(), epoch(), row.id, userId).run();
    return send({ id: row.id, visibility: "public", recordCount: result.recordCount, notice: "\uACF5\uAC1C\uD55C \uC218\uCE58\uC640 \uADF8\uB8F9 \uC774\uB984\uC740 \uB9C1\uD06C\uB97C \uAC00\uC9C4 \uB204\uAD6C\uC5D0\uAC8C\uB098 \uD45C\uC2DC\uB429\uB2C8\uB2E4." });
  }
  const refresh = path.match(/^\/api\/widgets\/([a-f0-9-]{36})\/refresh$/i);
  if (refresh && req.method === "POST") {
    const row = await widgetOwner(env, userId, refresh[1]);
    const { result } = await chartAggregate(env, userId, JSON.parse(row.config_json));
    if (row.visibility === "public") await env.DB.prepare("UPDATE widgets SET snapshot_json=?,snapshot_at=?,updated_at=? WHERE id=? AND user_id=?").bind(JSON.stringify(result), epoch(), epoch(), row.id, userId).run();
    return send({ result, visibility: row.visibility });
  }
  const unpub = path.match(/^\/api\/widgets\/([a-f0-9-]{36})\/unpublish$/i);
  if (unpub && req.method === "POST") {
    const row = await widgetOwner(env, userId, unpub[1]);
    await env.DB.prepare("UPDATE widgets SET visibility='private',snapshot_json=NULL,snapshot_at=NULL,updated_at=? WHERE id=? AND user_id=?").bind(epoch(), row.id, userId).run();
    return send({ ok: true, visibility: "private" });
  }
  return send({ error: "\uCC3E\uC744 \uC218 \uC5C6\uB294 API\uC785\uB2C8\uB2E4." }, 404);
}
__name(main, "main");
var src_default = { async fetch(req, env) {
  if (req.method === "OPTIONS") {
    try {
      guardOrigin(req, env);
      return allowCors(new Response(null, { status: 204, headers: { ...noStore, "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization", "Access-Control-Max-Age": "600" } }), req, env);
    } catch {
      return send({ error: "\uD5C8\uC6A9\uB418\uC9C0 \uC54A\uC740 \uCD9C\uCC98\uC785\uB2C8\uB2E4." }, 403);
    }
  }
  try {
    return allowCors(await main(req, env), req, env);
  } catch (err) {
    const known = err instanceof ApiError;
    if (!known) console.error("Unexpected Worker error (message/redacted)");
    return allowCors(send({ error: known ? err.message : "\uC11C\uBC84 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4." }, known ? err.status : 500), req, env);
  }
} };

// ../node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-0AQcP2/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-0AQcP2/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
