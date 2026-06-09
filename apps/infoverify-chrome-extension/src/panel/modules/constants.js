// ---------- Shared constants and localized fallback copy ----------
export const DEBUG_PREFIX = "[InfoVerify]";
export const minLoadingMs = 700;
// GDELT enforces "one request every 5 seconds"; keep a safety margin above it to
// absorb clock skew and request latency so consecutive calls don't trip the 429.
export const gdeltMinIntervalMs = 6000;
export const gdeltCacheTtlMs = 15 * 60 * 1000;
export const gdeltCooldownMs = 2 * 60 * 1000;

// ---------- Cloud AI (BYOK) defaults ----------
// Only Google Gemini is supported for now. The model is user-editable in Options.
export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
export const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";

export const SUPPORTED_OUTPUT_LANGUAGES = new Set(["en", "es", "ja", "zh"]);
export const SUPPORTED_MODEL_OUTPUT_LANGUAGES = new Set(["en", "es", "ja"]);
export const OUTPUT_LANGUAGE_LABELS = {
  en: "English",
  es: "Spanish",
  ja: "Japanese",
  zh: "Chinese"
};

export const FALLBACK_TEXT = {
  en: {
    jsonFallback: "The local AI response could not be parsed as JSON, so deterministic scoring was used.",
    noOutput: "The local AI returned no parsable output.",
    analysisDone: "Local AI analysis completed."
  },
  es: {
    jsonFallback: "La respuesta de la IA local no se pudo analizar como JSON, así que se usó una puntuación determinista.",
    noOutput: "La IA local no devolvió una salida que se pudiera analizar.",
    analysisDone: "El análisis de la IA local se completó."
  },
  ja: {
    jsonFallback: "ローカル AI の応答を JSON として解析できなかったため、決定論的なスコアリングを使用しました。",
    noOutput: "ローカル AI から解析可能な出力が返されませんでした。",
    analysisDone: "ローカル AI の分析が完了しました。"
  },
  zh: {
    jsonFallback: "由于本地 AI 的响应无法解析为 JSON，因此改用确定性评分。",
    noOutput: "本地 AI 没有返回可解析的输出。",
    analysisDone: "本地 AI 分析已完成。"
  }
};
