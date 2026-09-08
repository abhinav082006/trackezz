// ── Internshala Application Detector ────────────────────────
(function () {
  if (window.__jtInternshalaLoaded) return;
  window.__jtInternshalaLoaded = true;
  if (!window.TrackezzUtils) return;

  const { clean } = window.TrackezzUtils;

  // ── Is this the My Applications page? ───────────────────
  function isApplicationsPage() {
    const path = location.pathname;
    return path.includes('/student/applications') ||
           path.includes('/my-applications') ||
           (path.includes('/applications') &&
            !path.includes('/internship/') &&
            !path.includes('/jobs/'));
  }

  // ── Fetch company logo from internship detail page ───────
  async function fetchLogoFromDetailPage(internshipUrl) {
    try {
      const res = await fetch(internshipUrl, { credentials: 'omit' });
      if (!res.ok) return null;
      const html = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const selectors = [
        '.internship_logo img', '.company_logo img',
        '.logo img', 'img.logo', '.company-logo img',
        'img[class*="logo"]', 'img[alt*="logo"]',
        'img[src*="company_logo"]', 'img[src*="logos"]'
      ];
      for (const sel of selectors) {
        const img = doc.querySelector(sel);
        if (img) {
          let src = img.getAttribute('src') || img.getAttribute('data-src') || '';
          if (src && !src.includes('data:') && src.length > 5) {
            if (src.startsWith('//')) src = 'https:' + src;
            else if (src.startsWith('/')) src = 'https://internshala.com' + src;
            return src;
          }
        }
      }
    } catch (e) {
      // silent fail
    }
    return null;
  }

  // ── Scrape all applications from list page ───────────────
  function scrapeApplicationsPage() {
    const results = [];
    const seen = new Set();
    console.log('[Trackezz] Starting scrape...');

    const jobLinks = [...document.querySelectorAll('a[href*="/internship/detail/"]')];
    console.log('[Trackezz] Job links found:', jobLinks.length);

    for (const link of jobLinks) {
      const href = link.getAttribute('href') || '';
      const url = href.startsWith('http') ? href : 'https://internshala.com' + href;
      if (seen.has(url)) continue;
      seen.add(url);

      // Walk up DOM to card container
      let card = link;
      for (let i = 0; i < 8; i++) {
        if (!card.parentElement) break;
        card = card.parentElement;
        if ((card.offsetHeight || 0) > 80 && card.querySelectorAll('*').length > 8) break;
      }

      const cardText = (card.innerText || card.textContent || '');
      const lines = cardText.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });

      // Role: text nodes inside link div (skips "Internship" span)
      let role = 'Unknown Role';
      const linkDiv = link.querySelector('div');
      if (linkDiv) {
        let roleText = '';
        for (let n = 0; n < linkDiv.childNodes.length; n++) {
          if (linkDiv.childNodes[n].nodeType === Node.TEXT_NODE) {
            roleText += linkDiv.childNodes[n].textContent;
          }
        }
        roleText = roleText.trim();
        if (roleText.length > 2) role = roleText;
      }
      if (role === 'Unknown Role' && lines.length > 0) {
        role = lines[0].replace(/internship/i, '').trim();
      }

      // Company: second line of card text
      let company = 'Unknown Company';
      if (lines.length > 1) {
        const skipWords = ['applied', 'rejected', 'offer', 'interview', 'assessment', 'boost'];
        const secondLine = lines[1];
        if (!skipWords.some(function(w) { return secondLine.toLowerCase().includes(w); })) {
          company = secondLine;
        }
      }

      // Status from APPLICATION STATUS column
      let status = 'Applied';
      const textLower = cardText.toLowerCase();
      if (textLower.includes('offer letter') || textLower.includes('offer sent')) {
        status = 'Offer';
      } else if (textLower.includes('hired')) {
        status = 'Hired';
      } else if (textLower.includes('not selected') || textLower.includes('rejected') || textLower.includes('not shortlisted')) {
        status = 'Rejected';
      } else if (textLower.includes('in-touch') || textLower.includes('in touch') || textLower.includes('interviewed') || textLower.includes('shortlisted') || textLower.includes('interview')) {
        status = 'Interview';
      } else if (textLower.includes('assessment') || textLower.includes('assignment') || textLower.includes('test link')) {
        status = 'OA';
      }

      // Date: "Applied on 12 Jun' 26"
      let appliedDate = new Date().toISOString();
      const dateMatch = cardText.match(/applied\s+on\s+(\d{1,2})\s+(\w+)['\s]+(\d{2,4})/i);
      if (dateMatch) {
        var year = dateMatch[3];
        if (year.length === 2) year = '20' + year;
        const parsed = new Date(dateMatch[1] + ' ' + dateMatch[2] + ' ' + year);
        if (!isNaN(parsed.getTime())) appliedDate = parsed.toISOString();
      }

      if (role && role !== 'Unknown Role') {
        console.log('[Trackezz]', role, '|', company, '|', status);
        results.push({
          role: role,
          company: company,
          status: status,
          site: 'Internshala',
          url: url,
          appliedDate: appliedDate,
          logoUrl: null,
          source: 'scrape'
        });
      }
    }

    console.log('[Trackezz] Total scraped:', results.length);
    return results;
  }

  // ── Fetch logos in background after saving ───────────────
  function fetchLogosInBackground(apps) {
    setTimeout(async function() {
      for (var i = 0; i < Math.min(apps.length, 20); i++) {
        var app = apps[i];
        if (app.url && app.url.includes('/internship/detail/')) {
          var logoUrl = await fetchLogoFromDetailPage(app.url);
          if (logoUrl) {
            chrome.runtime.sendMessage({
              type: 'UPDATE_LOGO',
              role: app.role,
              company: app.company,
              site: 'Internshala',
              logoUrl: logoUrl
            });
          }
        }
      }
      console.log('[Trackezz] Logo fetching complete');
    }, 1500);
  }

  // ── Message listener: manual "Import All" from popup ─────
  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.type === 'SCRAPE_INTERNSHALA') {
      var apps = scrapeApplicationsPage();
      // Respond immediately — don't wait for logos
      sendResponse({ success: true, applications: apps });
      // Fetch logos in background after responding
      fetchLogosInBackground(apps);
    }
    return true;
  });

  // ── Auto-scrape when user lands on applications page ─────
  if (isApplicationsPage()) {
    setTimeout(function() {
      var apps = scrapeApplicationsPage();
      if (apps.length === 0) return;

      // Save immediately
      chrome.runtime.sendMessage({ type: 'BULK_SAVE_JOBS', jobs: apps }, function(res) {
        if (res && res.added > 0) {
          TrackezzUtils.showToast('Imported ' + res.added + ' new application' + (res.added > 1 ? 's' : '') + ' from Internshala!');
        }
      });

      // Fetch logos in background
      fetchLogosInBackground(apps);
    }, 5000);
  }

  console.log('[Trackezz] Internshala scraper loaded');
})();
