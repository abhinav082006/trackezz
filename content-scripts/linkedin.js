// ── LinkedIn Application Detector ───────────────────────────
(function () {
  if (window.__jtLinkedInLoaded) return;
  window.__jtLinkedInLoaded = true;
  if (!window.TrackezzUtils) return;

  const { clean } = window.TrackezzUtils;

  // ── MODE 1: Jobs Tracker page scraper ────────────────────
  // URL: linkedin.com/jobs-tracker/?stage=applied
  function isAppliedPage() {
    return location.pathname.includes('/jobs-tracker') ||
           location.href.includes('stage=applied');
  }

  // Convert relative time to real date
  // "6h ago" → today, "2d ago" → 2 days back, "1w ago" → 7 days back
  function parseRelativeDate(text) {
    if (!text) return new Date().toISOString();
    const t = text.toLowerCase();
    const now = new Date();

    const minsMatch = t.match(/(\d+)\s*m(?:in)?/);
    const hoursMatch = t.match(/(\d+)\s*h/);
    const daysMatch = t.match(/(\d+)\s*d/);
    const weeksMatch = t.match(/(\d+)\s*w/);
    const monthsMatch = t.match(/(\d+)\s*mo/);

    if (minsMatch) now.setMinutes(now.getMinutes() - parseInt(minsMatch[1]));
    else if (hoursMatch) now.setHours(now.getHours() - parseInt(hoursMatch[1]));
    else if (daysMatch) now.setDate(now.getDate() - parseInt(daysMatch[1]));
    else if (weeksMatch) now.setDate(now.getDate() - parseInt(weeksMatch[1]) * 7);
    else if (monthsMatch) now.setMonth(now.getMonth() - parseInt(monthsMatch[1]));

    // Also try absolute date format "Jun 12" or "12 Jun 2024"
    const absMatch = text.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:\s+(\d{4}))?/i);
    if (absMatch) {
      const year = absMatch[3] || new Date().getFullYear();
      const parsed = new Date(`${absMatch[1]} ${absMatch[2]} ${year}`);
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    }

    return now.toISOString();
  }

  function scrapeAppliedPage() {
    const results = [];
    const seen = new Set();

    console.log('[Trackezz] LinkedIn: Starting scrape...');

    // Find all job view links
    const jobLinks = [...document.querySelectorAll('a[href*="/jobs/view/"]')];
    console.log('[Trackezz] LinkedIn: Job links found:', jobLinks.length);

    for (const link of jobLinks) {
      const url = link.href.split('?')[0]; // clean URL
      if (seen.has(url)) continue;
      seen.add(url);

      // Walk up ONLY 4 levels — avoid hitting table headers like "Jobs"/"Connections"
      let card = link;
      for (let i = 0; i < 4; i++) {
        if (!card.parentElement) break;
        card = card.parentElement;
      }

      const cardText = (card.innerText || card.textContent || '');
      const lines = cardText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

      // Validate first line is a real job title — skip table headers
      const skipWords = ['jobs', 'connections', 'notes', 'saved', 'interview', 'archived', 'in progress'];
      const firstLine = (lines[0] || '').toLowerCase();
      if (skipWords.some(w => firstLine === w)) continue;

      // Link text = "HTML/CSS Developer (Freelancer)Deccan AI Experts · Gurugram"
      // Role and company are concatenated — split on " · " first
      const linkText = link.textContent.replace(/\s+/g, ' ').trim();

      let role = 'Unknown Role';
      let company = 'Unknown Company';

      if (linkText.includes('·')) {
        // Split on " · " — before is "RoleCompany", after is location
        const beforeDot = linkText.split('·')[0].trim();
        // Now separate role from company
        // Strategy: role is usually in Title Case and ends before company starts
        // Try splitting on known title words or use card lines
        const roleFromLine = lines.find(l =>
          !l.includes('·') && !l.includes('Applied') &&
          !l.includes('Posted') && l.length > 3 &&
          !skipWords.some(w => l.toLowerCase() === w)
        );
        role = roleFromLine || beforeDot;

        // Company: find line with " · " and take part before it
        const compLine = lines.find(l => l.includes('·') &&
          !l.includes('Applied') && !l.includes('Posted'));
        if (compLine) company = clean(compLine.split('·')[0]);
      } else {
        // No dot separator — role is first clean line
        role = lines.find(l =>
          l.length > 3 && !skipWords.some(w => l.toLowerCase() === w)
        ) || linkText;
      }

      // ── Status: check for "Did you hear back?" responses ───
      let status = 'Applied';
      const textLower = cardText.toLowerCase();
      if (textLower.includes('offer') || textLower.includes('hired')) status = 'Offer';
      else if (textLower.includes('interview')) status = 'Interview';
      else if (textLower.includes('rejected') || textLower.includes('not selected')) status = 'Rejected';

      // ── Date: "Applied 6h ago", "Applied 2d ago" ───────────
      let appliedDate = new Date().toISOString();
      const appliedMatch = cardText.match(/applied\s+(.+?)(?:\n|\(|$)/i);
      if (appliedMatch) {
        appliedDate = parseRelativeDate(appliedMatch[1].trim());
      }

      if (role && role !== 'Unknown Role') {
        console.log('[Trackezz] LinkedIn:', role, '|', company, '|', status, '|', appliedDate);
        results.push({ role, company, status, site: 'LinkedIn', url, appliedDate, source: 'scrape' });
      }
    }

    console.log('[Trackezz] LinkedIn: Total scraped:', results.length);
    return results;
  }

  // Listen for scrape request from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SCRAPE_LINKEDIN') {
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
            TrackezzUtils.showToast(`✅ Imported ${res.added} new application${res.added > 1 ? 's' : ''} from LinkedIn!`);
          }
          // Silently skip if all already tracked
        });
      }
    }, 5500);
  }

  console.log('[Trackezz] LinkedIn scraper loaded ✅');

})();
