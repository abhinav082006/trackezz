# Trackezz — Chrome Extension

Automatically track your job applications across LinkedIn, Naukri, Internshala, Indeed, Unstop & Glassdoor. Gmail integration for automatic status updates.

---

## Features

- **Auto-detection** — Tracks applications the moment you click Apply on supported sites
- **Retroactive Gmail scan** — Finds jobs you applied to *before* installing the extension
- **Auto status updates** — Monitors Gmail for interview/offer/rejection emails and updates status automatically
- **Manual add** — Add any application manually
- **CSV export** — Export all data to a spreadsheet
- **All data stored locally** — Nothing sent to any server

---

## Setup (One-time)

### Step 1 — Google Cloud OAuth Setup (for Gmail feature)

1. Go to [https://console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project → name it "Trackezz"
3. Go to **APIs & Services → Library** → search **Gmail API** → Enable it
4. Go to **APIs & Services → OAuth consent screen**
   - Choose **External** → Fill app name "Trackezz", your email
   - Add scope: `https://www.googleapis.com/auth/gmail.readonly`
   - Add your Gmail as a test user → Save
5. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
   - Application type: **Chrome Extension**
   - Copy your **Extension ID** from `chrome://extensions` (after loading it) and paste it
   - Click Create → Copy the **Client ID**
6. Open `manifest.json` in this folder
7. Replace `YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com` with your Client ID

> ⚠️ Gmail integration will NOT work without this step. Auto-detection on job sites works without it.

---

### Step 2 — Load the Extension in Chrome

1. Open Chrome → go to `chrome://extensions`
2. Turn ON **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select this `trackezz-extension` folder
5. The extension icon appears in your toolbar ✅

---

## How to Use

### Auto-tracking
Just apply to jobs normally on LinkedIn, Naukri, Internshala, Indeed, Unstop, or Glassdoor. The extension detects it and saves it automatically with a toast notification.

### Connect Gmail (for status updates)
1. Click the extension icon → click **"Connect Gmail for auto-updates"**
2. Authorize the permissions (read-only)
3. It will ask if you want to scan past emails → click **Yes** to find old applications
4. Going forward, it checks your Gmail every 30 minutes for status updates

### Manual Add
Click the **+ Add** button in the popup to add any application manually.

### Edit / Update Status
Click any job card to edit the company, role, status, or add notes.

### Export
Click the download icon (↓) in the popup header to export all applications as CSV.

---

## Supported Sites

| Site | Auto-detection |
|------|---------------|
| LinkedIn (Easy Apply) | ✅ |
| Naukri | ✅ |
| Internshala | ✅ |
| Indeed | ✅ |
| Unstop | ✅ |
| Glassdoor | ✅ |
| Any site (manual add) | ✅ |

---

## Status Flow

`Applied` → `OA` → `Interview` → `Offer` → `Hired` / `Rejected`

Gmail keywords detected:
- **OA**: online assessment, coding challenge, HackerRank, AMCAT...
- **Interview**: interview invitation, shortlisted, schedule an interview...
- **Offer**: offer letter, pleased to offer, congratulations on selection...
- **Rejected**: unfortunately, not moving forward, regret to inform...

---

## Troubleshooting

**Application not being tracked?**
- Make sure the extension has permission for that site (check `chrome://extensions`)
- Try refreshing the job page before applying
- Use the **+ Add** button to add it manually

**Gmail not connecting?**
- Make sure you followed Step 1 completely
- Make sure you are signed into Chrome with your Google account
- Check that you added yourself as a test user in OAuth consent screen

**Wrong company/role detected?**
- Click the job card to edit it

---

## Future Plans (v2)
- [ ] Naukri & Shine mobile-web support
- [ ] Reminder to follow up after 7 days
- [ ] Notes per application
- [ ] Dark/light theme toggle
- [ ] Sync across devices (optional)
