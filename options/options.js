const send = (msg) => new Promise(r => chrome.runtime.sendMessage(msg, res => r(res || {})));

async function init() {
  const settings = await send({ type: 'GET_SETTINGS' });
  if (typeof settings.notifications === 'boolean') {
    document.getElementById('notifToggle').checked = settings.notifications;
  }
}

document.getElementById('notifToggle').addEventListener('change', async (e) => {
  await send({ type: 'UPDATE_SETTINGS', updates: { notifications: e.target.checked } });
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

// ── API Key ───────────────────────────────────────────────────
async function initApiKey() {
  const settings = await send({ type: 'GET_SETTINGS' });
  if (settings.geminiKey) {
    document.getElementById('apiKeyInput').value = settings.geminiKey;
    document.getElementById('apiKeyStatus').textContent = '✅ API key saved';
  }
}

document.getElementById('saveApiKeyBtn')?.addEventListener('click', async () => {
  const key = document.getElementById('apiKeyInput').value.trim();
  if (!key || key.length < 10) {
    document.getElementById('apiKeyStatus').textContent = '⚠️ Please enter a valid API key';
    return;
  }
  await send({ type: 'UPDATE_SETTINGS', updates: { geminiKey: key } });
  document.getElementById('apiKeyStatus').textContent = '✅ API key saved!';
});

// ── Navigation Buttons ───────────────────────────────────────
document.getElementById('optionsBackBtn')?.addEventListener('click', () => {
  window.location.href = chrome.runtime.getURL('popup/popup.html');
});

const optionsTabBtn = document.getElementById('optionsTabBtn');
if (optionsTabBtn) {
  chrome.tabs.getCurrent((tab) => {
    if (tab) {
      optionsTabBtn.style.display = 'none';
    } else {
      optionsTabBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html') });
      });
    }
  });
}

initApiKey();
