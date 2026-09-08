# Trackezz — Job Application Tracker

A Chrome extension that automatically tracks and manages your job applications across major Indian and global job platforms. No manual entry — just apply and Trackezz handles the rest.

---

## Features

### Auto Import from Applied Pages

Visit your applications page on any supported site and Trackezz automatically imports all your applications with role, company, status, and date.

| Platform | Applied Jobs Page |
|----------|-------------------|
| Internshala | internshala.com/student/applications |
| LinkedIn | linkedin.com/jobs-tracker/?stage=applied |
| Indeed | myjobs.indeed.com/applied |
| Naukri | naukri.com/myapply/historypage |
| Unstop | unstop.com/user/registrations/all/all |

### Sync All Sites

One button syncs all platforms at once — opens each site's applied jobs page in the background, scrapes your applications, and updates statuses automatically.

### AI Resume Match

Upload your resume PDF once and get an AI-powered match score against any job description:

- **Match score (0–100%)** with animated visual
- **Matching strengths** — what you have that they want
- **Missing requirements** — skill gaps to address
- **Improvement suggestions** — specific actionable advice

Powered by Google Gemini API (free tier — no credit card needed).

### Stats Dashboard

Visual overview of your entire job search:

- Total applied, response rate, interview rate
- Status breakdown donut chart
- Weekly applications bar chart
- Platform-wise breakdown
- Smart insights based on your data

### Follow-up Reminders

Automatically notifies you when an application has had no status update after 7, 14, or 30 days. Extension badge shows count of stale applications.

### Notes & Tags

Add notes and tags to each application:

- 6 preset tags: Dream Company, Referral, Urgent, Follow-up Sent, Remote, High Priority
- Custom tags (up to 5 per job)
- Notes preview visible directly on the card

### Dark / Light / Auto Theme

Three appearance modes — Auto follows your OS setting, or manually pick Light or Dark.

### Manual Add / Edit / Delete

Add any application manually. Edit role, company, status, site, date, notes, and tags at any time.

### CSV Export

Export all your tracked applications as a spreadsheet.

---

## Setup

### Step 1 — Load the Extension

1. Download or clone this repository
2. Open Chrome → go to `chrome://extensions`
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked** → select the `job-tracker` folder
5. Trackezz icon appears in your toolbar ✅

> ⚠️ **Important:** `manifest.json` contains a placeholder OAuth client ID. Do not commit your real credentials. See `manifest.example.json` for reference.

### Step 2 — Set up AI Resume Match (Optional)

1. Get a free Gemini API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — no credit card needed
2. Open Trackezz → click ⚙️ Settings → scroll to AI Resume Match
3. Paste your API key → click Save

### Step 3 — Import Your Applications

**Option A — Sync All (recommended)**
Click the ↻ Sync All Sites button in the popup footer. Trackezz will open each platform in the background and import everything automatically.

**Option B — Per-site import**
Visit any supported platform's applied jobs page. A purple Import All banner appears in the popup — click it to import from that site.

---

## How to Use

### Tracking Applications

Import from your applied pages using Sync All or the per-site Import All banner.

### Checking Resume Match

1. Click the ⚡ Match button on any job card
2. First time: upload your resume PDF (extracted locally — never sent to any server)
3. Paste the job description
4. Click **Analyse Match** → get score + breakdown in seconds

### Viewing Stats

Click the 📊 bar chart icon in the popup header to open the stats dashboard.

### Follow-up Tracking

The extension icon shows a badge count of applications with no update in 7+ days. Click the ⏰ Follow-up filter tab to see only those applications.

### Editing Applications

Click any job card to edit role, company, status, date, notes, and tags.

---

## Supported Platforms

| Platform | Import |
|----------|--------|
| Internshala | ✅ |
| LinkedIn | ✅ |
| Indeed | ✅ |
| Naukri | ✅ |
| Unstop | ✅ (internships & jobs only) |

> **Note:** Live auto-detection on apply was removed for reliability. Import from applied pages is the recommended approach.

---

## Status Flow

`Applied` → `OA` → `Interview` → `Offer` → `Hired`
↘ `Rejected` (can happen at any stage)

Internshala-specific statuses detected:
- In-touch → Interview
- Not Selected → Rejected
- Shortlisted → Interview
- Offer Letter Sent → Offer

---

## Privacy

- All job data is stored locally in Chrome storage — never sent to any server
- Resume PDF is extracted locally in the browser — the file never leaves your device
- Only the extracted resume text is sent to Gemini API for matching (using your own API key)
- Sync All opens background tabs that are automatically closed after scraping

---

## Project Structure

```
job-tracker/
├── background/
│   └── service-worker.js       # Core logic, storage, sync, alarms
├── content-scripts/
│   ├── utils.js                # Shared helpers, toast notifications
│   ├── internshala.js          # Internshala scraper
│   ├── linkedin.js             # LinkedIn scraper
│   ├── indeed.js               # Indeed scraper
│   ├── naukri.js               # Naukri scraper
│   └── unstop.js               # Unstop scraper
├── popup/
│   ├── popup.html/css/js       # Main extension popup
│   ├── stats.html/css/js       # Stats dashboard
│   └── match.html/css/js       # AI Resume Match
├── options/
│   └── options.html/js         # Settings page
├── lib/
│   ├── pdf.min.js              # PDF.js for resume extraction
│   └── pdf.worker.min.js
├── icons/
└── manifest.json
```

---

## Tech Stack

- **Chrome Extension Manifest V3**
- **Vanilla JavaScript** — no frameworks
- **Chrome Storage API** — local data persistence
- **Chrome Alarms API** — follow-up reminders + daily sync
- **Chrome Scripting API** — background tab injection for Sync All
- **PDF.js** — client-side PDF text extraction
- **Google Gemini API** — AI resume matching

---

## Contributing

Pull requests are welcome. For major changes, open an issue first.

## License

MIT

---

*Built for Indian students and freshers — by a student, for students.*
