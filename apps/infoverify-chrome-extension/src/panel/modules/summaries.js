// ---------- Localized summary builders for the three scoring principles ----------
import { resolveOutputLanguage } from "./language.js";
import { countDistinctValues, summarizeCounts, formatDateOnly } from "./utils.js";

const REPRODUCIBILITY_COPY = {
  en: {
    mbfc: "MBFC",
    noMatch: "no static match or the domain has not been packaged yet.",
    timeline: "GDELT timeline",
    first: "first",
    recent: "recent",
    distinct: "distinct domains",
    noData: "no usable news events found.",
    cue: "Assessment cue: reproducibility is stronger when the source is stable over time, repeats across events, and has better domain reputation."
  },
  es: {
    mbfc: "MBFC",
    noMatch: "no hay coincidencia estática o el dominio aún no se ha empaquetado.",
    timeline: "Cronología de GDELT",
    first: "primera",
    recent: "reciente",
    distinct: "dominios distintos",
    noData: "no se encontraron eventos de noticias utilizables.",
    cue: "Pista de evaluación: la reproducibilidad es mayor cuando la fuente es estable en el tiempo, se repite entre eventos y tiene mejor reputación de dominio."
  },
  ja: {
    mbfc: "MBFC",
    noMatch: "静的な一致がないか、まだそのドメインがパッケージ化されていません。",
    timeline: "GDELT タイムライン",
    first: "最初",
    recent: "最近",
    distinct: "異なるドメイン",
    noData: "利用できるニュースイベントは見つかりませんでした。",
    cue: "評価の目安: 情報源が時間的に安定し、複数のイベントで繰り返され、ドメイン評価が高いほど再現性は高くなります。"
  },
  zh: {
    mbfc: "MBFC",
    noMatch: "没有静态匹配，或者该域名尚未打包。",
    timeline: "GDELT 时间线",
    first: "首次",
    recent: "最近",
    distinct: "个独立域名",
    noData: "未找到可用新闻事件。",
    cue: "评估提示：如果信源在时间上稳定、反复出现且域名信誉较好，可复现性更高。"
  }
};

const CROSS_VALIDATION_COPY = {
  en: {
    empty: "GDELT cross-validation: no usable news events, so independent corroboration is weak.",
    prefix: "GDELT cross-validation",
    hitsLabel: "hits",
    domainsLabel: "distinct domains",
    countriesLabel: "source countries",
    tone: "Tone distribution",
    span: "Time span",
    cue: "Assessment cue: cross-validation is stronger when multiple domains, multiple countries, and consistent tone all align."
  },
  es: {
    empty: "Validación cruzada de GDELT: no hay eventos de noticias utilizables, por lo que la corroboración independiente es débil.",
    prefix: "Validación cruzada de GDELT",
    hitsLabel: "coincidencias",
    domainsLabel: "dominios distintos",
    countriesLabel: "países de origen",
    tone: "Distribución de tono",
    span: "Intervalo de tiempo",
    cue: "Pista de evaluación: la validación cruzada es más fuerte cuando coinciden múltiples dominios, múltiples países y un tono consistente."
  },
  ja: {
    empty: "GDELT のクロス検証: 利用できるニュースイベントがなく、独立した裏付けは弱いです。",
    prefix: "GDELT のクロス検証",
    hitsLabel: "件のヒット",
    domainsLabel: "異なるドメイン",
    countriesLabel: "発信国",
    tone: "トーン分布",
    span: "期間",
    cue: "評価の目安: 複数のドメイン、複数の国、そして一貫したトーンがそろうほどクロス検証は強くなります。"
  },
  zh: {
    empty: "GDELT 交叉验证：没有可用新闻事件，因此独立印证较弱。",
    prefix: "GDELT 交叉验证",
    hitsLabel: "条命中",
    domainsLabel: "个独立域名",
    countriesLabel: "个来源国家",
    tone: "口径分布",
    span: "时间范围",
    cue: "评估提示：当多个域名、多个国家和一致的口径同时出现时，交叉验证会更强。"
  }
};

const SPECIFICITY_COPY = {
  en: {
    dikwText: "DIKW cue: judge whether the claim stays at the data / information / knowledge / wisdom level expected for a verifiable statement, and reward explicit facts, clear structure, and falsifiable detail.",
    fiveW1HText: "5W1H cue: let the model judge whether the claim provides enough who / what / when / where / why / how context, rather than relying on rigid keyword checks.",
    relation: "Data-to-conclusion relevance: if numbers are merely nearby, do not support the conclusion, or key variables are missing, specificity should be scored lower.",
    bayes: "Bayesian heuristic: more precise details, more concrete numbers, and more complete conditions mean lower entropy and easier verification."
  },
  es: {
    dikwText: "Pista DIKW: evalúa si la afirmación se mantiene al nivel de datos / información / conocimiento / sabiduría esperado para una declaración verificable, y premia hechos explícitos, estructura clara y detalle falsable.",
    fiveW1HText: "Pista 5W1H: deja que el modelo juzgue si la afirmación aporta suficiente contexto de quién / qué / cuándo / dónde / por qué / cómo, en lugar de depender de comprobaciones rígidas de palabras clave.",
    relation: "Relevancia entre datos y conclusión: si los números solo están cerca, no respaldan la conclusión o faltan variables clave, la especificidad debe puntuarse más bajo.",
    bayes: "Heurística bayesiana: detalles más precisos, números más concretos y condiciones más completas significan menor entropía y verificación más fácil."
  },
  ja: {
    dikwText: "DIKW の目安: 検証可能な主張として求められるデータ / 情報 / 知識 / 知恵の段階に沿っているかを判断し、明示的な事実、明確な構造、反証可能な詳細を高く評価します。",
    fiveW1HText: "5W1H の目安: 厳密なキーワード判定ではなく、誰 / 何 / いつ / どこ / なぜ / どうやって の文脈が十分かをモデルに判断させます。",
    relation: "データと結論の関連性: 数値が周辺にあるだけで結論を裏付けない、または重要な変数が欠けている場合、具体性のスコアは低くすべきです。",
    bayes: "ベイズ的ヒューリスティック: より正確な詳細、より具体的な数値、より完全な条件ほどエントロピーは低くなり、検証しやすくなります。"
  },
  zh: {
    dikwText: "DIKW 提示：判断这条主张是否停留在适合可验证陈述的数据 / 信息 / 知识 / 智慧层级，并奖励明确事实、清晰结构和可证伪细节。",
    fiveW1HText: "5W1H 提示：让模型判断这个主张是否提供了足够的谁 / 什么 / 何时 / 何地 / 为什么 / 如何 上下文，而不是依赖僵硬的关键词命中。",
    relation: "数据与结论相关性：如果数字只是顺带出现、没有支撑结论，或者缺少关键变量，具体性应降低评分。",
    bayes: "贝叶斯启发：细节越精确、数字越具体、条件越完整，熵越低，越容易验证。"
  }
};

export function buildReproducibilitySummary(gdeltBundle, mbfcEntry, outputLanguage = "en") {
  const copy = REPRODUCIBILITY_COPY[resolveOutputLanguage(outputLanguage)] || REPRODUCIBILITY_COPY.en;
  const lines = [];
  if (mbfcEntry) {
    lines.push(`${copy.mbfc}: ${mbfcEntry.hostname}${mbfcEntry.rating ? ` · ${mbfcEntry.rating}` : ""}${mbfcEntry.label ? ` · ${mbfcEntry.label}` : ""}`);
  } else {
    lines.push(`${copy.mbfc}: ${copy.noMatch}`);
  }

  if (gdeltBundle?.items?.length) {
    const firstDate = gdeltBundle.items[gdeltBundle.items.length - 1]?.retrieved_at || "";
    const lastDate = gdeltBundle.items[0]?.retrieved_at || "";
    const domains = countDistinctValues(gdeltBundle.items.map((item) => item.domain).filter(Boolean));
    lines.push(`${copy.timeline}: ${copy.first} ${formatDateOnly(firstDate)} · ${copy.recent} ${formatDateOnly(lastDate)} · ${copy.distinct} ${domains}`);
  } else {
    lines.push(`${copy.timeline}: ${copy.noData}`);
  }

  lines.push(copy.cue);
  return lines.join("\n");
}

export function buildCrossValidationSummary(gdeltBundle, outputLanguage = "en") {
  const copy = CROSS_VALIDATION_COPY[resolveOutputLanguage(outputLanguage)] || CROSS_VALIDATION_COPY.en;
  const items = Array.isArray(gdeltBundle?.items) ? gdeltBundle.items : [];
  if (items.length === 0) {
    return copy.empty;
  }

  const domains = countDistinctValues(items.map((item) => item.domain).filter(Boolean));
  const countries = countDistinctValues(items.map((item) => item.country).filter(Boolean));
  const tones = summarizeCounts(items.map((item) => item.tone).filter(Boolean));
  const timeline = `${formatDateOnly(items[items.length - 1]?.retrieved_at)} → ${formatDateOnly(items[0]?.retrieved_at)}`;
  return [
    `${copy.prefix}: ${items.length} ${copy.hitsLabel}, ${domains} ${copy.domainsLabel}, ${countries} ${copy.countriesLabel}`,
    tones ? `${copy.tone}: ${tones}` : `${copy.tone}: unavailable`,
    `${copy.span}: ${timeline}`,
    copy.cue
  ].join("\n");
}

// `_input` is intentionally unused: specificity is judged by the model from these
// static cues. The parameter keeps this builder's call signature aligned with the
// other two so callers can pass their primary subject uniformly.
export function buildSpecificitySummary(_input, outputLanguage = "en") {
  const copy = SPECIFICITY_COPY[resolveOutputLanguage(outputLanguage)] || SPECIFICITY_COPY.en;
  return [copy.dikwText, copy.fiveW1HText, copy.relation, copy.bayes].join("\n");
}
