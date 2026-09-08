// ── Indeed Application Detector ──────────────────────────────
(function () {
  if (window.__jtIndeedLoaded) return;
  window.__jtIndeedLoaded = true;
  if (!window.TrackezzUtils) return;

  const { clean } = window.TrackezzUtils;

  // ── MODE 1: "My Applied Jobs" page scraper ───────────────
  // URL: https://myjobs.indeed.com/applied
  function isAppliedPage() {
    return location.hostname.includes('myjobs.indeed.com') ||
           location.href.includes('indeed.com/applied') ||
           location.pathname.includes('/applied');
  }

  function scrapeAppliedPage() {
    const results = [];
    const seen = new Set();

    console.log('[Trackezz] Indeed: Starting scrape...');

    // Find all job links — Indeed uses /viewjob?jk=...
    const allLinks = [...document.querySelectorAll('a[href]')];
    const jobLinks = allLinks.filter(a => {
      const href = a.href || '';
      return href.includes('/viewjob') || href.includes('jk=');
    });

    console.log('[Trackezz] Indeed: Job links found:', jobLinks.length);

    for (const link of jobLinks) {
      const url = link.href;
      if (seen.has(url)) continue;
      seen.add(url);

      // Walk up to card container
      let card = link;
      for (let i = 0; i < 6; i++) {
        if (!card.parentElement) break;
        card = card.parentElement;
        if ((card.offsetHeight || 0) > 60 && card.querySelectorAll('*').length > 5) break;
      }

      // ── Role: class="atw-JobInfo-jobTitle" ───────────────
      let role = 'Unknown Role';
      const roleEl = card.querySelector('.atw-JobInfo-jobTitle') ||
                     card.querySelector('[class*="jobTitle"]') ||
                     card.querySelector('[role="heading"] a');
      if (roleEl) {
        // Remove child spans like "job description opens in a new window"
        const clone = roleEl.cloneNode(true);
        clone.querySelectorAll('span').forEach(s => s.remove());
        role = clean(clone.textContent) || clean(roleEl.firstChild?.textContent) || 'Unknown Role';
      }

      // ── Company: first span in .atw-JobInfo-companyLocation ──
      let company = 'Unknown Company';
      const companyWrap = card.querySelector('.atw-JobInfo-companyLocation') ||
                          card.querySelector('[class*="companyLocation"]');
      if (companyWrap) {
        const firstSpan = companyWrap.querySelector('span');
        if (firstSpan) company = clean(firstSpan.textContent);
      }

      // ── Status: from .atw-StatusTag-description ───────────
      let status = 'Applied';
      const statusEl = card.querySelector('.atw-StatusTag-description') ||
                       card.querySelector('[class*="StatusTag"]');
      if (statusEl) {
        const rawStatus = clean(statusEl.textContent).toLowerCase();
        if (rawStatus.includes('interview')) status = 'Interview';
        else if (rawStatus.includes('offer')) status = 'Offer';
        else if (rawStatus.includes('reject') || rawStatus.includes('not selected')) status = 'Rejected';
        else if (rawStatus.includes('assessment') || rawStatus.includes('test')) status = 'OA';
        else status = 'Applied';
      }

      // ── Date: "Applied on Indeed on 6 Jun" ────────────────
      let appliedDate = new Date().toISOString();
      const cardText = card.innerText || card.textContent || '';

      // Pattern: "Applied on Indeed on DD Mon" or "Applied on DD Mon YYYY"
      const dateMatch = cardText.match(
        /applied\s+on\s+(?:indeed\s+on\s+)?(\d{1,2}\s+\w+(?:\s+\d{4})?)/i
      );
      if (dateMatch) {
        // "6 Jun" — add current year if missing
        let dateStr = dateMatch[1].trim();
        if (!dateStr.match(/\d{4}/)) dateStr += ' ' + new Date().getFullYear();
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) appliedDate = parsed.toISOString();
      }

      // Indeed shows company logo in card
      let logoUrl = null;
      const logoImg = card.querySelector('img[class*="companyAvatar"], img[class*="logo"], img[src*="indeed.com"]');
      if (logoImg?.src && !logoImg.src.includes('data:')) logoUrl = logoImg.src;

      if (role !== 'Unknown Role') {
        console.log('[Trackezz] Indeed:', role, '|', company, '|', status, '|', appliedDate);
        results.push({ role, company, status, site: 'Indeed', url, appliedDate, logoUrl, source: 'scrape' });
      }
    }

    console.log('[Trackezz] Indeed: Total scraped:', results.length);
    return results;
  }

  // Listen for scrape request from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SCRAPE_INDEED') {
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
            TrackezzUtils.showToast(`✅ Imported ${res.added} new application${res.added > 1 ? 's' : ''} from Indeed!`);
          }
          // Silently skip if all already tracked
        });
      }
    }, 2000);
  }

  console.log('[Trackezz] Indeed scraper loaded ✅');

})();
