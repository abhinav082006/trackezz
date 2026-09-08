# Privacy Policy for Trackezz — Job Application Tracker

**Last Updated:** September 8, 2026

Trackezz ("we", "our", or "the extension") is committed to protecting your privacy. This Privacy Policy outlines how your data is handled when you use the Trackezz Chrome Extension.

---

## 1. Local-First Data Storage

Trackezz is designed with a **privacy-first, local-only architecture**:

* **Local Storage:** All tracked job applications, application statuses, dates, notes, and tags are stored strictly on your local device using the browser's `chrome.storage.local` API.
* **No Trackezz Servers:** We do not own, operate, or transmit your application data to any external server, database, or analytics platform managed by Trackezz.

---

## 2. Information Collection and Usage

### A. Job Application Tracking
* **Functionality:** Trackezz automatically imports application data (company name, job title, application date, and status) when you visit the application history pages of supported platforms (LinkedIn, Naukri, Internshala, Indeed, Unstop).
* **Usage:** This data is used solely to generate your personal job search dashboard and stats within the extension.

### B. AI Resume Matching
* **PDF Extraction:** When you upload your resume PDF, text extraction is performed 100% client-side inside your browser using PDF.js. Your raw PDF file never leaves your device.
* **Google Gemini API:** When you run an AI match analysis, only the extracted resume text and target job description are sent directly to the Google Gemini API endpoint using **your personal Gemini API key**.
* **Third-Party Data Privacy:** Requests made to the Gemini API are governed by [Google's Privacy Policy](https://policies.google.com/privacy) and Google AI Studio Terms of Service.

---

## 3. Data Sharing and Third-Party Access

* **We do not sell, trade, rent, or transfer your personal information to third parties.**
* We do not collect or track browsing history, personal identity, or activity on non-job platforms.

---

## 4. User Control & Data Deletion

You have full control over your data at all times:

* **Export Data:** You can export all your tracked applications as a `.csv` file at any time from the extension popup or Settings page.
* **Delete Data:** You can edit or delete individual job entries, or permanently erase all stored data by clicking **"Clear All Data"** in extension Settings.

---

## 5. Contact Us

If you have any questions or feedback regarding this Privacy Policy, please open an issue on our GitHub repository or contact the developer.
