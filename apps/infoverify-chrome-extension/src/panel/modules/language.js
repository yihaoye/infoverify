// ---------- Language resolution, detection, and translation ----------
import {
  SUPPORTED_OUTPUT_LANGUAGES,
  SUPPORTED_MODEL_OUTPUT_LANGUAGES,
  OUTPUT_LANGUAGE_LABELS,
  FALLBACK_TEXT
} from "./constants.js";
import { state } from "./state.js";

export async function getPreferredOutputLanguage() {
  const { outputLanguage = "auto" } = await chrome.storage.sync.get({
    outputLanguage: "auto"
  });
  return resolveOutputLanguage(outputLanguage);
}

export function resolveOutputLanguage(value) {
  const normalized = String(value || "").toLowerCase();
  if (SUPPORTED_OUTPUT_LANGUAGES.has(normalized)) return normalized;
  const detected = String(navigator.language || navigator.languages?.[0] || "en").toLowerCase();
  if (detected.startsWith("zh")) return "zh";
  if (detected.startsWith("es")) return "es";
  if (detected.startsWith("ja")) return "ja";
  return "en";
}

export function resolveModelOutputLanguage(value) {
  const language = resolveOutputLanguage(value);
  if (SUPPORTED_MODEL_OUTPUT_LANGUAGES.has(language)) return language;
  return "en";
}

export function getLanguageLabel(value) {
  return OUTPUT_LANGUAGE_LABELS[resolveOutputLanguage(value)] || "English";
}

export function fallbackLanguageText(value, key) {
  const language = resolveOutputLanguage(value);
  return FALLBACK_TEXT[language]?.[key] || FALLBACK_TEXT.en[key] || "";
}

export async function detectLanguage(text, signal) {
  const sample = String(text || "").trim();
  if (!sample || sample.length < 20) {
    return { language: "unknown", confidence: 0, results: [] };
  }

  const api = globalThis.LanguageDetector;
  if (!api) return { language: "unknown", confidence: 0, results: [] };

  try {
    const availability = await api.availability();
    if (availability === "unavailable") return { language: "unknown", confidence: 0, results: [] };

    if (!state.languageDetectorCache) {
      state.languageDetectorCache = await api.create();
    }

    const results = await state.languageDetectorCache.detect(sample);
    if (!Array.isArray(results) || results.length === 0) {
      return { language: "unknown", confidence: 0, results: [] };
    }

    const [top] = results;
    return {
      language: String(top?.detectedLanguage || "unknown"),
      confidence: Number(top?.confidence || 0),
      results
    };
  } catch {
    return { language: "unknown", confidence: 0, results: [] };
  }
}

export async function getTranslator(sourceLanguage, targetLanguage, signal) {
  const key = `${sourceLanguage}->${targetLanguage}`;
  if (state.translatorCache.has(key)) return state.translatorCache.get(key);

  const api = globalThis.Translator;
  if (!api) return null;

  try {
    const availability = await api.availability({ sourceLanguage, targetLanguage });
    if (availability === "unavailable") return null;

    const translator = await api.create({
      sourceLanguage,
      targetLanguage
    });
    state.translatorCache.set(key, translator);
    return translator;
  } catch {
    return null;
  }
}

export async function translateText(value, sourceLanguage, targetLanguage, signal) {
  const text = String(value || "");
  if (!text) return text;
  if (sourceLanguage === targetLanguage) return text;

  const translator = await getTranslator(sourceLanguage, targetLanguage, signal);
  if (!translator) return text;

  try {
    return await translator.translate(text);
  } catch {
    return text;
  }
}

export async function prepareEnglishAnalysisInput(input, signal) {
  const selectionText = String(input?.selectionText || "");
  const title = String(input?.title || "");
  const pageText = String(input?.pageText || "");
  const sampleText = [selectionText, title, pageText].filter(Boolean).join(" ").slice(0, 2400);

  const detected = await detectLanguage(sampleText, signal);
  const detectedLanguage = String(detected.language || "unknown").toLowerCase();
  // TODO: Tune this threshold after we have a few real-world examples.
  const needsTranslation = detectedLanguage !== "unknown" && detectedLanguage !== "en" && detected.confidence >= 0.45;

  if (!needsTranslation) {
    return {
      ...input,
      analysisLanguage: detectedLanguage,
      analysisLanguageConfidence: detected.confidence,
      analysisText: String(input?.analysisText || input?.pageText || input?.selectionText || ""),
      sourceSelectionText: selectionText,
      sourceTitle: title,
      sourcePageText: pageText
    };
  }

  const translatedSelectionText = await translateText(selectionText, detectedLanguage, "en", signal);
  const translatedTitle = await translateText(title, detectedLanguage, "en", signal);
  const translatedPageText = await translateText(pageText, detectedLanguage, "en", signal);
  const translatedAnalysisText = String(translatedPageText || translatedSelectionText || translatedTitle || input?.analysisText || input?.pageText || input?.selectionText || "");

  return {
    ...input,
    selectionText: translatedSelectionText || selectionText,
    title: translatedTitle || title,
    pageText: translatedPageText || pageText,
    analysisText: translatedAnalysisText,
    analysisLanguage: detectedLanguage,
    analysisLanguageConfidence: detected.confidence,
    sourceSelectionText: selectionText,
    sourceTitle: title,
    sourcePageText: pageText,
    inputWasTranslated: true
  };
}

export async function translateArray(values, sourceLanguage, targetLanguage, signal) {
  if (!Array.isArray(values) || values.length === 0) return Array.isArray(values) ? [] : [];
  const translated = [];
  for (const value of values) {
    translated.push(await shouldTranslateText(value, sourceLanguage, targetLanguage, signal));
  }
  return translated;
}

export async function localizeAssessmentResult(result, targetLanguage, signal) {
  if (!result || targetLanguage !== "zh") return result;
  const sourceLanguage = "en";
  const localized = {
    ...result,
    summary: await shouldTranslateText(result.summary, sourceLanguage, targetLanguage, signal),
    rationale: await shouldTranslateText(result.rationale, sourceLanguage, targetLanguage, signal),
    news_summary: await shouldTranslateText(result.news_summary, sourceLanguage, targetLanguage, signal),
    reproducibility_summary: await shouldTranslateText(result.reproducibility_summary, sourceLanguage, targetLanguage, signal),
    cross_validation_summary: await shouldTranslateText(result.cross_validation_summary, sourceLanguage, targetLanguage, signal),
    specificity_summary: await shouldTranslateText(result.specificity_summary, sourceLanguage, targetLanguage, signal),
    conflicts: await translateArray(result.conflicts, sourceLanguage, targetLanguage, signal),
    missing: await translateArray(result.missing, sourceLanguage, targetLanguage, signal),
    evidence: Array.isArray(result.evidence)
      ? await Promise.all(result.evidence.map(async (item) => ({
          ...item,
          title: await shouldTranslateText(item?.title, sourceLanguage, targetLanguage, signal),
          quote: await shouldTranslateText(item?.quote, sourceLanguage, targetLanguage, signal)
        })))
      : result.evidence
  };

  if (localized.rule_notes) {
    localized.rule_notes = {
      reproducibility: await shouldTranslateText(result.rule_notes?.reproducibility || "", sourceLanguage, targetLanguage, signal),
      cross_validation: await shouldTranslateText(result.rule_notes?.cross_validation || "", sourceLanguage, targetLanguage, signal),
      detail_richness: await shouldTranslateText(result.rule_notes?.detail_richness || "", sourceLanguage, targetLanguage, signal)
    };
  }

  if (localized.llm_assessment) {
    localized.llm_assessment = {
      ...result.llm_assessment,
      rationale: await shouldTranslateText(result.llm_assessment?.rationale || "", sourceLanguage, targetLanguage, signal),
      summary: await shouldTranslateText(result.llm_assessment?.summary || "", sourceLanguage, targetLanguage, signal),
      error: await shouldTranslateText(result.llm_assessment?.error || "", sourceLanguage, targetLanguage, signal)
    };
  }

  return localized;
}

export function isLikelyLocalized(text, targetLanguage) {
  const value = String(text || "");
  if (!value) return false;
  if (targetLanguage === "zh") return /[一-鿿]/.test(value);
  if (targetLanguage === "ja") return /[぀-ヿ一-鿿]/.test(value);
  if (targetLanguage === "es") return /[áéíóúñ¿¡]/i.test(value);
  return false;
}

export async function shouldTranslateText(value, sourceLanguage, targetLanguage, signal) {
  const text = String(value || "");
  if (!text) return text;
  if (isLikelyLocalized(text, targetLanguage)) return text;
  return await translateText(text, sourceLanguage, targetLanguage, signal);
}
