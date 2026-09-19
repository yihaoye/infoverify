// ---------- Google News RSS query generation, caching, throttling, and parsing ----------
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
  console.info(`${DEBUG_PREFIX} Google News query candidates`, {
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
      errorMessage: `Google News temporarily rate limited. Please try again in ${Math.ceil((cooldownUntil - Date.now()) / 1000)} seconds.`,
      summary: summarizeGdeltBundle(query, [], `Google News temporarily rate limited. Please try again in ${Math.ceil((cooldownUntil - Date.now()) / 1000)} seconds.`, anchorDate, outputLanguage)
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
  // Only cache successful results. Caching an error (especially a 429) would
  // replay the failure for the full cache TTL and bypass the cooldown logic,
  // making the rate-limit message appear "stuck" long after GDELT recovered.
  if (!bundle.errorMessage) {
    await setGdeltCachedBundle(cacheKey, bundle);
  }
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

// The last-request timestamp is persisted so the minimum interval is honored
// even across side-panel reloads (in-memory state alone resets to 0 on reload,
// which would let the first request after a reopen fire too soon and get a 429).
async function getGdeltLastRequestAt() {
  const { gdeltLastRequestAt: stored } = await chrome.storage.local.get({ gdeltLastRequestAt: 0 });
  return Math.max(Number(state.gdeltLastRequestAt) || 0, Number(stored) || 0);
}

async function setGdeltLastRequestAt(value) {
  state.gdeltLastRequestAt = value;
  await chrome.storage.local.set({ gdeltLastRequestAt: value });
}

export function enqueueGdeltRequest(task) {
  const next = state.gdeltRequestChain.then(async () => {
    const elapsed = Date.now() - (await getGdeltLastRequestAt());
    if (elapsed < gdeltMinIntervalMs) {
      await sleep(gdeltMinIntervalMs - elapsed, null);
    }

    await setGdeltLastRequestAt(Date.now());
    try {
      return await task();
    } finally {
      await setGdeltLastRequestAt(Date.now());
    }
  });

  state.gdeltRequestChain = next.catch(() => {});
  return next;
}

export async function fetchGdeltItems(query, signal) {
  const endpoint = new URL("https://news.google.com/rss/search");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("hl", "en-US");
  endpoint.searchParams.set("gl", "US");
  endpoint.searchParams.set("ceid", "US:en");

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
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.querySelector("parsererror")) {
    return {
      items: [],
      errorMessage: "Google News returned invalid RSS",
      rawPreview: text.slice(0, 600)
    };
  }
  const rawItems = Array.from(document.querySelectorAll("item"));

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
  const getText = (selector) => item?.querySelector(selector)?.textContent?.trim() || "";
  const title = getText("title");
  const publishedAt = getText("pubDate");
  const description = getText("description");
  const url = getText("link");
  const sourceNode = item?.querySelector("source");
  const sourceURL = sourceNode?.getAttribute("url") || "";
  const titleParts = title.split(" - ");
  const source = sourceNode?.textContent?.trim() || (titleParts.length > 1 ? titleParts.pop().trim() : "Google News");
  const quote = description ? new DOMParser().parseFromString(description, "text/html").body?.textContent?.trim() || "" : "";
  return {
    title: titleParts.join(" - ").trim() || title || url || "Google News hit",
    url,
    quote: quote ? quote.slice(0, 240) : "",
    retrieved_at: publishedAt || new Date().toISOString(),
    source_type: "google_news",
    source,
    domain: normalizeHostname(sourceURL) || normalizeHostname(url)
  };
}

export function summarizeGdeltBundle(query, items, errorMessage, anchorDate, outputLanguage = "en") {
  const language = resolveOutputLanguage(outputLanguage);
  const copy = {
    en: {
      failed: (message) => `Google News search failed: ${message}`,
      empty: (queryText) => (queryText ? `No close Google News results were found (query: ${queryText}).` : "No close Google News results were found."),
      query: "Google News query",
      anchor: "News anchor date",
      hits: "Google News results",
      recent: "Recent events"
    },
    es: {
      failed: (message) => `La búsqueda en Google News falló: ${message}`,
      empty: (queryText) => (queryText ? `No se encontraron eventos de noticias cercanos en GDELT en los últimos 30 días (consulta: ${queryText}).` : "No se encontraron eventos de noticias cercanos en GDELT en los últimos 30 días."),
      query: "Consulta de Google News",
      anchor: "Fecha ancla de noticias",
      hits: "Resultados de Google News",
      recent: "Eventos recientes"
    },
    ja: {
      failed: (message) => `Google News 検索に失敗しました: ${message}`,
      empty: (queryText) => (queryText ? `直近30日間で近いGDELTニュースイベントは見つかりませんでした（検索語: ${queryText}）。` : "直近30日間で近いGDELTニュースイベントは見つかりませんでした。"),
      query: "Google News クエリ",
      anchor: "ニュースのアンカーデート",
      hits: "Google News の結果",
      recent: "最近のイベント"
    },
    zh: {
      failed: (message) => `Google News 搜索失败：${message}`,
      empty: (queryText) => (queryText ? `过去 30 天未找到接近的 GDELT 新闻事件（查询：${queryText}）。` : "过去 30 天未找到接近的 GDELT 新闻事件。"),
      query: "Google News 查询词",
      anchor: "新闻锚定日期",
      hits: "Google News 结果数",
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
  // The user's selection IS the claim to verify, so it leads. We avoid repeating
  // the same paragraph across analysisText/selectionText and avoid dumping the
  // full page text when a selection exists — both dilute the model's attention
  // and let it latch onto an entity-dense but secondary sentence instead of the
  // main claim.
  const claim = String(input?.selectionText || "").trim()
    || String(input?.analysisText || "").trim()
    || String(input?.pageText || "").trim();
  const title = String(input?.title || "").trim();
  const text = [claim, title]
    .filter(Boolean)
    .join("\n\n")
    .trim()
    .slice(0, 2000);

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
      "You are creating a news search query to fact-check a specific claim.",
      "From the text below, identify the SINGLE main claim it is making — usually the first or most prominent statement — and ignore secondary, background, or example details mentioned later.",
      "Output one short English search query (4 to 8 words) using only the key searchable terms of that main claim: its core subject, organizations, products, locations, dates, numbers, and the main action.",
      "If the main subject is unnamed (for example 'an unnamed company'), do NOT switch to a different, named topic from a later sentence; instead use the other concrete terms of the main claim, such as the product, the amount, or the reporting outlet.",
      "Return only the query string: no explanation, no markdown, no quotes, and no bullets.",
      "Avoid filler words and avoid tokens shorter than 3 characters.",
      "Claim text:",
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
    // Keep short all-caps acronyms (AI, EU, UN, US, NASA) — they are meaningful
    // search terms even though they fall under the 3-char minimum.
    const upperAcronym = /^[A-Z]{2,5}$/.test(token);
    if (shortToken && !numericToken && !upperAcronym) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push(token);
    if (tokens.length >= 8) break;
  }
  return tokens.join(" ").trim();
}
