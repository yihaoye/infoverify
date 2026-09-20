// ---------- Mutable runtime state shared across panel modules ----------
// ES module bindings are read-only for importers, so mutable state lives on a
// single shared object whose properties can be reassigned from any module.
export const state = {
  currentVerification: null,
  loadingStartAt: 0,
  loadingHideTimer: 0,
  activeRun: { id: "", mode: "", controller: null },
  mbfcDatasetPromise: null,
  lastDebugTrace: "",
  languageDetectorCache: null,
  translatorCache: new Map()
};
