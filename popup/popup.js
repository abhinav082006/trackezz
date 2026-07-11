// ── Trackezz — Popup JS ──────────────────────────────────

let allJobs = [];
let currentFilter = 'all';
let currentSearch = '';
let isGmailConnected = false;

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await applyTheme();
  await loadJobs();
  await loadGmailStatus();
  setupEventListeners();
  setDefaultDate();
});

async function applyTheme() {
  const settings = await sendMessage({ type: 'GET_SETTINGS' });
  const theme = settings.theme || 'auto';
  document.body.classList.remove('dark-mode', 'light-mode');
  if (theme === 'dark') document.body.classList.add('dark-mode');
  if (theme === 'light') document.body.classList.add('light-mode');
}

async function loadJobs() {
  const res = await sendMessage({ type: 'GET_JOBS' });
  allJobs = res.jobs || [];
  renderAll();
}

async function loadGmailStatus() {
  const settings = await sendMessage({ type: 'GET_SETTINGS' });
  isGmailConnected = settings.gmailConnected || false;
  updateGmailButton();
}

// ── Render ────────────────────────────────────────────────────
function renderAll() {
  updateStats();
  renderJobList();
}

function updateStats() {
  const count = (status) => allJobs.filter(j => j.status === status).length;
  setText('totalCount', allJobs.length);
  setText('appliedCount', count('Applied'));
  setText('oaCount', count('OA'));
  setText('interviewCount', count('Interview'));
  setText('offerCount', count('Offer'));
}

function isStale(job) {
  if (job.status !== 'Applied') return false;
  const daysSince = Math.floor((Date.now() - new Date(job.appliedDate).getTime()) / 86400000);
  return daysSince >= 7;
}

function renderJobList() {
  const list = document.getElementById('jobList');
  const empty = document.getElementById('emptyState');

  const filtered = allJobs.filter(job => {
    const matchFilter = currentFilter === 'all' ||
      (currentFilter === 'followup' ? isStale(job) : job.status === currentFilter);
    const matchSearch = !currentSearch ||
      job.company.toLowerCase().includes(currentSearch) ||
      job.role.toLowerCase().includes(currentSearch) ||
      job.site.toLowerCase().includes(currentSearch);
    return matchFilter && matchSearch;
  });

  // Clear existing cards (keep empty state)
  const cards = list.querySelectorAll('.job-card');
  cards.forEach(c => c.remove());

  if (filtered.length === 0) {
    empty.style.display = 'flex';
    empty.querySelector('.empty-title').textContent =
      currentFilter === 'followup' ? 'Nothing needs a follow-up 🎉' :
      currentSearch || currentFilter !== 'all' ? 'No matching applications' : 'No applications yet';
    return;
  }

  empty.style.display = 'none';

  filtered.forEach(job => {
    const card = createJobCard(job);
    list.appendChild(card);
  });
}

function createJobCard(job) {
  const card = document.createElement('div');
  card.className = 'job-card';
  card.dataset.id = job.id;

  const initial = (job.company || '?').charAt(0).toUpperCase();
  const statusClass = `status-${job.status.toLowerCase()}`;
  const date = formatDate(job.appliedDate);
  const staleFlag = isStale(job) ? '<span class="stale-flag" title="No update in 7+ days">⏰</span>' : '';

  // Use logo fetched from job site during scraping, fallback to letter
  const avatarHtml = job.logoUrl
    ? `<div class="job-avatar job-avatar--logo">
         <img src="${escHtml(job.logoUrl)}" alt="${initial}"
           onerror="this.parentElement.classList.remove('job-avatar--logo');this.parentElement.textContent='${initial}';" />
       </div>`
    : `<div class="job-avatar">${initial}</div>`;

  const tagsHtml = (job.tags && job.tags.length > 0)
    ? `<div class="card-tags">${job.tags.slice(0,3).map(t => `<span class="card-tag">${escHtml(t)}</span>`).join('')}</div>`
    : '';
  const notePreview = job.notes
    ? `<div class="card-note-preview">${escHtml(job.notes.split('\n')[0].substring(0, 50))}</div>`
    : '';

  card.innerHTML = `
    ${avatarHtml}
    <div class="job-info">
      <div class="job-role" title="${escHtml(job.role)}">${escHtml(job.role)} ${staleFlag}</div>
      <div class="job-meta">
        <span class="job-company" title="${escHtml(job.company)}">${escHtml(job.company)}</span>
        <span class="job-site-badge">${escHtml(job.site)}</span>
      </div>
      ${tagsHtml}
      ${notePreview}
    </div>
    <div class="job-right">
      <span class="status-badge ${statusClass}">${job.status}</span>
      <span class="job-date">${date}</span>
    </div>
  `;

  card.addEventListener('click', () => openEditModal(job));
  return card;
}

// ── Event Listeners ──────────────────────────────────────────
function setupEventListeners() {
  // Filter tabs
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderJobList();
    });
  });

  // Search
  document.getElementById('searchInput').addEventListener('input', (e) => {
    currentSearch = e.target.value.toLowerCase().trim();
    renderJobList();
  });

  // Add button
  document.getElementById('addBtn').addEventListener('click', openAddModal);

  // Export CSV
  document.getElementById('exportBtn').addEventListener('click', exportCSV);

  // Stats — open in a fixed popup window
  document.getElementById('statsBtn').addEventListener('click', () => {
    chrome.windows.create({
      url: chrome.runtime.getURL('popup/stats.html'),
      type: 'popup',
      width: 420,
      height: 620
    });
  });

  // Settings
  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Gmail button
  document.getElementById('gmailBtn').addEventListener('click', handleGmailClick);

  // Internshala scrape button
  document.getElementById('scrapeNowBtn')?.addEventListener('click', scrapeInternshala);

  // Check if current tab is Internshala applications page
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs[0]?.url || '';
    let scrapesite = null;
    let bannerText = '';

    if (url.includes('internshala.com') && (url.includes('application') || url.includes('student'))) {
      scrapesite = 'internshala'; bannerText = '📋 You\'re on Internshala Applications!';
    } else if (url.includes('indeed.com') && url.includes('applied')) {
      scrapesite = 'indeed'; bannerText = '📋 You\'re on Indeed Applied Jobs!';
    } else if (url.includes('linkedin.com') && (url.includes('jobs-tracker') || url.includes('stage=applied'))) {
      scrapesite = 'linkedin'; bannerText = '📋 You\'re on LinkedIn Applied Jobs!';
    } else if (url.includes('unstop.com') && url.includes('/user/registrations')) {
      scrapesite = 'unstop'; bannerText = '📋 You\'re on Unstop Registrations!';
    } else if (url.includes('naukri.com') && url.includes('/myapply/historypage')) {
      scrapesite = 'naukri'; bannerText = '📋 You\'re on Naukri Applied Jobs!';
    }

    if (scrapesite) {
      document.getElementById('scrapeBanner').style.display = 'flex';
      document.getElementById('scrapeBannerText').textContent = bannerText;
      document.getElementById('scrapeNowBtn').dataset.site = scrapesite;
    }
  });

  // Add modal
  document.getElementById('saveAddBtn').addEventListener('click', saveManualJob);
  document.getElementById('cancelAddBtn').addEventListener('click', closeAddModal);
  document.getElementById('closeAddModal').addEventListener('click', closeAddModal);
  document.getElementById('addModalOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeAddModal();
  });

  // Edit modal
  document.getElementById('saveEditBtn').addEventListener('click', saveEditJob);
  document.getElementById('deleteJobBtn').addEventListener('click', deleteCurrentJob);
  document.getElementById('cancelEditBtn').addEventListener('click', closeEditModal);
  document.getElementById('closeEditModal').addEventListener('click', closeEditModal);
  document.getElementById('editModalOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeEditModal();
  });
}

// ── Add Job Modal ─────────────────────────────────────────────
function openAddModal() {
  document.getElementById('addModalOverlay').classList.add('open');
  document.getElementById('manualCompany').focus();
}

function closeAddModal() {
  document.getElementById('addModalOverlay').classList.remove('open');
  clearAddForm();
}

function clearAddForm() {
  ['manualCompany', 'manualRole', 'manualUrl'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('manualSite').value = 'LinkedIn';
  document.getElementById('manualStatus').value = 'Applied';
  setDefaultDate();
}

function setDefaultDate() {
  const dateInput = document.getElementById('manualDate');
  if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
}

async function saveManualJob() {
  const company = document.getElementById('manualCompany').value.trim();
  const role = document.getElementById('manualRole').value.trim();

  if (!company || !role) {
    alert('Company name and role are required.');
    return;
  }

  const dateVal = document.getElementById('manualDate').value;
  const appliedDate = dateVal ? new Date(dateVal).toISOString() : new Date().toISOString();

  const res = await sendMessage({
    type: 'SAVE_JOB',
    data: {
      company,
      role,
      site: document.getElementById('manualSite').value,
      status: document.getElementById('manualStatus').value,
      url: document.getElementById('manualUrl').value.trim(),
      appliedDate,
      source: 'manual'
    }
  });

  if (res.success) {
    closeAddModal();
    await loadJobs();
  } else if (res.duplicate) {
    alert('A similar application was already tracked recently.');
  }
}

// ── Edit Job Modal ────────────────────────────────────────────
function openEditModal(job) {
  document.getElementById('editJobId').value = job.id;
  document.getElementById('editCompany').value = job.company;
  document.getElementById('editRole').value = job.role;
  document.getElementById('editStatus').value = job.status;
  document.getElementById('editSite').value = job.site;
  document.getElementById('editNotes').value = job.notes || '';
  document.getElementById('editDate').value = job.appliedDate ? new Date(job.appliedDate).toISOString().split('T')[0] : '';
  // Load tags
  loadTagsInModal(job.tags || []);
  document.getElementById('editModalOverlay').classList.add('open');
}

function closeEditModal() {
  document.getElementById('editModalOverlay').classList.remove('open');
}

async function saveEditJob() {
  const id = document.getElementById('editJobId').value;
  const updates = {
    company: document.getElementById('editCompany').value.trim(),
    role: document.getElementById('editRole').value.trim(),
    status: document.getElementById('editStatus').value,
    site: document.getElementById('editSite').value.trim(),
    notes: document.getElementById('editNotes').value.trim(),
    tags: getTagsFromModal(),
    appliedDate: document.getElementById('editDate').value ? new Date(document.getElementById('editDate').value).toISOString() : undefined
  };

  const res = await sendMessage({ type: 'UPDATE_JOB', id, data: updates });
  if (res.success) {
    closeEditModal();
    await loadJobs();
  }
}

async function deleteCurrentJob() {
  const id = document.getElementById('editJobId').value;
  if (!confirm('Delete this application?')) return;
  const res = await sendMessage({ type: 'DELETE_JOB', id });
  if (res.success) {
    closeEditModal();
    await loadJobs();
  }
}

// ── Gmail ─────────────────────────────────────────────────────
async function handleGmailClick() {
  if (isGmailConnected) {
    const action = confirm('Gmail is connected.\n\nClick OK to scan for past applications now.\nClick Cancel to disconnect Gmail.');
    if (action) {
      // Scan for past applications
      const btn = document.getElementById('gmailBtn');
      const btnText = document.getElementById('gmailBtnText');
      btnText.textContent = 'Scanning Gmail...';
      btn.disabled = true;

      const res = await sendMessage({ type: 'SCAN_GMAIL_PAST' });
      btn.disabled = false;
      updateGmailButton();

      if (res.success) {
        alert(`✅ Scan complete!\nFound ${res.total} emails, added ${res.added} new applications.`);
        await loadJobs();
      } else {
        alert('⚠️ Gmail scan failed: ' + (res.error || 'Unknown error'));
      }
    } else {
      // Disconnect
      await sendMessage({ type: 'DISCONNECT_GMAIL' });
      isGmailConnected = false;
      updateGmailButton();
    }
  } else {
    // Connect
    const btnText = document.getElementById('gmailBtnText');
    btnText.textContent = 'Connecting...';

    const res = await sendMessage({ type: 'CONNECT_GMAIL' });
    if (res.success) {
      isGmailConnected = true;
      updateGmailButton();

      // Ask if they want to scan past applications
      const scan = confirm('✅ Gmail connected!\n\nWould you like to scan your past emails to find applications you made before installing this extension?');
      if (scan) {
        btnText.textContent = 'Scanning Gmail...';
        const scanRes = await sendMessage({ type: 'SCAN_GMAIL_PAST' });
        updateGmailButton();
        if (scanRes.success) {
          alert(`✅ Scan complete!\nFound ${scanRes.total} emails, added ${scanRes.added} applications.`);
          await loadJobs();
        }
      }
    } else {
      updateGmailButton();
      alert('⚠️ Gmail connection failed. Make sure you are signed in to Chrome.\n\nError: ' + (res.error || 'Unknown'));
    }
  }
}

function updateGmailButton() {
  const btn = document.getElementById('gmailBtn');
  const text = document.getElementById('gmailBtnText');
  if (isGmailConnected) {
    btn.classList.add('connected');
    text.textContent = '✓ Gmail connected — click to scan or disconnect';
  } else {
    btn.classList.remove('connected');
    text.textContent = 'Connect Gmail for auto-updates';
  }
}

// ── Export CSV ────────────────────────────────────────────────
async function exportCSV() {
  const res = await sendMessage({ type: 'EXPORT_CSV' });
  if (!res.success) return;

  const blob = new Blob([res.csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `job-applications-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Tag Management ───────────────────────────────────────────
let currentTags = [];

function loadTagsInModal(tags) {
  currentTags = [...(tags || [])];
  renderTagPresets();
  renderSelectedTags();
  setupTagListeners();
}

function getTagsFromModal() {
  return [...currentTags];
}

function renderTagPresets() {
  document.querySelectorAll('.tag-preset').forEach(btn => {
    btn.classList.toggle('selected', currentTags.includes(btn.dataset.tag));
  });
}

function renderSelectedTags() {
  const container = document.getElementById('tagSelected');
  if (!container) return;
  container.innerHTML = currentTags.map(tag => `
    <div class="tag-chip">
      <span>${escHtml(tag)}</span>
      <button type="button" data-remove="${escHtml(tag)}">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  `).join('');

  container.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTags = currentTags.filter(t => t !== btn.dataset.remove);
      renderTagPresets();
      renderSelectedTags();
    });
  });
}

function setupTagListeners() {
  document.querySelectorAll('.tag-preset').forEach(btn => {
    btn.onclick = () => {
      const tag = btn.dataset.tag;
      if (currentTags.includes(tag)) {
        currentTags = currentTags.filter(t => t !== tag);
      } else if (currentTags.length < 5) {
        currentTags.push(tag);
      }
      renderTagPresets();
      renderSelectedTags();
    };
  });

  const input = document.getElementById('tagCustomInput');
  const addBtn = document.getElementById('tagAddBtn');
  if (addBtn) {
    addBtn.onclick = () => {
      const val = (input.value || '').trim();
      if (val && !currentTags.includes(val) && currentTags.length < 5) {
        currentTags.push(val);
        input.value = '';
        renderTagPresets();
        renderSelectedTags();
      }
    };
    if (input) input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); } };
  }
}

// ── Multi-site Scraper ───────────────────────────────────────
async function scrapeInternshala() {
  const btn = document.getElementById('scrapeNowBtn');
  const site = btn.dataset.site || 'internshala';
  const siteNames = { internshala: 'Internshala', indeed: 'Indeed', linkedin: 'LinkedIn', naukri: 'Naukri', unstop: 'Unstop' };
  const siteName = siteNames[site] || 'the job site';
  const msgType = site === 'indeed' ? 'SCRAPE_INDEED' : site === 'linkedin' ? 'SCRAPE_LINKEDIN' : site === 'unstop' ? 'SCRAPE_UNSTOP' : site === 'naukri' ? 'SCRAPE_NAUKRI' : 'SCRAPE_INTERNSHALA';

  btn.disabled = true;

  // React sites need extra wait time before scraping
  const reactSites = ['linkedin', 'internshala'];
  if (reactSites.includes(site)) {
    btn.textContent = 'Waiting for page...';
    await new Promise(r => setTimeout(r, 4000));
  }

  btn.textContent = 'Importing...';

  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tabId = tabs[0]?.id;
    if (!tabId) { btn.disabled = false; btn.textContent = 'Import All'; return; }

    // Instead of messaging content script (which may not be ready),
    // inject the scrape function directly into the page
    chrome.scripting.executeScript({
      target: { tabId },
      func: (site) => {
        // This runs IN the page context
        const results = [];
        const seen = new Set();

        const jobLinks = [...document.querySelectorAll('a[href*="/jobs/view/"]')];

        for (const link of jobLinks) {
          const url = link.href.split('?')[0];
          if (seen.has(url)) continue;
          seen.add(url);

          // Walk up 4 levels to card
          let card = link;
          for (let i = 0; i < 4; i++) {
            if (!card.parentElement) break;
            card = card.parentElement;
          }

          const cardText = (card.innerText || '');
          const lines = cardText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
          const skipWords = ['jobs', 'connections', 'notes', 'saved', 'interview', 'archived'];

          // Role: first non-skip line
          let role = lines.find(l =>
            l.length > 3 && !skipWords.some(w => l.toLowerCase() === w) &&
            !l.includes('·') && !l.includes('Applied') && !l.includes('Posted')
          ) || 'Unknown Role';

          // Company: line with · separator
          let company = 'Unknown Company';
          const compLine = lines.find(l => l.includes('·') && !l.includes('Applied'));
          if (compLine) company = compLine.split('·')[0].trim();

          // Status
          let status = 'Applied';
          const textLow = cardText.toLowerCase();
          if (textLow.includes('offer')) status = 'Offer';
          else if (textLow.includes('interview')) status = 'Interview';
          else if (textLow.includes('reject')) status = 'Rejected';

          // Date: "Applied 6h ago", "Applied 2d ago"
          let appliedDate = new Date().toISOString();
          const dateMatch = cardText.match(/applied\s+([\d]+[hHdDwWmM][a-z]*\s+ago)/i);
          if (dateMatch) {
            const t = dateMatch[1].toLowerCase();
            const now = new Date();
            const num = parseInt(t);
            if (t.includes('h')) now.setHours(now.getHours() - num);
            else if (t.includes('d')) now.setDate(now.getDate() - num);
            else if (t.includes('w')) now.setDate(now.getDate() - num * 7);
            else if (t.includes('mo')) now.setMonth(now.getMonth() - num);
            appliedDate = now.toISOString();
          }

          // LinkedIn company logo
          let logoUrl = null;
          const logoImg = card.querySelector('img[class*="entity-image"], img[src*="media.licdn.com"], img[class*="company"]');
          if (logoImg && logoImg.src && !logoImg.src.includes('data:')) logoUrl = logoImg.src;

          if (role !== 'Unknown Role') {
            results.push({ role, company, status, site: 'LinkedIn', url, appliedDate, logoUrl, source: 'scrape' });
          }
        }
        return results;
      },
      args: [site]
    }, async (injectionResults) => {
      btn.disabled = false;
      btn.textContent = 'Import All';

      if (chrome.runtime.lastError || !injectionResults || !injectionResults[0]) {
        alert('Could not read the page. Make sure you are on the ' + siteName + ' applied jobs page and refresh it (Ctrl+Shift+R).');
        return;
      }

      const apps = injectionResults[0].result || [];
      if (apps.length === 0) {
        alert('No applications found on ' + siteName + '. Make sure the page is fully loaded.');
        return;
      }

      const result = await sendMessage({ type: 'BULK_SAVE_JOBS', jobs: apps });
      await loadJobs();
      alert('✅ Done! Imported ' + result.added + ' new application' + (result.added !== 1 ? 's' : '') + ' out of ' + apps.length + ' found on ' + siteName + '.');
    });
  });
}

// ── Helpers ───────────────────────────────────────────────────
function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) { resolve({}); return; }
      resolve(res || {});
    });
  });
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  // Use calendar date comparison, not raw timestamp diff
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const applied = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today - applied) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return diffDays + 'd ago';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
