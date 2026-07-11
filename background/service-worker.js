// ============================================================
// Trackezz — Background Service Worker
// Handles: storage, Gmail OAuth, email scanning, notifications
// ============================================================

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const ALARM_NAME = 'gmail-check';
const FOLLOWUP_ALARM_NAME = 'followup-check';
const CHECK_INTERVAL = 30; // minutes
const FOLLOWUP_INTERVAL = 720; // minutes (12 hours — twice a day is enough)
const FOLLOWUP_THRESHOLDS = [7, 14, 30]; // days since applied with no status change

// ── Status detection keywords ────────────────────────────────
const STATUS_KEYWORDS = {
  oa: [
    // Generic assessment keywords
    'online assessment', 'coding challenge', 'technical test',
    'aptitude test', 'coding test', 'assessment link', 'complete the test',
    'complete the assessment', 'take the test', 'attempt the test',
    'your test is ready', 'test invitation', 'assessment invitation',
    'complete your challenge', 'coding round',
    // Assessment platforms
    'hackerrank', 'cocubes', 'amcat', 'mettl', 'elitmus',
    'hirepro', 'hackerearth', 'codility', 'testgorilla',
    'shl assessment', 'mercer mettl', 'imocha'
  ],
  interview: [
    // Regular interview
    'interview invitation', 'schedule an interview', 'interview scheduled',
    'shortlisted', 'interview round', 'pleased to invite you for an interview',
    'invitation for interview', 'interview opportunity', 'we would like to interview',
    'selected for interview', 'next round', 'hr round', 'technical round',
    'please schedule your interview', 'book your interview slot',
    // AI Interview — Internshala and others
    'ai interview', 'artificial intelligence interview',
    'video interview', 'one-way interview', 'asynchronous interview',
    'record your interview', 'record your responses',
    'complete your video interview', 'hirevue', 'myinterview',
    'spark hire', 'interviewed.ai', 'vervoe',
    // Internshala specific
    'take the ai interview', 'complete the ai interview',
    'internshala interview', 'your interview is ready',
    'click here to take the interview', 'attempt the interview'
  ],
  offer: [
    'offer letter', 'pleased to offer', 'job offer', 'we would like to offer',
    'employment offer', 'offer of employment', 'offer accepted',
    'congratulations on your selection', 'selected for the position',
    'welcome aboard', 'onboarding', 'joining letter'
  ],
  rejected: [
    'unfortunately', 'not moving forward', 'regret to inform', 'not selected',
    'application unsuccessful', 'will not be moving', 'decided not to proceed',
    'position has been filled', 'other candidates', 'not shortlisted',
    'not proceeding', 'not been successful', 'not meet our requirements'
  ]
};

// Known job site sender domains
const JOB_SITE_DOMAINS = [
  'linkedin.com', 'naukri.com', 'internshala.com', 'indeed.com',
  'unstop.com', 'glassdoor.com', 'foundit.in', 'shine.com',
  'monster.com', 'hirist.com', 'cutshort.io', 'wellfound.com',
  'angel.co', 'instahyre.com'
];

// ── Alarm: check Gmail every 30 mins ────────────────────────
chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_INTERVAL });

// ── Alarm: check for stale applications twice a day ──────────
chrome.alarms.create(FOLLOWUP_ALARM_NAME, { periodInMinutes: FOLLOWUP_INTERVAL });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    const settings = await getSettings();
    if (settings.gmailConnected) {
      await checkGmailForStatusUpdates();
    }
  }
  if (alarm.name === FOLLOWUP_ALARM_NAME) {
    await checkFollowUps();
  }
});

// ── Extension install: set defaults ─────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get('settings');
  if (!existing.settings) {
    await chrome.storage.local.set({
      settings: {
        gmailConnected: false,
        lastGmailScan: null,
        lastStatusCheck: null,
        notifications: true,
        autoDetect: true
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
    case 'CONNECT_GMAIL':  return await connectGmail();
    case 'DISCONNECT_GMAIL': return await disconnectGmail();
    case 'SCAN_GMAIL_PAST': return await scanGmailForPastApplications();
    case 'CHECK_GMAIL_UPDATES': return await checkGmailForStatusUpdates();
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

  // Deduplicate: permanent check by role + company + site
  const isDuplicate = jobs.find(j => {
    const sameCompany = j.company.toLowerCase().trim() === jobData.company.toLowerCase().trim();
    const sameRole = j.role.toLowerCase().trim() === jobData.role.toLowerCase().trim();
    const sameSite = j.site === jobData.site;
    return sameCompany && sameRole && sameSite;
  });

  if (isDuplicate) {
    console.log('[Trackezz] Duplicate skipped:', jobData.company, jobData.role);
    return { success: false, duplicate: true };
  }

  const newJob = {
    id: generateId(),
    company: jobData.company || 'Unknown Company',
    role: jobData.role || 'Unknown Role',
    site: jobData.site || 'Unknown',
    url: jobData.url || '',
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

// ── Gmail OAuth ──────────────────────────────────────────────
async function connectGmail() {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: true }, async (token) => {
      if (chrome.runtime.lastError || !token) {
        resolve({ success: false, error: chrome.runtime.lastError?.message || 'Auth failed' });
        return;
      }
      await updateSettings({ gmailConnected: true, gmailToken: token });
      resolve({ success: true });
    });
  });
}

async function disconnectGmail() {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (token) {
        chrome.identity.removeCachedAuthToken({ token }, async () => {
          await updateSettings({ gmailConnected: false, gmailToken: null });
          resolve({ success: true });
        });
      } else {
        updateSettings({ gmailConnected: false, gmailToken: null }).then(() => {
          resolve({ success: true });
        });
      }
    });
  });
}

async function getGmailToken() {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (chrome.runtime.lastError || !token) {
        resolve(null);
      } else {
        resolve(token);
      }
    });
  });
}

async function gmailFetch(endpoint, token) {
  const res = await fetch(`${GMAIL_API}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`Gmail API error: ${res.status}`);
  return res.json();
}

// ── Retroactive Gmail scan ────────────────────────────────────
// Scans past emails to find job applications even before extension install
async function scanGmailForPastApplications() {
  const token = await getGmailToken();
  if (!token) return { success: false, error: 'Not authenticated' };

  try {
    // Search query: emails from known job sites about applications
    const queries = [
      // Job site application confirmations
      'from:(internshala.com) newer_than:3y',
      'from:(linkedin.com) subject:(application OR applied OR interview) newer_than:3y',
      'from:(indeed.com) newer_than:3y',
      'from:(naukri.com) newer_than:3y',
      'from:(unstop.com) newer_than:3y',
      'subject:("application submitted") newer_than:3y',
      'subject:("application received") newer_than:3y',
      'subject:("thank you for applying") newer_than:3y',
      'subject:("successfully applied") newer_than:3y',
      'subject:("you have applied") newer_than:3y',
      'subject:("your application") newer_than:3y',
      'subject:("applied for") newer_than:3y',
      'from:(hackerrank.com OR mettl.com OR cocubes.com OR amcat.com OR hirepro.io OR hackerearth.com) newer_than:3y',
      'from:(internshala.com) subject:(interview) newer_than:3y',
      'subject:("ai interview" OR "video interview") newer_than:3y'
    ];

    const allMessageIds = new Set();

    for (const q of queries) {
      let pageToken = null;
      let fetched = 0;
      do {
        const url = `/messages?q=${encodeURIComponent(q)}&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`;
        const result = await gmailFetch(url, token);
        (result.messages || []).forEach(m => allMessageIds.add(m.id));
        pageToken = result.nextPageToken;
        fetched += (result.messages || []).length;
      } while (pageToken && fetched < 500);
    }

    console.log(`[Trackezz] Found ${allMessageIds.size} potential job emails`);

    let added = 0;
    const messageIds = [...allMessageIds];

    // Process in batches of 10
    for (let i = 0; i < messageIds.length; i += 10) {
      const batch = messageIds.slice(i, i + 10);
      await Promise.all(batch.map(async (msgId) => {
        try {
          const msg = await gmailFetch(`/messages/${msgId}?format=metadata&metadataHeaders=Subject,From,Date`, token);
          const jobData = extractJobFromEmail(msg);
          if (jobData) {
            const result = await saveJob(jobData);
            if (result.success) added++;
          }
        } catch (e) {
          console.warn('[Trackezz] Error processing email:', e);
        }
      }));
    }

    await updateSettings({ lastGmailScan: new Date().toISOString() });
    return { success: true, added, total: allMessageIds.size };
  } catch (err) {
    console.error('[Trackezz] Gmail scan error:', err);
    return { success: false, error: err.message };
  }
}

// ── Periodic Gmail status update check ──────────────────────
async function checkGmailForStatusUpdates() {
  const token = await getGmailToken();
  if (!token) return { success: false, error: 'Not authenticated' };

  const settings = await getSettings();
  const lastCheck = settings.lastStatusCheck || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const afterTimestamp = Math.floor(new Date(lastCheck).getTime() / 1000);

  const { jobs: allJobs } = await getJobs();
  const activeJobs = allJobs.filter(j => !['Hired', 'Rejected'].includes(j.status));
  if (activeJobs.length === 0) return { success: true, updates: 0 };

  try {
    // Broader search — job sites + assessment platforms + AI interview senders
    const query = `(subject:(interview OR offer OR assessment OR selected OR shortlisted OR congratulations OR unfortunately OR rejected OR "ai interview" OR "video interview" OR "coding challenge" OR "online assessment") OR from:(naukri.com OR linkedin.com OR internshala.com OR indeed.com OR unstop.com OR hackerrank.com OR mettl.com OR cocubes.com OR amcat.com OR hirepro.io OR hackerearth.com)) after:${afterTimestamp}`;

    const result = await gmailFetch(`/messages?q=${encodeURIComponent(query)}&maxResults=50`, token);
    const messages = result.messages || [];

    let updates = 0;

    for (const { id } of messages) {
      const msg = await gmailFetch(`/messages/${id}?format=full`, token);
      const subject = getHeader(msg, 'Subject') || '';
      const from = getHeader(msg, 'From') || '';
      const snippet = msg.snippet || '';
      const body = extractEmailBody(msg);
      const fullText = `${subject} ${snippet} ${body}`.toLowerCase();

      // Detect status from content
      const detectedStatus = detectStatus(fullText, from);
      if (!detectedStatus) continue;

      // Try to match to an existing tracked job
      const matchedJob = matchEmailToJob(subject, from, snippet, activeJobs);
      if (matchedJob) {
        const statusPriority = { 'Applied': 0, 'OA': 1, 'Interview': 2, 'Offer': 3, 'Hired': 4, 'Rejected': 5 };
        const currentPriority = statusPriority[matchedJob.status] || 0;
        const newPriority = statusPriority[detectedStatus] || 0;

        if (newPriority > currentPriority) {
          await updateJobStatus(matchedJob.id, detectedStatus);

          // Log email update on the job
          const data = await chrome.storage.local.get('jobs');
          const jobs = data.jobs || [];
          const job = jobs.find(j => j.id === matchedJob.id);
          if (job) {
            job.emailUpdates = job.emailUpdates || [];
            job.emailUpdates.push({
              subject,
              from,
              date: new Date().toISOString(),
              detectedStatus,
              snippet: snippet.substring(0, 200)
            });
            await chrome.storage.local.set({ jobs });
          }

          // Notify user (respects the "Status update notification" toggle)
          if (settings.statusNotifications !== false) {
            const statusEmoji = { OA: '📝', Interview: '🎯', Offer: '🎉', Hired: '🥳', Rejected: '😔' };
            chrome.notifications.create({
              type: 'basic',
              iconUrl: '../icons/icon48.png',
              title: `${statusEmoji[detectedStatus] || '📧'} Status Update: ${detectedStatus}`,
              message: `${matchedJob.role} at ${matchedJob.company}`
            });
          }

          updates++;
        }
      }
    }

    await updateSettings({ lastStatusCheck: new Date().toISOString() });
    return { success: true, updates };
  } catch (err) {
    console.error('[Trackezz] Status check error:', err);
    return { success: false, error: err.message };
  }
}

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
    'unstop.com','glassdoor.com','hackerrank.com','mettl.com','cocubes.com',
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
    const knownSites = ['linkedin', 'naukri', 'internshala', 'indeed', 'unstop', 'glassdoor'];
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
  if (lower.includes('glassdoor')) return 'Glassdoor';
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
