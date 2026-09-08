// ── Unstop Application Detector ──────────────────────────────
// Only feature: scrape "My Registrations" page for internships/jobs.
// Live click-detection removed — too unreliable.
(function () {
  if (window.__jtUnstopLoaded) return;
  window.__jtUnstopLoaded = true;
  if (!window.TrackezzUtils) return;

  const { clean } = window.TrackezzUtils;

  // ════════════════════════════════════════════════════════════
  // MY REGISTRATIONS PAGE SCRAPER
  // ════════════════════════════════════════════════════════════
  function isRegistrationsPage() {
    return location.pathname.includes('/user/registrations');
  }

  // Extract company name from URL slug
  // "web-designer-internship-elwebee-1696943" → "Elwebee"
  // Strategy: remove trailing numeric ID, remove common role words,
  // take the last remaining word(s) as company
  function extractCompanyFromUrl(url) {
    try {
      const path = new URL(url).pathname; // /internships/web-designer-internship-elwebee-1696943
      const slug = path.split('/').filter(Boolean).pop() || '';
      // Remove trailing numeric ID
      const withoutId = slug.replace(/-\d+$/, '');
      const words = withoutId.split('-');

      // Common role/category words to strip from the end-to-find company
      const roleWords = new Set([
        'internship', 'job', 'jobs', 'internships', 'work', 'from', 'home',
        'part', 'time', 'full', 'remote', 'developer', 'designer', 'engineer',
        'intern', 'trainee', 'associate', 'executive', 'manager', 'analyst',
        'web', 'app', 'mobile', 'software', 'frontend', 'backend', 'fullstack',
        'data', 'science', 'marketing', 'sales', 'content', 'writer', 'graphic',
        'ui', 'ux', 'product', 'business', 'hr', 'finance', 'operations'
      ]);

      // Find the longest trailing run of words NOT in roleWords — that's likely the company
      let companyWords = [];
      for (let i = words.length - 1; i >= 0; i--) {
        const w = words[i].toLowerCase();
        if (roleWords.has(w)) break;
        companyWords.unshift(words[i]);
      }

      if (companyWords.length === 0) return 'Unknown Company';
      const company = companyWords.join(' ');
      // Capitalize each word
      return company.replace(/\b\w/g, c => c.toUpperCase());
    } catch (e) {
      return 'Unknown Company';
    }
  }

  function mapStatus(rawStatus) {
    const s = (rawStatus || '').toLowerCase();
    if (s.includes('select') || s.includes('winner') || s.includes('hired')) return 'Offer';
    if (s.includes('interview') || s.includes('shortlist')) return 'Interview';
    if (s.includes('reject') || s.includes('not selected')) return 'Rejected';
    if (s.includes('assessment') || s.includes('test')) return 'OA';
    // "Completed" just means the registration window closed — not an outcome
    if (s.includes('completed') || s.includes('registered') || s.includes('applied')) return 'Applied';
    return 'Applied';
  }

  function parseDate(text) {
    // "Registered on: 21 Jun 26, 02:44 PM IST"
    const match = text.match(/registered\s+on:?\s*(\d{1,2}\s+\w+\s+\d{2,4})/i);
    if (match) {
      let dateStr = match[1];
      // Handle 2-digit year
      const parts = dateStr.split(/\s+/);
      if (parts[2] && parts[2].length === 2) parts[2] = '20' + parts[2];
      const parsed = new Date(parts.join(' '));
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    }
    return new Date().toISOString();
  }

  function scrapeRegistrationsPage() {
    const results = [];
    const seen = new Set();

    console.log('[Trackezz] Unstop: Starting scrape...');

    // Only internships and jobs — skip hackathons/events/competitions
    const jobLinks = [...document.querySelectorAll('a[href*="/internships/"], a[href*="/job/"]')]
      .filter(a => !a.href.includes('/user/'));

    console.log('[Trackezz] Unstop: Job/internship links found:', jobLinks.length);

    for (const link of jobLinks) {
      const url = link.href.split('?')[0];
      if (seen.has(url)) continue;
      seen.add(url);

      // Walk up to card container
      let card = link;
      for (let i = 0; i < 8; i++) {
        if (!card.parentElement) break;
        card = card.parentElement;
        if ((card.offsetHeight || 0) > 80) break;
      }

      const cardText = card.innerText || card.textContent || '';
      const lines = cardText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

      // Role: first line
      const role = lines[0] || 'Unknown Role';

      // Company: from URL slug (not present in card text)
      const company = extractCompanyFromUrl(url);

      // Status: last line is usually the status (Completed, Selected, etc.)
      const rawStatus = lines[lines.length - 1] || '';
      const status = mapStatus(rawStatus);

      // Date
      const appliedDate = parseDate(cardText);

      // Determine if internship or job
      const site = url.includes('/job/') ? 'Unstop' : 'Unstop';

      // Unstop event/company logo
      let logoUrl = null;
      const logoImg = card.querySelector('img[class*="logo"], img[class*="banner"], img[src*="unstop.com"], img[src*="d8it4huxumprk.cloudfront"]');
      if (logoImg?.src && !logoImg.src.includes('data:')) logoUrl = logoImg.src;

      if (role && role !== 'Unknown Role') {
        console.log('[Trackezz] Unstop:', role, '|', company, '|', status, '|', appliedDate);
        results.push({ role, company, status, site, url, appliedDate, logoUrl, source: 'scrape' });
      }
    }

    console.log('[Trackezz] Unstop: Total scraped:', results.length);
    return results;
  }

  // Listen for scrape request from popup (manual "Import All" button)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SCRAPE_UNSTOP') {
      const apps = scrapeRegistrationsPage();
      sendResponse({ success: true, applications: apps });
    }
    return true;
  });

  // Auto-scrape when on registrations page
  if (isRegistrationsPage()) {
    setTimeout(() => {
      const apps = scrapeRegistrationsPage();
      if (apps.length > 0) {
        chrome.runtime.sendMessage({ type: 'BULK_SAVE_JOBS', jobs: apps }, (res) => {
          if (res?.added > 0) {
            TrackezzUtils.showToast(`✅ Imported ${res.added} new application${res.added > 1 ? 's' : ''} from Unstop!`);
          }
        });
      }
    }, 3000);
  }

  console.log('[Trackezz] Unstop scraper loaded ✅');
})();
