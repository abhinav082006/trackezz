const send = (msg) => new Promise(r => chrome.runtime.sendMessage(msg, res => r(res || {})));

async function init() {
  const settings = await send({ type: 'GET_SETTINGS' });
  updateGmailUI(settings.gmailConnected);
  if (settings.lastGmailScan) {
    document.getElementById('lastScanInfo').textContent =
      `Last scanned: ${new Date(settings.lastGmailScan).toLocaleString()}`;
  }
  if (typeof settings.notifications === 'boolean') {
    document.getElementById('notifToggle').checked = settings.notifications;
  }
  if (typeof settings.statusNotifications === 'boolean') {
    document.getElementById('statusNotifToggle').checked = settings.statusNotifications;
  }
}

document.getElementById('notifToggle').addEventListener('change', async (e) => {
  await send({ type: 'UPDATE_SETTINGS', updates: { notifications: e.target.checked } });
});

document.getElementById('statusNotifToggle').addEventListener('change', async (e) => {
  await send({ type: 'UPDATE_SETTINGS', updates: { statusNotifications: e.target.checked } });
});

function updateGmailUI(connected) {
  const pill = document.getElementById('gmailStatusPill');
  const connectBtn = document.getElementById('gmailConnectBtn');
  const actions = document.getElementById('gmailActions');
  if (connected) {
    pill.textContent = '● Connected'; pill.className = 'status-pill connected';
    connectBtn.style.display = 'none'; actions.style.display = 'flex';
  } else {
    pill.textContent = '● Not Connected'; pill.className = 'status-pill disconnected';
    connectBtn.style.display = ''; actions.style.display = 'none';
  }
}

document.getElementById('gmailConnectBtn').addEventListener('click', async () => {
  const btn = document.getElementById('gmailConnectBtn');
  btn.textContent = 'Connecting...'; btn.disabled = true;
  const res = await send({ type: 'CONNECT_GMAIL' });
  btn.disabled = false; btn.textContent = 'Connect Gmail';
  if (res.success) { updateGmailUI(true); }
  else { alert('Connection failed: ' + (res.error || 'Unknown error')); }
});

document.getElementById('disconnectBtn').addEventListener('click', async () => {
  if (!confirm('Disconnect Gmail? Auto status updates will stop.')) return;
  await send({ type: 'DISCONNECT_GMAIL' });
  updateGmailUI(false);
  document.getElementById('lastScanInfo').textContent = '';
});

document.getElementById('scanPastBtn').addEventListener('click', async () => {
  const btn = document.getElementById('scanPastBtn');
  const result = document.getElementById('scanResult');
  btn.textContent = '⏳ Scanning...'; btn.disabled = true;
  result.style.display = 'none';
  const res = await send({ type: 'SCAN_GMAIL_PAST' });
  btn.textContent = '🔍 Scan Past Applications'; btn.disabled = false;
  if (res.success) {
    result.style.display = 'block';
    result.textContent = `✅ Scanned ${res.total} emails — added ${res.added} new applications.`;
    document.getElementById('lastScanInfo').textContent = `Last scanned: ${new Date().toLocaleString()}`;
  } else {
    result.style.display = 'block'; result.style.color = '#f87171';
    result.textContent = '⚠️ Error: ' + (res.error || 'Unknown');
  }
});

document.getElementById('checkUpdatesBtn').addEventListener('click', async () => {
  const btn = document.getElementById('checkUpdatesBtn');
  btn.textContent = '⏳ Checking...'; btn.disabled = true;
  const res = await send({ type: 'CHECK_GMAIL_UPDATES' });
  btn.textContent = '🔄 Check Status Updates'; btn.disabled = false;
  const result = document.getElementById('scanResult');
  result.style.display = 'block'; result.style.color = '#10b981';
  result.textContent = res.success
    ? `✅ Found ${res.updates} status update(s).`
    : '⚠️ Error: ' + (res.error || 'Unknown');
});

document.getElementById('exportCsvBtn').addEventListener('click', async () => {
  const res = await send({ type: 'EXPORT_CSV' });
  if (!res.success) return;
  const blob = new Blob([res.csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `job-applications-${new Date().toISOString().split('T')[0]}.csv`;
  a.click(); URL.revokeObjectURL(url);
});

document.getElementById('cleanUnknownBtn').addEventListener('click', async () => {
  const res = await send({ type: 'CLEAN_UNKNOWN' });
  if (res.success) {
    alert(res.removed > 0
      ? '🧹 Removed ' + res.removed + ' unknown entries successfully!'
      : '✅ No unknown entries found — all clean!');
  }
});

document.getElementById('clearDataBtn').addEventListener('click', async () => {
  if (!confirm('Are you sure? This will permanently delete ALL tracked applications.')) return;
  if (!confirm('This cannot be undone. Really delete everything?')) return;
  await chrome.storage.local.set({ jobs: [] });
  alert('All data cleared.');
});

init();

// ── Theme switching ───────────────────────────────────────────
function applyTheme(theme) {
  document.body.classList.remove('dark-mode', 'light-mode');
  if (theme === 'dark') document.body.classList.add('dark-mode');
  if (theme === 'light') document.body.classList.add('light-mode');

  // Update button active states
  ['themeAuto', 'themeLight', 'themeDark'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.style.background = '';
      btn.style.color = '';
      btn.style.borderColor = '';
    }
  });
  const activeId = theme === 'dark' ? 'themeDark' : theme === 'light' ? 'themeLight' : 'themeAuto';
  const activeBtn = document.getElementById(activeId);
  if (activeBtn) {
    activeBtn.style.background = theme === 'dark' ? '#E8DDD0' : '#657166';
    activeBtn.style.color = theme === 'dark' ? '#1C1A18' : '#fff';
    activeBtn.style.borderColor = 'transparent';
  }
}

async function initTheme() {
  const settings = await send({ type: 'GET_SETTINGS' });
  applyTheme(settings.theme || 'auto');
}

document.getElementById('themeAuto')?.addEventListener('click', async () => {
  await send({ type: 'UPDATE_SETTINGS', updates: { theme: 'auto' } });
  applyTheme('auto');
});
document.getElementById('themeLight')?.addEventListener('click', async () => {
  await send({ type: 'UPDATE_SETTINGS', updates: { theme: 'light' } });
  applyTheme('light');
});
document.getElementById('themeDark')?.addEventListener('click', async () => {
  await send({ type: 'UPDATE_SETTINGS', updates: { theme: 'dark' } });
  applyTheme('dark');
});

initTheme();
