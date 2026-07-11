// ── Naukri Application Detector ──────────────────────────────
// Scrapes "Job application status" page (myapply/historypage).
// Note: Naukri's applied-jobs cards have no application date and
// no internal job link for "web jobs" (external applications) —
// so date defaults to scrape time and URL may be blank.
(function () {
  if (window.__jtNaukriLoaded) return;
  window.__jtNaukriLoaded = true;
  if (!window.TrackezzUtils) return;

  const { clean } = window.TrackezzUtils;

  function isAppliedPage() {
    return location.pathname.includes('/myapply/historypage');
  }

  function scrapeAppliedPage() {
    const results = [];
    const seen = new Set();

    console.log('[Trackezz] Naukri: Starting scrape...');

    // Each application card: .ot__jdTupleContainer (inside the left list)
    const cards = [...document.querySelectorAll('.ot__jdTupleContainer')];
    console.log('[Trackezz] Naukri: Cards found:', cards.length);

    for (const card of cards) {
      const roleEl = card.querySelector('.jdTitle');
      const companyEl = card.querySelector('.company');

      const role = clean(roleEl?.getAttribute('title') || roleEl?.textContent) || 'Unknown Role';
      const company = clean(companyEl?.getAttribute('title') || companyEl?.textContent) || 'Unknown Company';

      if (role === 'Unknown Role') continue;

      // Dedup by role+company since there's no reliable URL/ID for external jobs
      const key = (role + '|' + company).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      // No application date available on this page — default to today
      const appliedDate = new Date().toISOString();

      // No internal job link for external "web jobs" — use current page as fallback
      const url = location.href;

      // Naukri company logo
      let logoUrl = null;
      const logoImg = card.querySelector('img[class*="logo"], img[class*="org"], img[src*="naukri.com"]');
      if (logoImg?.src && !logoImg.src.includes('data:')) logoUrl = logoImg.src;

      console.log('[Trackezz] Naukri:', role, '|', company);
      results.push({ role, company, status: 'Applied', site: 'Naukri', url, appliedDate, logoUrl, source: 'scrape' });
    }

    console.log('[Trackezz] Naukri: Total scraped:', results.length);
    return results;
  }

  // Listen for scrape request from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SCRAPE_NAUKRI') {
      const apps = scrapeAppliedPage();
      sendResponse({ success: true, applications: apps });
    }
    return true;
  });

  // Auto-scrape when on applied page
  if (isAppliedPage()) {
    setTimeout(() => {
      const apps = scrapeAppliedPage();
      if (apps.length > 0) {
        chrome.runtime.sendMessage({ type: 'BULK_SAVE_JOBS', jobs: apps }, (res) => {
          if (res?.added > 0) {
            TrackezzUtils.showToast(`✅ Imported ${res.added} new application${res.added > 1 ? 's' : ''} from Naukri!`);
          }
        });
      }
    }, 3000);
  }

  console.log('[Trackezz] Naukri scraper loaded ✅');
})();
