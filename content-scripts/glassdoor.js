// ── Glassdoor Application Detector ───────────────────────────
// Live click-detection removed (unreliable across UI changes).
// "My Applications" page scraper not built yet — manual add works
// in the meantime.
(function () {
  if (window.__jtGlassdoorLoaded) return;
  window.__jtGlassdoorLoaded = true;
  if (!window.TrackezzUtils) return;

  console.log('[Trackezz] Glassdoor: no scraper configured yet — use manual add for now.');
})();
