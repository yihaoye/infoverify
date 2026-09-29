// ---------- Google News RSS query generation, caching, and parsing ----------
import { googleNewsCacheTtlMs } from "./constants.js";
import { reportError } from "./logging.js";
import { resolveOutputLanguage } from "./language.js";
import { normalizeHostname } from "./mbfc.js";
import { safeReadText, sanitizeModelText } from "./utils.js";

// `session` is the run's local AI session, reused for query generation so the
// claim is already in its context for the later analysis prompt.
// `onQueryReady({ source, claimInContext })` fires once the query exists, so
// callers can time query generation separately from the RSS fetch.
export async function fetchGoogleNewsBundle(input, signal, outputLanguage = "en", { session = null, onQueryReady } = {}) {
  if (!(await hasGoogleNewsPermission(input))) {
    const errorMessage = "Google News access was not granted.";
    const anchorDate = extractAnchorDate(input);
    return {
      query: "",
      items: [],
      anchorDate: anchorDate ? anchorDate.toISOString().slice(0, 10) : "",
      errorMessage,
      summary: summarizeGoogleNewsBundle("", [], errorMessage, anchorDate, outputLanguage)
    };
  }

  const { query, source, claimInContext } = await buildGoogleNewsQuery(input, signal, session);
  onQueryReady?.({ source, claimInContext });
  const anchorDate = extractAnchorDate(input);
  if (!query) {
    return {
      query: "",
      items: [],
      anchorDate: anchorDate ? anchorDate.toISOString().slice(0, 10) : "",
      summary: summarizeGoogleNewsBundle("", [], "", anchorDate, outputLanguage)
    };
  }

  const cacheKey = buildGoogleNewsCacheKey(input, query, anchorDate);
  const cached = await getGoogleNewsCachedBundle(cacheKey);
  if (cached) {
    return {
      ...cached,
      summary: summarizeGoogleNewsBundle(query, cached.items || [], cached.errorMessage || "", anchorDate, outputLanguage)
    };
  }

  const result = await fetchGoogleNewsItems(query, signal);
  const topItems = sortGoogleNewsItems(result.items, anchorDate).slice(0, 5);
  const bundle = {
    query,
    items: topItems,
    anchorDate: anchorDate ? anchorDate.toISOString().slice(0, 10) : "",
    errorMessage: result.errorMessage || "",
    summary: summarizeGoogleNewsBundle(query, topItems, result.errorMessage, anchorDate, outputLanguage)
  };
  // Only cache successful results so transient RSS errors do not become stuck.
  if (!bundle.errorMessage) {
    await setGoogleNewsCachedBundle(cacheKey, bundle);
  }
  return bundle;
}

async function hasGoogleNewsPermission(input) {
  if (input?.googleNewsPermissionGranted) return true;
  return await chrome.permissions.contains({ origins: ["https://news.google.com/*"] });
}

export function buildGoogleNewsCacheKey(input, query, anchorDate) {
  return [
    normalizeHostname(input?.url || ""),
    String(query || "").trim().toLowerCase(),
    String(anchorDate ? anchorDate.toISOString().slice(0, 10) : ""),
    String(input?.selectionText || "").trim().slice(0, 120),
    String(input?.title || "").trim().slice(0, 120)
  ].join("::");
}

export async function getGoogleNewsCachedBundle(cacheKey) {
  const key = `googleNewsCache:${cacheKey}`;
  const { [key]: cached } = await chrome.storage.session.get({ [key]: null });
  if (!cached || typeof cached !== "object") return null;

  const createdAt = Number(cached.createdAt || 0);
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > googleNewsCacheTtlMs) {
    await chrome.storage.session.remove(key);
    return null;
  }

  return cached.bundle || null;
}

export async function setGoogleNewsCachedBundle(cacheKey, bundle) {
  const key = `googleNewsCache:${cacheKey}`;
  await chrome.storage.session.set({
    [key]: {
      createdAt: Date.now(),
      bundle
    }
  });
}

export async function fetchGoogleNewsItems(query, signal) {
  const endpoint = new URL("https://news.google.com/rss/search");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("hl", "en-US");
  endpoint.searchParams.set("gl", "US");
  endpoint.searchParams.set("ceid", "US:en");

  const resp = await fetch(endpoint.toString(), {
    signal,
    credentials: "omit",
    referrerPolicy: "no-referrer"
  });
  if (!resp.ok) {
    // The response body is an HTML error page: log it, but keep it out of the UI.
    const text = await safeReadText(resp);
    reportError("Google News HTTP error", new Error(`HTTP ${resp.status}`), {
      statusText: resp.statusText,
      payloadPreview: text.slice(0, 600)
    });
    return {
      items: [],
      errorMessage: `Google News HTTP ${resp.status}${resp.statusText ? ` ${resp.statusText}` : ""}`
    };
  }

  const text = await safeReadText(resp);
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.querySelector("parsererror")) {
    return {
      items: [],
      errorMessage: "Google News returned invalid RSS"
    };
  }
  const rawItems = Array.from(document.querySelectorAll("item"));

  return {
    items: rawItems.map(normalizeGoogleNewsItem).filter((item) => item.title || item.url),
    errorMessage: ""
  };
}

export function normalizeGoogleNewsItem(item) {
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

export function summarizeGoogleNewsBundle(query, items, errorMessage, anchorDate, outputLanguage = "en") {
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
      empty: (queryText) => (queryText ? `No se encontraron resultados cercanos en Google News (consulta: ${queryText}).` : "No se encontraron resultados cercanos en Google News."),
      query: "Consulta de Google News",
      anchor: "Fecha ancla de noticias",
      hits: "Resultados de Google News",
      recent: "Eventos recientes"
    },
    ja: {
      failed: (message) => `Google News 検索に失敗しました: ${message}`,
      empty: (queryText) => (queryText ? `Google News で近い結果は見つかりませんでした（検索語: ${queryText}）。` : "Google News で近い結果は見つかりませんでした。"),
      query: "Google News クエリ",
      anchor: "ニュースのアンカーデート",
      hits: "Google News の結果",
      recent: "最近のイベント"
    },
    zh: {
      failed: (message) => `Google News 搜索失败：${message}`,
      empty: (queryText) => (queryText ? `Google News 未找到接近的结果（查询：${queryText}）。` : "Google News 未找到接近的结果。"),
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
  const text = [input?.selectionText, input?.title].filter(Boolean).join(" ");
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

export function sortGoogleNewsItems(items, anchorDate) {
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

// Max tokens kept in a search query (also enforced by cleanGoogleNewsQuery).
const MAX_QUERY_TOKENS = 8;
// Model input cap for query generation; longer claims are not left in context.
const MAX_QUERY_PROMPT_CHARS = 2000;

// English function words dropped from rule-based queries. The claim has already
// been translated to English when possible (see prepareEnglishAnalysisInput).
const QUERY_STOPWORDS = new Set((
  "the and for are was were been being has have had does did not but with from that this these those " +
  "than then into onto over under about after before while when where which who whom whose what why how " +
  "its it's his her hers their theirs our ours your yours they them she him you can could will would " +
  "shall should may might must also just only very more most such some any each every all both other " +
  "said says say according reported reports reportedly report there here out off per via upon amid"
).split(" "));

// Content words of `text` in order, deduplicated, or null when the text is not
// in a Latin script (e.g. untranslated Chinese has no spaces to split on).
function contentTokens(text) {
  const normalized = String(text || "").normalize("NFKC");
  if (/[^\p{Script=Latin}\p{N}\p{P}\p{S}\s]/u.test(normalized)) return null;
  const tokens = cleanGoogleNewsQuery(normalized, Infinity).split(" ").filter(Boolean);
  return tokens.filter((token) => !QUERY_STOPWORDS.has(token.toLowerCase()));
}

// Returns { query, source: "rule" | "model" | "none", claimInContext }.
//
// A selection that already fits in one query after dropping stopwords is used
// as-is: summarizing it with the model would cost seconds for no gain. Longer
// claims need the model to pick out the main statement. Without a model the
// first content words are used rather than skipping the news search.
export async function buildGoogleNewsQuery(input, signal, session) {
  // The user's selection is the claim to verify. Page text is intentionally not
  // captured or used, so the query stays focused on the chosen statement.
  const claim = String(input?.selectionText || "").trim()
    || String(input?.analysisText || "").trim();
  if (!claim) return { query: "", source: "none", claimInContext: false };

  const tokens = contentTokens(claim);
  if (tokens && tokens.length > 0 && tokens.length <= MAX_QUERY_TOKENS) {
    return { query: tokens.join(" "), source: "rule", claimInContext: false };
  }

  if (session) {
    const query = await buildPromptDrivenGoogleNewsQuery(input, claim, signal, session);
    if (query.text) return { query: query.text, source: "model", claimInContext: query.claimInContext };
  }

  const fallback = (tokens || []).slice(0, MAX_QUERY_TOKENS).join(" ");
  return { query: fallback, source: fallback ? "rule" : "none", claimInContext: false };
}

// Runs on the shared analysis session (not a throwaway one): the claim text
// sent here stays in the session context, so the analysis prompt can refer to
// it instead of sending it again. `claimInContext` is only true when the whole
// claim fit, so the analysis never judges a truncated claim.
async function buildPromptDrivenGoogleNewsQuery(input, claim, signal, session) {
  const title = String(input?.title || "").trim();
  const fullText = [claim, title].filter(Boolean).join("\n\n").trim();
  const text = fullText.slice(0, MAX_QUERY_PROMPT_CHARS);

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

  try {
    const raw = sanitizeModelText(await session.prompt(queryPrompt, { signal }));
    return { text: cleanGoogleNewsQuery(raw), claimInContext: fullText.length <= MAX_QUERY_PROMPT_CHARS };
  } catch (err) {
    if (signal?.aborted || err?.name === "AbortError") throw err;
    reportError("Google News query generation", err);
    return { text: "", claimInContext: false };
  }
}

export function cleanGoogleNewsQuery(value, maxTokens = MAX_QUERY_TOKENS) {
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
    if (tokens.length >= maxTokens) break;
  }
  return tokens.join(" ").trim();
}
