const MENU_ID_VERIFY = "infoverify.verifySelection";

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create({
    id: MENU_ID_VERIFY,
    title: "核实 (文本优先/否则URL)",
    contexts: ["selection", "page"]
  });

  // Make sure the side panel is enabled on all sites.
  if (chrome.sidePanel?.setOptions) {
    await chrome.sidePanel.setOptions({
      enabled: true,
      path: "src/panel/panel.html"
    });
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId !== MENU_ID_VERIFY) return;

  // Open side panel in response to a user gesture.
  try {
    if (chrome.sidePanel?.open) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
  } catch {
    // Ignore; panel might still be opened manually by the user.
  }

  const selectionText = info.selectionText?.trim() || "";
  const url = tab.url || "";

  broadcastToTab(tab.id, { type: "VERIFY_STARTED", payload: { selectionText, url } });

  const result = await verifyViaBackend({ selectionText, url });
  broadcastToTab(tab.id, { type: "VERIFY_RESULT", payload: result });
});

function broadcastToTab(tabId, message) {
  // Side panel scripts can receive runtime messages; we include tabId so the panel can filter.
  chrome.runtime.sendMessage({ ...message, tabId }).catch(() => {});
}

async function verifyViaBackend({ selectionText, url }) {
  const { apiBaseUrl, mockDelayMs, enableLLMAssessment } = await chrome.storage.sync.get({
    apiBaseUrl: "http://localhost:8080",
    mockDelayMs: 0,
    enableLLMAssessment: false
  });

  // Optional artificial delay for UI testing.
  if (Number(mockDelayMs) > 0) {
    await new Promise((r) => setTimeout(r, Number(mockDelayMs) || 0));
  }

  const endpoint = `${String(apiBaseUrl).replace(/\/$/, "")}/api/basic/score`;
  const capturedAt = new Date().toISOString();

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: selectionText,
        url,
        llm: Boolean(enableLLMAssessment)
      })
    });

    if (!resp.ok) {
      const text = await safeReadText(resp);
      return errorResult({
        selectionText,
        url,
        capturedAt,
        message: `后端返回错误：HTTP ${resp.status}${text ? ` - ${text}` : ""}`
      });
    }

    const data = await resp.json();
    return mapBackendScoreToPanelPayload({ selectionText, url, capturedAt, data });
  } catch (e) {
    return errorResult({
      selectionText,
      url,
      capturedAt,
      message: `无法连接后端：${String(e?.message || e)}（确认已启动：go run ./cmd/infoverify -mode server）`
    });
  }
}

function mapBackendScoreToPanelPayload({ selectionText, url, capturedAt, data }) {
  const overall = typeof data?.overall_score === "number" ? data.overall_score : 0;
  const confidence = clamp(overall, 0, 1);
  const verdict = overall >= 0.7 ? "supported" : overall <= 0.3 ? "contradicted" : "unclear";

  const ruleScores = data?.rule_scores || {};
  const summary = `总分 ${(overall * 100).toFixed(0)}% · cross ${(pct(ruleScores.cross_validation_text))} · repro ${(pct(ruleScores.reproducibility))} · detail ${(pct(ruleScores.detail_richness))}`;

  const evidence = flattenEvidence(data?.results);

  return {
    verdict,
    summary,
    confidence,
    query: {
      selectionText,
      url,
      capturedAt,
      api: "infoverify",
      endpoint: "/api/basic/score"
    },
    evidence,
    conflicts: [],
    missing: [],
    trace_id: data?.trace_id || crypto.randomUUID(),
    backend: data
  };
}

function flattenEvidence(results) {
  if (!Array.isArray(results)) return [];
  const out = [];
  for (const r of results) {
    if (!Array.isArray(r?.evidence)) continue;
    for (const ev of r.evidence) {
      out.push({
        title: `${r.skill || "rule"} · ${ev.source || "evidence"}`,
        url: ev.url || "",
        quote: ev.excerpt || r.summary || "",
        retrieved_at: "",
        source_type: ev.type || "metric"
      });
    }
  }
  return out;
}

function errorResult({ selectionText, url, capturedAt, message }) {
  return {
    verdict: "unclear",
    summary: message,
    confidence: 0,
    query: { selectionText, url, capturedAt },
    evidence: [
      {
        title: "当前页面",
        url,
        quote: selectionText.slice(0, 160),
        retrieved_at: capturedAt,
        source_type: "page"
      }
    ],
    conflicts: [],
    missing: ["请启动后端或检查 apiBaseUrl 设置"],
    trace_id: crypto.randomUUID()
  };
}

async function safeReadText(resp) {
  try {
    return (await resp.text())?.slice(0, 500);
  } catch {
    return "";
  }
}

function clamp(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function pct(v) {
  if (typeof v !== "number") return "—";
  return `${Math.round(v * 100)}%`;
}
