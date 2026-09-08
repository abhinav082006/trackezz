// ── Content Script Shared Utils ──────────────────────────────
// Injected before every site-specific content script

window.TrackezzUtils = {
  // Send job to background for saving
  saveJob(data) {
    chrome.runtime.sendMessage({
      type: 'SAVE_JOB',
      data: {
        company: data.company || 'Unknown Company',
        role: data.role || 'Unknown Role',
        site: data.site || 'Unknown',
        url: data.url || window.location.href,
        logoUrl: data.logoUrl || null,
        appliedDate: new Date().toISOString(),
        status: 'Applied',
        source: 'auto'
      }
    }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response?.success) {
        console.log(`[Trackezz] ✅ Saved: ${data.role} at ${data.company}`);
        TrackezzUtils.showToast(`✅ Tracked: ${data.role} at ${data.company}`);
      }
    });
  },

  // Find element by multiple selectors (returns first match)
  findElement(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) return el;
      } catch { /* invalid selector */ }
    }
    return null;
  },

  // Clean text: trim + collapse whitespace
  clean(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  },

  // Parse relative date string like "2d ago", "Applied 3 days ago", "Jun 12"
  parseRelativeDate(text) {
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

    const absMatch = text.match(/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?:\s+(\d{4}))?/i);
    if (absMatch) {
      const year = absMatch[3] || new Date().getFullYear();
      const parsed = new Date(`${absMatch[1]} ${absMatch[2]} ${year}`);
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    }

    return now.toISOString();
  },

  // Show a brief toast notification in the page
  showToast(message) {
    const existing = document.getElementById('jt-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'jt-toast';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed; bottom: 24px; right: 24px; z-index: 999999;
      background: #FAFCFB; color: #657166; border: 1.5px solid rgba(153,205,216,0.5);
      padding: 10px 16px; border-radius: 50px; font-size: 12.5px; font-weight: 600;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      box-shadow: 0 8px 28px rgba(101,113,102,0.18); max-width: 300px;
      animation: jtSlideIn 0.3s cubic-bezier(0.34,1.56,0.64,1);
    `;

    // Add animation style
    if (!document.getElementById('jt-style')) {
      const style = document.createElement('style');
      style.id = 'jt-style';
      style.textContent = `
        @keyframes jtSlideIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  },

  // Watch DOM for changes with callback (throttled)
  watchDOM(callback) {
    let timer;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(callback, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return observer;
  },

  // Wait for element to appear in DOM
  waitForElement(selector, timeout = 10000) {
    return new Promise((resolve) => {
      const existing = document.querySelector(selector);
      if (existing) return resolve(existing);
      const timer = setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) { clearTimeout(timer); observer.disconnect(); resolve(el); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }
};
