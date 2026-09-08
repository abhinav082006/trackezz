// ============================================================
// Trackezz — Background Service Worker
// Handles: storage, job tracking, sync, notifications
// ============================================================

const FOLLOWUP_ALARM_NAME = 'followup-check';
const SYNC_ALARM_NAME = 'daily-sync';
const FOLLOWUP_INTERVAL = 720; // minutes (12 hours)
const FOLLOWUP_THRESHOLDS = [7, 14, 30]; // days since applied with no status change



// ── Alarms ───────────────────────────────────────────────────
chrome.alarms.create(FOLLOWUP_ALARM_NAME, { periodInMinutes: FOLLOWUP_INTERVAL });
chrome.alarms.create(SYNC_ALARM_NAME, { periodInMinutes: 1440 }); // daily sync

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === FOLLOWUP_ALARM_NAME) await checkFollowUps();
  if (alarm.name === SYNC_ALARM_NAME) await runSyncAll(false);
});

// ── Extension install: set defaults ─────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get('settings');
  if (!existing.settings) {
    await chrome.storage.local.set({
      settings: {
        notifications: true,
        autoDetect: true,
        lastSync: null
      },
      jobs: []
    });
  }
  await updateBadge();
});

// Recompute badge whenever the browser starts (Chrome doesn't persist badge across restarts)
chrome.runtime.onStartup.addListener(async () => {
  await updateBadge();
});

// ── Message handler ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((err) => {
    console.error('[Trackezz] Error:', err);
    sendResponse({ success: false, error: err.message });
  });
  return true; // Keep channel open for async
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'SAVE_JOB':       return await saveJob(message.data);
    case 'GET_JOBS':       return await getJobs();
    case 'DELETE_JOB':     return await deleteJob(message.id);
    case 'UPDATE_STATUS':  return await updateJobStatus(message.id, message.status);
    case 'UPDATE_JOB':     return await updateJob(message.id, message.data);
    case 'GET_SETTINGS':   return await getSettings();
    case 'UPDATE_SETTINGS': return await updateSettings(message.updates);
    case 'SYNC_ALL':       return await runSyncAll(true);
    case 'EXPORT_CSV':     return await exportCSV();
    case 'CLEAN_UNKNOWN':  return await cleanUnknownJobs();
    case 'BULK_SAVE_JOBS': return await bulkSaveJobs(message.jobs);
    case 'CHECK_FOLLOWUPS': return await checkFollowUps();
    case 'UPDATE_LOGO':    return await updateJobLogo(message.role, message.company, message.site, message.logoUrl);
    default: return { success: false, error: 'Unknown message type' };
  }
}

// ── Storage helpers ──────────────────────────────────────────
async function getJobs() {
  const data = await chrome.storage.local.get('jobs');
  return { success: true, jobs: data.jobs || [] };
}

async function saveJob(jobData) {
  const data = await chrome.storage.local.get('jobs');
  const jobs = data.jobs || [];

  // Deduplicate & smart status upgrade
  const existingJobIndex = jobs.findIndex(j => {
    const sameCompany = j.company.toLowerCase().trim() === jobData.company.toLowerCase().trim();
    const sameRole = j.role.toLowerCase().trim() === jobData.role.toLowerCase().trim();
    const sameSite = j.site === jobData.site;
    return sameCompany && sameRole && sameSite;
  });

  if (existingJobIndex !== -1) {
    const existing = jobs[existingJobIndex];
    let changed = false;

    // Update logo if existing job is missing it
    if (!existing.logoUrl && jobData.logoUrl) {
      existing.logoUrl = jobData.logoUrl;
      changed = true;
    }

    const priority = { 'Applied': 0, 'OA': 1, 'Interview': 2, 'Offer': 3, 'Hired': 4, 'Rejected': 5 };
    const curP = priority[existing.status] ?? 0;
    const newP = priority[jobData.status] ?? 0;
    if (newP > curP) {
      existing.status = jobData.status;
      if (jobData.status !== 'Applied') existing.remindersSent = [];
      changed = true;
    }

    if (changed) {
      await chrome.storage.local.set({ jobs });
      await updateBadge();
      return { success: true, updated: true, job: existing };
    }
    return { success: false, duplicate: true };
  }

  const newJob = {
    id: generateId(),
    company: jobData.company || 'Unknown Company',
    role: jobData.role || 'Unknown Role',
    site: jobData.site || 'Unknown',
    url: jobData.url || '',
    logoUrl: jobData.logoUrl || null,
    appliedDate: jobData.appliedDate || new Date().toISOString(),
    status: jobData.status || 'Applied',
    source: jobData.source || 'auto', // 'auto' | 'manual' | 'gmail'
    emailUpdates: [],
    notes: jobData.notes || '',
    tags: jobData.tags || [],
    remindersSent: [] // tracks which follow-up thresholds (7/14/30 days) already notified
  };

  jobs.unshift(newJob); // Add to top
  await chrome.storage.local.set({ jobs });
  await updateBadge();

  // Show notification
  const settings = await getSettings();
  if (settings.notifications) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: '../icons/icon48.png',
      title: '✅ Application Tracked!',
      message: `${newJob.role} at ${newJob.company}`
    });
  }

  return { success: true, job: newJob };
}

async function deleteJob(id) {
  const data = await chrome.storage.local.get('jobs');
  const jobs = (data.jobs || []).filter(j => j.id !== id);
  await chrome.storage.local.set({ jobs });
  await updateBadge();
  return { success: true };
}

async function updateJobStatus(id, status) {
  const data = await chrome.storage.local.get('jobs');
  const jobs = data.jobs || [];
  const job = jobs.find(j => j.id === id);
  if (!job) return { success: false, error: 'Job not found' };
  job.status = status;
  // Once status moves past "Applied", clear reminders — no more follow-up needed
  if (status !== 'Applied') job.remindersSent = [];
  await chrome.storage.local.set({ jobs });
  await updateBadge();
  return { success: true };
}

async function updateJob(id, updates) {
  const data = await chrome.storage.local.get('jobs');
  const jobs = data.jobs || [];
  const idx = jobs.findIndex(j => j.id === id);
  if (idx === -1) return { success: false, error: 'Job not found' };
  // Clear reminders if status is changing away from "Applied"
  if (updates.status && updates.status !== 'Applied') updates.remindersSent = [];
  jobs[idx] = { ...jobs[idx], ...updates };
  await chrome.storage.local.set({ jobs });
  await updateBadge();
  return { success: true };
}

async function getSettings() {
  const data = await chrome.storage.local.get('settings');
  return data.settings || {};
}

async function updateSettings(updates) {
  const settings = await getSettings();
  const newSettings = { ...settings, ...updates };
  await chrome.storage.local.set({ settings: newSettings });
  return { success: true, settings: newSettings };
}


// ── Sync All Sites ───────────────────────────────────────────
async function runSyncAll(notifyPopup = false) {
  const sites = [
    { name: 'Internshala', url: 'https://internshala.com/student/applications', msg: 'SCRAPE_INTERNSHALA' },
    { name: 'LinkedIn',    url: 'https://www.linkedin.com/jobs-tracker/?stage=applied', msg: 'SCRAPE_LINKEDIN' },
    { name: 'Indeed',      url: 'https://myjobs.indeed.com/applied', msg: 'SCRAPE_INDEED' },
    { name: 'Naukri',      url: 'https://www.naukri.com/myapply/historypage', msg: 'SCRAPE_NAUKRI' },
    { name: 'Unstop',      url: 'https://unstop.com/user/registrations/all/all', msg: 'SCRAPE_UNSTOP' }
  ];

  let totalNew = 0;
  let totalUpdates = 0;

  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];

    if (notifyPopup) {
      chrome.runtime.sendMessage({
        type: 'SYNC_PROGRESS',
        text: `Syncing ${site.name}... (${i + 1}/${sites.length})`
      }).catch(() => {});
    }

    try {
      const tab = await chrome.tabs.create({ url: site.url, active: false });

      // Wait for page to fully load
      await new Promise(resolve => {
        const listener = (tabId, info) => {
          if (tabId === tab.id && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(resolve, 20000);
      });

      // Give JS frameworks extra time to render
      await new Promise(r => setTimeout(r, 5000));

      // Ask the content script to scrape
      const response = await new Promise(resolve => {
        chrome.tabs.sendMessage(tab.id, { type: site.msg }, res => resolve(res));
        setTimeout(() => resolve(null), 10000);
      });

      // Save each returned application
      if (response && response.applications && response.applications.length > 0) {
        for (const app of response.applications) {
          const res = await saveJob(app);
          if (res.success) {
            if (res.updated) totalUpdates++;
            else totalNew++;
          }
        }
      }

      await chrome.tabs.remove(tab.id).catch(() => {});

    } catch (e) {
      console.warn('[Trackezz] Sync error for', site.name, ':', e.message);
    }
  }

  const syncTime = new Date().toISOString();
  await updateSettings({ lastSync: syncTime });

  if (notifyPopup) {
    chrome.runtime.sendMessage({
      type: 'SYNC_COMPLETE',
      newApps: totalNew,
      updates: totalUpdates,
      time: syncTime
    }).catch(() => {});
  }

  return { success: true, newApps: totalNew, updates: totalUpdates };
}

// ── Follow-up Reminders ──────────────────────────────────────

// ── Follow-up Reminders ──────────────────────────────────────

// Notifies when an "Applied" job has had no status change for
// 7 / 14 / 30 days. Each threshold only fires once per job.
async function checkFollowUps() {
  const data = await chrome.storage.local.get('jobs');
  const jobs = data.jobs || [];
  const settings = await getSettings();
  const now = Date.now();
  let notified = 0;
  let changed = false;

  for (const job of jobs) {
    if (job.status !== 'Applied') continue;

    const daysSince = Math.floor((now - new Date(job.appliedDate).getTime()) / 86400000);
    if (!Array.isArray(job.remindersSent)) job.remindersSent = [];

    // Find the highest threshold crossed that hasn't been notified yet
    for (const threshold of FOLLOWUP_THRESHOLDS) {
      if (daysSince >= threshold && !job.remindersSent.includes(threshold)) {
        if (settings.notifications !== false) {
          chrome.notifications.create({
            type: 'basic',
            iconUrl: '../icons/icon48.png',
            title: '⏰ Follow-up reminder',
            message: `${job.role} at ${job.company} — applied ${daysSince} days ago, no update yet.`
          });
        }
        job.remindersSent.push(threshold);
        notified++;
        changed = true;
      }
    }
  }

  if (changed) await chrome.storage.local.set({ jobs });
  await updateBadge();
  return { success: true, notified };
}

// ── Badge: shows count of stale applications (7+ days, no update) ──
async function updateBadge() {
  const data = await chrome.storage.local.get('jobs');
  const jobs = data.jobs || [];
  const now = Date.now();

  const staleCount = jobs.filter(j => {
    if (j.status !== 'Applied') return false;
    const daysSince = Math.floor((now - new Date(j.appliedDate).getTime()) / 86400000);
    return daysSince >= FOLLOWUP_THRESHOLDS[0]; // 7+ days
  }).length;

  if (staleCount > 0) {
    chrome.action.setBadgeText({ text: String(staleCount) });
    chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// ── Email parsing helpers ────────────────────────────────────
function extractJobFromEmail(msg) {
  const subject = getHeader(msg, 'Subject') || '';
  const from = getHeader(msg, 'From') || '';
  const date = getHeader(msg, 'Date') || new Date().toISOString();

  // Check if from a known job site or has application-related subject
  const subjectLower = subject.toLowerCase();
  const fromLower = from.toLowerCase();

  const isFromJobSite = ['internshala.com','linkedin.com','indeed.com','naukri.com',
    'unstop.com','hackerrank.com','mettl.com','cocubes.com',
    'amcat.com','hirepro.io','hackerearth.com'].some(s => fromLower.includes(s));

  const isApplicationEmail =
    isFromJobSite ||
    subjectLower.includes('application') ||
    subjectLower.includes('applied') ||
    subjectLower.includes('thank you for applying') ||
    subjectLower.includes('successfully applied') ||
    subjectLower.includes('shortlisted') ||
    subjectLower.includes('interview') ||
    subjectLower.includes('assessment');

  if (!isApplicationEmail) return null;

  // Extract role and company from subject
  let role = 'Unknown Role';
  let company = extractCompanyFromSender(from);

  // Pattern: "application for [ROLE] at [COMPANY]"
  let match = subject.match(/application\s+for\s+(.+?)\s+at\s+(.+?)(?:\s*[-|]|$)/i);
  if (match) { role = match[1].trim(); company = match[2].trim() || company; }

  // Pattern: "your application to [COMPANY] for [ROLE]"
  if (role === 'Unknown Role') {
    match = subject.match(/application\s+to\s+(.+?)\s+for\s+(.+?)(?:\s*[-|]|$)/i);
    if (match) { company = match[1].trim(); role = match[2].trim(); }
  }

  // Pattern: "applied for [ROLE] at [COMPANY]"
  if (role === 'Unknown Role') {
    match = subject.match(/applied\s+for\s+(.+?)\s+at\s+(.+?)(?:\s*[-–|]|$)/i);
    if (match) { role = match[1].trim(); company = match[2].trim() || company; }
  }

  // Pattern: "[ROLE] at [COMPANY]"
  if (role === 'Unknown Role') {
    match = subject.match(/^(.+?)\s+(?:at|@)\s+(.+?)(?:\s*[-–|]|$)/i);
    if (match) { role = match[1].trim(); company = match[2].trim() || company; }
  }

  // Pattern: "Application for [ROLE]"
  if (role === 'Unknown Role') {
    match = subject.match(/application\s+for\s+(.+?)(?:\s*[-–|,]|$)/i);
    if (match) { role = match[1].trim(); }
  }

  // Pattern: "applied for [ROLE]"
  if (role === 'Unknown Role') {
    match = subject.match(/applied\s+for\s+(.+?)(?:\s*[-–|,]|at|$)/i);
    if (match) { role = match[1].trim(); }
  }

  // Internshala: "You have applied for [ROLE]"
  if (role === 'Unknown Role') {
    match = subject.match(/you\s+have\s+applied\s+for\s+(.+?)(?:\s*[-–|,]|at|$)/i);
    if (match) { role = match[1].trim(); }
  }

  // Determine site from sender
  const site = getSiteFromSender(from);

  // Only save if we have at least a real role OR a real company name
  if (role === 'Unknown Role' && company === 'Unknown Company') return null;

  return {
    company,
    role,
    site,
    appliedDate: new Date(date).toISOString(),
    status: 'Applied',
    source: 'gmail',
    url: ''
  };
}

function getHeader(msg, name) {
  const headers = msg.payload?.headers || [];
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || null;
}

function extractEmailBody(msg) {
  try {
    const parts = msg.payload?.parts || [msg.payload];
    for (const part of parts) {
      if (part?.mimeType === 'text/plain' && part?.body?.data) {
        return atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'));
      }
    }
  } catch { /* */ }
  return '';
}

function extractCompanyFromSender(from) {
  // "Naukri <no-reply@naukri.com>" → "Naukri"
  const nameMatch = from.match(/^"?([^"<]+)"?\s*</);
  if (nameMatch) {
    const name = nameMatch[1].trim();
    // Filter out generic names
    const generic = ['no-reply', 'noreply', 'notifications', 'jobs', 'careers', 'info', 'hr'];
    if (!generic.some(g => name.toLowerCase().includes(g))) return name;
  }
  // Fall back to domain
  const domainMatch = from.match(/@([^.>]+)\./);
  if (domainMatch) {
    const domain = domainMatch[1];
    const knownSites = ['linkedin', 'naukri', 'internshala', 'indeed', 'unstop'];
    if (!knownSites.includes(domain.toLowerCase())) {
      return domain.charAt(0).toUpperCase() + domain.slice(1);
    }
  }
  return 'Unknown Company';
}

function getSiteFromSender(from) {
  const lower = from.toLowerCase();
  if (lower.includes('linkedin')) return 'LinkedIn';
  if (lower.includes('naukri')) return 'Naukri';
  if (lower.includes('internshala')) return 'Internshala';
  if (lower.includes('indeed')) return 'Indeed';
  if (lower.includes('unstop')) return 'Unstop';
  if (lower.includes('foundit') || lower.includes('monsterindia')) return 'Foundit';
  if (lower.includes('shine')) return 'Shine';
  return 'Email';
}

function detectStatus(text, fromSender = '') {
  const senderLower = (fromSender || '').toLowerCase();

  // Sender-based override — no keyword needed
  // If email is FROM an assessment platform → it's an OA
  const oaSenders = ['hackerrank.com', 'mettl.com', 'cocubes.com', 'amcat.com',
                     'hirepro.io', 'hackerearth.com', 'codility.com', 'imocha.io',
                     'testgorilla.com', 'shl.com'];
  if (oaSenders.some(s => senderLower.includes(s))) return 'OA';

  // Internshala AI interview — from internshala + contains "interview" in subject/body
  if (senderLower.includes('internshala.com') && text.includes('interview')) return 'Interview';

  // HireVue / video interview platforms → Interview stage
  const interviewSenders = ['hirevue.com', 'myinterview.com', 'sparkhire.com',
                             'interviewed.ai', 'vervoe.com', 'hireflix.com'];
  if (interviewSenders.some(s => senderLower.includes(s))) return 'Interview';

  // Keyword-based detection (fallback)
  for (const [status, keywords] of Object.entries(STATUS_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) {
      return status.charAt(0).toUpperCase() + status.slice(1);
    }
  }
  return null;
}

function matchEmailToJob(subject, from, snippet, jobs) {
  const textToSearch = `${subject} ${from} ${snippet}`.toLowerCase();

  // Try to match by company name in email content
  for (const job of jobs) {
    const companyWords = job.company.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const roleWords = job.role.toLowerCase().split(/\s+/).filter(w => w.length > 2);

    const companyMatch = companyWords.some(w => textToSearch.includes(w));
    const roleMatch = roleWords.some(w => textToSearch.includes(w));

    // Strong match: both company and role found
    if (companyMatch && roleMatch) return job;
  }

  // Weaker match: just company
  for (const job of jobs) {
    const companyWords = job.company.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (companyWords.some(w => textToSearch.includes(w))) return job;
  }

  return null;
}

// ── Update job logo ─────────────────────────────────────────
async function updateJobLogo(role, company, site, logoUrl) {
  const data = await chrome.storage.local.get('jobs');
  const jobs = data.jobs || [];
  const job = jobs.find(j =>
    j.role === role && j.company === company && j.site === site
  );
  if (!job || !logoUrl) return { success: false };
  job.logoUrl = logoUrl;
  await chrome.storage.local.set({ jobs });
  return { success: true };
}

// ── Bulk Save Jobs (from scraper) ───────────────────────────
async function bulkSaveJobs(jobs) {
  if (!jobs || jobs.length === 0) return { success: true, added: 0 };
  let added = 0;
  for (const job of jobs) {
    const result = await saveJob(job);
    if (result.success) added++;
  }
  return { success: true, added, total: jobs.length };
}

// ── Clean Unknown Jobs (remove bad Gmail scan entries)
async function cleanUnknownJobs() {
  const data = await chrome.storage.local.get('jobs');
  const jobs = data.jobs || [];
  const cleaned = jobs.filter(j => !(j.role === 'Unknown Role' && j.company === 'Unknown Company'));
  const removed = jobs.length - cleaned.length;
  await chrome.storage.local.set({ jobs: cleaned });
  await updateBadge();
  return { success: true, removed };
}

// ── CSV Export ───────────────────────────────────────────────
async function exportCSV() {
  const { jobs } = await getJobs();
  const headers = ['Company', 'Role', 'Site', 'Status', 'Applied Date', 'URL', 'Notes'];
  const rows = jobs.map(j => [
    j.company, j.role, j.site, j.status,
    new Date(j.appliedDate).toLocaleDateString(),
    j.url, j.notes
  ]);
  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  return { success: true, csv };
}

// ── Utilities ────────────────────────────────────────────────
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}
