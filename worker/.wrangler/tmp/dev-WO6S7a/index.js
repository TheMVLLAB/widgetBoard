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
  const get = /* @__PURE__ */ __name((key2, max = 128) => typeof input[key2] === "string" ? input[key2].trim().slice(0, max) : "", "get");
  const sourceKey = get("sourceKey", 40), dateFieldId = get("dateFieldId"), valueFieldId = get("valueFieldId"), categoryFieldId = get("categoryFieldId");
  const groupBy = get("groupBy"), aggregate = get("aggregate");
  const dateFrom = get("dateFrom", 10), dateTo = get("dateTo", 10);
  if (!/^[a-zA-Z][\w-]{0,39}$/.test(sourceKey) || !["month", "day", "category"].includes(groupBy) || !["sum", "count", "avg"].includes(aggregate)) throw new Error("\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 \uCC28\uD2B8 \uC124\uC815\uC785\uB2C8\uB2E4.");
  if (!validDate(dateFrom) || !validDate(dateTo) || dateFrom && dateTo && dateFrom > dateTo) throw new Error("\uB0A0\uC9DC \uBC94\uC704\uAC00 \uC798\uBABB\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
  if (dateFrom && dateTo && (Date.parse(dateTo) - Date.parse(dateFrom)) / 864e5 > 366) throw new Error("\uCD5C\uB300 366\uC77C \uBC94\uC704\uB9CC \uC870\uD68C\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
  return { sourceKey, dateFieldId, valueFieldId, categoryFieldId, groupBy, aggregate, dateFrom, dateTo };
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

// src/index.ts
var NOTION_VERSION = "2026-03-11";
var API = "https://api.notion.com/v1";
var encoder = new TextEncoder();
var forbidCache = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
function json(data, status = 200, extra) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...forbidCache, ...extra } });
}
__name(json, "json");
function origins(env) {
  return env.SITE_ORIGIN.split(",").map((s) => s.trim()).filter((s) => /^https?:\/\/[^/]+$/.test(s));
}
__name(origins, "origins");
function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  return !origin || origins(env).includes(origin);
}
__name(allowedOrigin, "allowedOrigin");
function cors(response, request, env) {
  const origin = request.headers.get("Origin");
  if (origin && origins(env).includes(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Vary", "Origin");
  }
  return response;
}
__name(cors, "cors");
function jsonError(message, status, extra) {
  return json({ error: message }, status, extra);
}
__name(jsonError, "jsonError");
function b64(input) {
  let s = "";
  for (const n of input) s += String.fromCharCode(n);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(b64, "b64");
function fromB64(input) {
  const s = atob(input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - input.length % 4) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
__name(fromB64, "fromB64");
async function key(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
__name(key, "key");
async function sameSecret(a, b) {
  const [ah, bh] = await Promise.all([crypto.subtle.digest("SHA-256", encoder.encode(a)), crypto.subtle.digest("SHA-256", encoder.encode(b))]);
  return new Uint8Array(ah).every((n, i) => n === new Uint8Array(bh)[i]);
}
__name(sameSecret, "sameSecret");
async function mintSession(env) {
  const payload = b64(encoder.encode(JSON.stringify({ v: 1, exp: Math.floor(Date.now() / 1e3) + 1800, nonce: crypto.randomUUID() })));
  const mac = b64(new Uint8Array(await crypto.subtle.sign("HMAC", await key(env.SESSION_SECRET), encoder.encode(payload))));
  return `${payload}.${mac}`;
}
__name(mintSession, "mintSession");
async function authenticated(req, env) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer /, "") || "";
  if (!/^[\w-]{10,600}\.[\w-]{20,200}$/.test(token)) return false;
  const [payload, mac] = token.split(".");
  try {
    const valid = await crypto.subtle.verify("HMAC", await key(env.SESSION_SECRET), fromB64(mac), encoder.encode(payload));
    if (!valid) return false;
    const data = JSON.parse(new TextDecoder().decode(fromB64(payload)));
    return data.v === 1 && Number.isInteger(data.exp) && data.exp > Math.floor(Date.now() / 1e3) && data.exp < Math.floor(Date.now() / 1e3) + 1900;
  } catch {
    return false;
  }
}
__name(authenticated, "authenticated");
function sources(env) {
  const raw = JSON.parse(env.NOTION_SOURCES_JSON || "{}");
  if (!raw || Array.isArray(raw) || typeof raw !== "object") throw new Error("SOURCE_CONFIGURATION");
  const entries = Object.entries(raw);
  if (entries.length === 0 || entries.length > 20) throw new Error("SOURCE_CONFIGURATION");
  const map = /* @__PURE__ */ new Map();
  for (const [alias, id] of entries) {
    if (!/^[a-zA-Z][\w-]{0,39}$/.test(alias) || typeof id !== "string" || !/^[a-fA-F0-9-]{32,36}$/.test(id)) throw new Error("SOURCE_CONFIGURATION");
    map.set(alias, id);
  }
  return map;
}
__name(sources, "sources");
async function notion(env, path, body) {
  const result = await fetch(`${API}${path}`, { method: body === void 0 ? "GET" : "POST", headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" }, body: body === void 0 ? void 0 : JSON.stringify(body) });
  if (!result.ok) {
    if (result.status === 429) throw new HttpError("Notion \uC694\uCCAD\uC774 \uB9CE\uC2B5\uB2C8\uB2E4. \uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.", 503);
    if (result.status === 404 || result.status === 403) throw new HttpError("\uB178\uC158 \uB370\uC774\uD130 \uC18C\uC2A4\uC5D0 \uB300\uD55C \uC811\uADFC \uAD8C\uD55C\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.", 403);
    if (result.status === 401) throw new HttpError("Notion \uD1A0\uD070\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.", 502);
    throw new HttpError(`Notion \uB370\uC774\uD130 \uC870\uD68C\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4 (${result.status}).`, 502);
  }
  return result.json();
}
__name(notion, "notion");
var HttpError = class extends Error {
  static {
    __name(this, "HttpError");
  }
  status;
  constructor(message, status) {
    super(message);
    this.status = status;
  }
};
async function readJson(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > 8192) throw new HttpError("\uC694\uCCAD \uB370\uC774\uD130\uAC00 \uB108\uBB34 \uD07D\uB2C8\uB2E4.", 413);
  const raw = await request.text();
  if (raw.length > 8192) throw new HttpError("\uC694\uCCAD \uB370\uC774\uD130\uAC00 \uB108\uBB34 \uD07D\uB2C8\uB2E4.", 413);
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError("JSON \uD615\uC2DD\uC774 \uC798\uBABB\uB418\uC5C8\uC2B5\uB2C8\uB2E4.", 400);
  }
}
__name(readJson, "readJson");
function routeSources(pathname) {
  const p = pathname.match(/^\/api\/notion\/data-sources\/([a-zA-Z][\w-]{0,39})\/schema$/);
  return p?.[1] || null;
}
__name(routeSources, "routeSources");
async function main(req, env) {
  const { pathname } = new URL(req.url);
  if (pathname === "/api/health" && req.method === "GET") return json({ ok: true, service: "widget-playground-notion", notionVersion: NOTION_VERSION });
  if (!env.NOTION_TOKEN || !env.NOTION_SOURCES_JSON || !env.ADMIN_ACCESS_KEY || env.ADMIN_ACCESS_KEY.length < 32 || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32 || !origins(env).length) return jsonError("Worker \uD658\uACBD\uBCC0\uC218\uB97C \uC124\uC815\uD574 \uC8FC\uC138\uC694.", 503);
  if (pathname === "/api/auth/login" && req.method === "POST") {
    const body = await readJson(req);
    const supplied = typeof body.key === "string" && body.key.length <= 1024 ? body.key : "";
    if (!supplied || !await sameSecret(supplied, env.ADMIN_ACCESS_KEY)) return jsonError("\uAC1C\uC778 \uC811\uADFC \uD0A4\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.", 401);
    return json({ token: await mintSession(env), expiresIn: 1800 });
  }
  if (!await authenticated(req, env)) return jsonError("\uC778\uC99D\uC774 \uD544\uC694\uD558\uAC70\uB098 \uC138\uC158\uC774 \uB9CC\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4.", 401);
  const map = sources(env);
  if (pathname === "/api/notion/data-sources" && req.method === "GET") {
    const entries = await Promise.all([...map.entries()].map(async ([key2, id]) => {
      const schema = await notion(env, `/data_sources/${id}`);
      const title = Array.isArray(schema.title) ? schema.title.map((t) => t.plain_text || "").join("") : "";
      return { key: key2, title: title || key2, fieldCount: Object.keys(schema.properties || {}).length };
    }));
    return json({ sources: entries });
  }
  const keyName = routeSources(pathname);
  if (keyName && req.method === "GET") {
    const id = map.get(keyName);
    if (!id) return jsonError("\uB4F1\uB85D\uB418\uC9C0 \uC54A\uC740 \uB370\uC774\uD130 \uC18C\uC2A4\uC785\uB2C8\uB2E4.", 404);
    const schema = await notion(env, `/data_sources/${id}`);
    return json({ key: keyName, fields: fieldsFromSchema(schema) });
  }
  if (pathname === "/api/widgets/charts/preview" && req.method === "POST") {
    let cfg;
    try {
      cfg = parseChartRequest(await readJson(req));
    } catch (e) {
      return jsonError(e.message, 400);
    }
    const id = map.get(cfg.sourceKey);
    if (!id) return jsonError("\uB4F1\uB85D\uB418\uC9C0 \uC54A\uC740 \uB370\uC774\uD130 \uC18C\uC2A4\uC785\uB2C8\uB2E4.", 404);
    const schema = await notion(env, `/data_sources/${id}`);
    try {
      validateFields(cfg, fieldsFromSchema(schema));
    } catch (e) {
      return jsonError(e.message, 400);
    }
    const pages = [];
    let cursor;
    const schemaFields = fieldsFromSchema(schema);
    const selectedDate = schemaFields.find((f) => f.id === cfg.dateFieldId);
    const conditions = [];
    if (selectedDate && (cfg.dateFrom || cfg.dateTo)) {
      for (const [op, value] of [["on_or_after", cfg.dateFrom], ["on_or_before", cfg.dateTo]]) {
        if (!value) continue;
        const key2 = selectedDate.type === "created_time" ? "created_time" : selectedDate.type === "last_edited_time" ? "last_edited_time" : "date";
        conditions.push(key2 === "date" ? { property: selectedDate.name, date: { [op]: value } } : { timestamp: key2, [key2]: { [op]: value } });
      }
    }
    const filter = conditions.length === 2 ? { and: conditions } : conditions[0];
    for (let page = 0; page < 11; page++) {
      const response = await notion(env, `/data_sources/${id}/query`, { page_size: 100, ...filter ? { filter } : {}, ...cursor ? { start_cursor: cursor } : {} });
      if (!Array.isArray(response.results)) throw new HttpError("\uB370\uC774\uD130 \uC751\uB2F5\uC744 \uD574\uC11D\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.", 502);
      if (response.request_status?.type === "incomplete") throw new HttpError("Notion API\uC758 \uC870\uD68C \uACB0\uACFC\uAC00 \uC798\uB838\uC2B5\uB2C8\uB2E4.", 422);
      pages.push(...response.results);
      if (pages.length > 1e3) throw new HttpError("\uD604\uC7AC 1000\uAC1C \uD56D\uBAA9\uAE4C\uC9C0\uB9CC \uC9D1\uACC4\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uC870\uD68C \uBC94\uC704\uB97C \uC904\uC5EC \uC8FC\uC138\uC694.", 422);
      if (!response.has_more) return json({ ...aggregatePages(pages, cfg), updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
      if (!response.next_cursor) throw new HttpError("\uC870\uD68C \uCEE4\uC11C\uAC00 \uB204\uB77D\uB418\uC5C8\uC2B5\uB2C8\uB2E4.", 502);
      cursor = response.next_cursor;
    }
    return jsonError("1000\uAC1C \uD56D\uBAA9\uC744 \uCD08\uACFC\uD558\uC5EC \uC9D1\uACC4\uD558\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.", 422);
  }
  return jsonError("\uC694\uCCAD \uACBD\uB85C\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.", 404);
}
__name(main, "main");
var src_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      if (!allowedOrigin(request, env)) return jsonError("\uD5C8\uC6A9\uB418\uC9C0 \uC54A\uC740 \uCD9C\uCC98\uC785\uB2C8\uB2E4.", 403);
      return cors(new Response(null, { status: 204, headers: { "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Authorization,Content-Type", "Access-Control-Max-Age": "600", ...forbidCache } }), request, env);
    }
    if (!allowedOrigin(request, env)) return jsonError("\uD5C8\uC6A9\uB418\uC9C0 \uC54A\uC740 \uCD9C\uCC98\uC785\uB2C8\uB2E4.", 403);
    try {
      return cors(await main(request, env), request, env);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (!(error instanceof HttpError)) console.error("Worker request failed (details omitted)");
      return cors(jsonError(error instanceof HttpError ? error.message : "\uC11C\uBC84 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.", status), request, env);
    }
  }
};

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
var jsonError2 = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
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
var middleware_miniflare3_json_error_default = jsonError2;

// .wrangler/tmp/bundle-Tc60Ke/middleware-insertion-facade.js
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

// .wrangler/tmp/bundle-Tc60Ke/middleware-loader.entry.ts
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
