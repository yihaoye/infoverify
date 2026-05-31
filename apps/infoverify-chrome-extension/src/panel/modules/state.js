// ---------- Mutable runtime state shared across panel modules ----------
// ES module bindings are read-only for importers, so mutable state lives on a
// single shared object whose properties can be reassigned from any module.
export const state = {
  currentVerification: null,
  loadingStartAt: 0,
  loadingHideTimer: 0,
  activeRun: { id: "", mode: "", controller: null },
  gdeltRequestChain: Promise.resolve(),
  gdeltLastRequestAt: 0,
  mbfcDatasetPromise: null,
  gdeltCooldownUntil: 0,
  lastDebugTrace: "",
  languageDetectorCache: null,
  translatorCache: new Map()
};
