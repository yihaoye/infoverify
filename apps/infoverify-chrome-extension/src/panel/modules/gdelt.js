// ---------- GDELT query generation, caching, throttling, and parsing ----------
import {
  DEBUG_PREFIX,
  gdeltMinIntervalMs,
  gdeltCacheTtlMs,
  gdeltCooldownMs
} from "./constants.js";
import { state } from "./state.js";
import { resolveOutputLanguage } from "./language.js";
import { normalizeHostname } from "./mbfc.js";
import { sleep, safeReadText, sanitizeModelText } from "./utils.js";

export async function fetchGdeltBundle(input, signal, outputLanguage = "en") {
  const queries = await buildGdeltQueries(input, signal);
  const anchorDate = extractAnchorDate(input);
  const query = queries[0] || "";
  console.info(`${DEBUG_PREFIX} GDELT query candidates`, {
    queries,
    anchorDate: anchorDate ? anchorDate.toISOString().slice(0, 10) : ""
  });
  if (!query) {
    return {
      query: "",
      items: [],
      anchorDate: anchorDate ? anchorDate.toISOString().slice(0, 10) : "",
      summary: summarizeGdeltBundle("", [], "", anchorDate, outputLanguage)
    };
  }

  const cacheKey = buildGdeltCacheKey(input, query, anchorDate);
  const cached = await getGdeltCachedBundle(cacheKey);
  if (cached) {
    return {
      ...cached,
      summary: summarizeGdeltBundle(query, cached.items || [], cached.errorMessage || "", anchorDate, outputLanguage)
    };
  }

  const cooldownUntil = await getGdeltCooldownUntil();
  if (cooldownUntil > Date.now()) {
    return {
      query,
      items: [],
      anchorDate: anchorDate ? anchorDate.toISOString().slice(0, 10) : "",
      errorMessage: `GDELT temporarily rate limited. Please try again in ${Math.ceil((cooldownUntil - Date.now()) / 1000)} seconds.`,
      summary: summarizeGdeltBundle(query, [], `GDELT temporarily rate limited. Please try again in ${Math.ceil((cooldownUntil - Date.now()) / 1000)} seconds.`, anchorDate, outputLanguage)
    };
  }

  const result = await enqueueGdeltRequest(() => fetchGdeltItems(query, signal));
  const topItems = sortGdeltItems(result.items, anchorDate).slice(0, 5);
  const bundle = {
    query,
    items: topItems,
    anchorDate: anchorDate ? anchorDate.toISOString().slice(0, 10) : "",
    errorMessage: result.errorMessage || "",
    rawPreview: String(result.rawPreview || ""),
    summary: summarizeGdeltBundle(query, topItems, result.errorMessage, anchorDate, outputLanguage)
  };
  if (result.errorMessage && /429/.test(result.errorMessage)) {
    const cooldown = Date.now() + gdeltCooldownMs;
    state.gdeltCooldownUntil = cooldown;
    await chrome.storage.local.set({ gdeltCooldownUntil: cooldown });
  }
  await setGdeltCachedBundle(cacheKey, bundle);
  return bundle;
}

export function buildGdeltCacheKey(input, query, anchorDate) {
  return [
    normalizeHostname(input?.url || ""),
    String(query || "").trim().toLowerCase(),
    String(anchorDate ? anchorDate.toISOString().slice(0, 10) : ""),
    String(input?.selectionText || "").trim().slice(0, 120),
    String(input?.title || "").trim().slice(0, 120)
  ].join("::");
}

export async function getGdeltCachedBundle(cacheKey) {
  const key = `gdeltCache:${cacheKey}`;
  const { [key]: cached } = await chrome.storage.session.get({ [key]: null });
  if (!cached || typeof cached !== "object") return null;

  const createdAt = Number(cached.createdAt || 0);
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > gdeltCacheTtlMs) {
    await chrome.storage.session.remove(key);
    return null;
  }

  return cached.bundle || null;
}

export async function setGdeltCachedBundle(cacheKey, bundle) {
  const key = `gdeltCache:${cacheKey}`;
  await chrome.storage.session.set({
    [key]: {
      createdAt: Date.now(),
      bundle
    }
  });
}

export function enqueueGdeltRequest(task) {
  const next = state.gdeltRequestChain.then(async () => {
    const now = Date.now();
    const elapsed = now - state.gdeltLastRequestAt;
    if (elapsed < gdeltMinIntervalMs) {
      await sleep(gdeltMinIntervalMs - elapsed, null);
    }

    state.gdeltLastRequestAt = Date.now();
    try {
      return await task();
    } finally {
      state.gdeltLastRequestAt = Date.now();
    }
  });

  state.gdeltRequestChain = next.catch(() => {});
  return next;
}

export async function fetchGdeltItems(query, signal) {
  const endpoint = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  endpoint.searchParams.set("mode", "artlist");
  endpoint.searchParams.set("format", "jsonfeed");
  endpoint.searchParams.set("sort", "datedesc");
  endpoint.searchParams.set("maxrecords", "8");
  endpoint.searchParams.set("timespan", "30d");
  endpoint.searchParams.set("query", query);

  const resp = await fetch(endpoint.toString(), { signal });
  if (!resp.ok) {
    const text = await safeReadText(resp);
    const payloadPreview = text.slice(0, 600);
    console.error(`${DEBUG_PREFIX} GDELT HTTP error`, {
      status: resp.status,
      statusText: resp.statusText,
      payloadPreview,
      endpoint: endpoint.toString()
    });
    if (resp.status === 429) {
      const cooldown = Date.now() + gdeltCooldownMs;
      state.gdeltCooldownUntil = cooldown;
      await chrome.storage.local.set({ gdeltCooldownUntil: cooldown });
      return {
        items: [],
        errorMessage: `GDELT access is too frequent; please try again later (${resp.status}${text ? ` - ${text}` : ""})`,
        rawPreview: payloadPreview
      };
    }
    return {
      items: [],
      errorMessage: `GDELT HTTP ${resp.status}${text ? ` - ${text}` : ""}`,
      rawPreview: payloadPreview
    };
  }

  const text = await safeReadText(resp);
  const data = parseJsonFeed(text, endpoint.toString());
  if (!data) {
    return {
      items: [],
      errorMessage: `GDELT returned non-JSON response${text ? `: ${text.slice(0, 220)}` : ""}`,
      rawPreview: text.slice(0, 600)
    };
  }
  const rawItems = Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data?.feed?.items)
      ? data.feed.items
      : [];

  return {
    items: rawItems.map(normalizeGdeltItem).filter((item) => item.title || item.url),
    errorMessage: "",
    rawPreview: text.slice(0, 600)
  };
}

export function parseJsonFeed(text, endpoint) {
  const rawText = String(text || "");
  const candidates = [];
  const normalized = rawText.replace(/^﻿/, "").trim();
  if (normalized) candidates.push(normalized);

  const first = normalized.indexOf("{");
  const last = normalized.lastIndexOf("}");
  if (first >= 0 && last > first) {
    candidates.push(normalized.slice(first, last + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (err) {
      console.error(`${DEBUG_PREFIX} GDELT JSON parse candidate failed`, {
        endpoint,
        preview: candidate.slice(0, 180),
        error: String(err?.message || err)
      });
    }
  }

  const parseError = new Error(`GDELT returned non-JSON response: ${rawText ? rawText.slice(0, 220) : "empty response"}`);
  console.error(`${DEBUG_PREFIX} GDELT non-JSON response`, parseError, {
    endpoint,
    payloadPreview: rawText.slice(0, 600)
  });
  return null;
}

export function normalizeGdeltItem(item) {
  const publishedAt = String(item?.date_published || item?.date_modified || item?.published || "").trim();
  const source = String(item?.source || item?.author?.name || item?.author || item?.publisher || "").trim();
  const quote = String(item?.content_text || item?.summary || item?.description || "").trim();
  const url = String(item?.url || item?.external_url || item?.id || "").trim();
  return {
    title: String(item?.title || item?.id || "GDELT hit").trim(),
    url,
    quote: quote ? quote.slice(0, 240) : "",
    retrieved_at: publishedAt || new Date().toISOString(),
    source_type: "gdelt",
    source,
    domain: normalizeHostname(url),
    country: String(item?.country || item?.source_country || item?.sourceCountry || item?.location || "").trim(),
    tone: String(item?.tone || item?.sentiment || item?.mood || "").trim()
  };
}

export function summarizeGdeltBundle(query, items, errorMessage, anchorDate, outputLanguage = "en") {
  const language = resolveOutputLanguage(outputLanguage);
  const copy = {
    en: {
      failed: (message) => `GDELT search failed: ${message}`,
      empty: (queryText) => (queryText ? `No close GDELT news events were found in the last 30 days (query: ${queryText}).` : "No close GDELT news events were found in the last 30 days."),
      query: "GDELT query",
      anchor: "GDELT anchor date",
      hits: "GDELT hits in the last 30 days",
      recent: "Recent events"
    },
    es: {
      failed: (message) => `La búsqueda en GDELT falló: ${message}`,
      empty: (queryText) => (queryText ? `No se encontraron eventos de noticias cercanos en GDELT en los últimos 30 días (consulta: ${queryText}).` : "No se encontraron eventos de noticias cercanos en GDELT en los últimos 30 días."),
      query: "Consulta de GDELT",
      anchor: "Fecha ancla de GDELT",
      hits: "Resultados de GDELT en los últimos 30 días",
      recent: "Eventos recientes"
    },
    ja: {
      failed: (message) => `GDELT 検索に失敗しました: ${message}`,
      empty: (queryText) => (queryText ? `直近30日間で近いGDELTニュースイベントは見つかりませんでした（検索語: ${queryText}）。` : "直近30日間で近いGDELTニュースイベントは見つかりませんでした。"),
      query: "GDELT クエリ",
      anchor: "GDELT アンカーデート",
      hits: "直近30日間のGDELTヒット数",
      recent: "最近のイベント"
    },
    zh: {
      failed: (message) => `GDELT 搜索失败：${message}`,
      empty: (queryText) => (queryText ? `过去 30 天未找到接近的 GDELT 新闻事件（查询：${queryText}）。` : "过去 30 天未找到接近的 GDELT 新闻事件。"),
      query: "GDELT 查询词",
      anchor: "GDELT 锚定日期",
      hits: "过去 30 天 GDELT 命中数",
      recent: "最近事件"
    }
  }[language];

  if (errorMessage && items.length === 0) {
    return copy.failed(errorMessage);
  }

  if (!items || items.length === 0) {
    return copy.empty(query);
  }

  const lines = items.slice(0, 3).map((item) => {
    const date = item.retrieved_at ? new Date(item.retrieved_at).toISOString().slice(0, 10) : "unknown-date";
    const source = item.source ? ` · ${item.source}` : "";
    return `${date}${source} · ${item.title}`;
  });
  const queryLine = query ? `${copy.query}: ${query}\n` : "";
  const anchorLine = anchorDate
    ? `${copy.anchor}: ${anchorDate.toISOString().slice(0, 10)}\n`
    : "";
  return `${queryLine}${anchorLine}${copy.hits}: ${items.length}; ${copy.recent}:\n${lines.join("\n")}`;
}

export function extractAnchorDate(input) {
  const text = [input?.selectionText, input?.title, input?.pageText].filter(Boolean).join(" ");
  const patterns = [
    /(\d{4})[/-](\d{1,2})[/-](\d{1,2})/,
    /(\d{4})年(\d{1,2})月(\d{1,2})日/,
    /(\d{1,2})\/(\d{1,2})\/(\d{4})/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    let year;
    let month;
    let day;

    if (pattern.source.includes("\\d{4})[/-]")) {
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
    } else if (pattern.source.includes("年")) {
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
    } else {
      month = Number(match[1]);
      day = Number(match[2]);
      year = Number(match[3]);
    }

    const date = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(date.getTime())) return date;
  }

  return null;
}

export function sortGdeltItems(items, anchorDate) {
  const normalizedItems = Array.isArray(items) ? [...items] : [];
  if (!anchorDate) {
    return normalizedItems.sort((left, right) => getItemDate(right) - getItemDate(left));
  }

  const anchorTime = anchorDate.getTime();
  return normalizedItems.sort((left, right) => {
    const leftTime = getItemDate(left);
    const rightTime = getItemDate(right);
    const leftDistance = Math.abs(leftTime - anchorTime);
    const rightDistance = Math.abs(rightTime - anchorTime);
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    return rightTime - leftTime;
  });
}

export function getItemDate(item) {
  const value = Date.parse(item?.retrieved_at || "");
  if (Number.isFinite(value)) return value;
  return 0;
}

export async function getGdeltCooldownUntil() {
  if (state.gdeltCooldownUntil > Date.now()) return state.gdeltCooldownUntil;
  const { gdeltCooldownUntil: stored } = await chrome.storage.local.get({ gdeltCooldownUntil: 0 });
  const value = Number(stored) || 0;
  state.gdeltCooldownUntil = value;
  return value;
}

export async function buildGdeltQueries(input, signal) {
  const promptQuery = await buildPromptDrivenGdeltQuery(input, signal);
  return promptQuery ? [promptQuery] : [];
}

export async function buildPromptDrivenGdeltQuery(input, signal) {
  const text = [
    String(input?.analysisText || "").trim(),
    String(input?.selectionText || "").trim(),
    String(input?.title || "").trim(),
    String(input?.pageText || "").trim()
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (!text) return "";

  const api = globalThis.LanguageModel;
  if (!api) return "";

  try {
    const availability = await api.availability({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }]
    });
    if (availability === "unavailable") return "";

    const session = await api.create({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
      signal
    });

    const queryPrompt = [
      "You are generating a GDELT news search query.",
      "Return only one short English query string.",
      "Do not explain, do not use markdown, do not use quotes, and do not include bullets.",
      "Keep only the most important named entities, organizations, locations, dates, numbers, and event or action words.",
      "Avoid filler words and avoid tokens shorter than 3 characters.",
      "Prefer 4 to 8 words total.",
      "Text:",
      text
    ].join("\n");

    const raw = sanitizeModelText(await session.prompt(queryPrompt, { signal }));
    return cleanGdeltQuery(raw);
  } catch (err) {
    console.info(`${DEBUG_PREFIX} GDELT prompt query unavailable`, {
      message: String(err?.message || err),
      stack: err?.stack || ""
    });
    return "";
  }
}

export function cleanGdeltQuery(value) {
  const normalized = String(value || "")
    .normalize("NFKC")
    .replace(/["'`]/g, " ")
    .replace(/[^\p{L}\p{N}%&\-. ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";

  const seen = new Set();
  const tokens = [];
  for (const rawToken of normalized.split(" ")) {
    const token = rawToken.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9%]+$/g, "").trim();
    if (!token) continue;
    const shortToken = token.length < 3;
    const numericToken = /^\d+(?:[.,]\d+)?%?$/.test(token);
    const upperTicker = /^[A-Z]{3,5}$/.test(token);
    if (shortToken && !numericToken && !upperTicker) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push(token);
    if (tokens.length >= 8) break;
  }
  return tokens.join(" ").trim();
}
