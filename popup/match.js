// ── Trackezz Resume Match — match.js ────────────────────────


let resumeText = '';
let jobRole = '';
let jobCompany = '';

function applyTheme(theme) {
  document.body.classList.remove('dark-mode', 'light-mode');
  if (theme === 'dark') document.body.classList.add('dark-mode');
  if (theme === 'light') document.body.classList.add('light-mode');
}

// Listen for theme changes from Settings page in real time
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) {
    const newSettings = changes.settings.newValue || {};
    applyTheme(newSettings.theme || 'auto');
  }
});

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Apply theme
  const settings = await sendMessage({ type: 'GET_SETTINGS' });
  applyTheme(settings.theme || 'auto');

  // Get job info from URL params
  const params = new URLSearchParams(window.location.search);
  jobRole = params.get('role') || '';
  jobCompany = params.get('company') || '';

  if (jobRole || jobCompany) {
    document.getElementById('headerTitle').textContent = `Match — ${jobRole}`;
    const bar = document.getElementById('jobInfoBar');
    const text = document.getElementById('jobInfoText');
    bar.style.display = 'flex';
    text.textContent = `${jobRole}${jobCompany ? ' at ' + jobCompany : ''}`;
  }

  // Check if resume already uploaded
  const stored = await sendMessage({ type: 'GET_SETTINGS' });
  if (stored.resumeText) {
    resumeText = stored.resumeText;
    showJobDescSection(stored.resumeFileName || 'Resume.pdf');
  } else {
    document.getElementById('resumeSetup').style.display = 'block';
  }

  setupListeners();
});

function setupListeners() {
  document.getElementById('backBtn').addEventListener('click', () => window.close());

  // PDF upload
  document.getElementById('resumeFile').addEventListener('change', handlePDFUpload);

  // Change resume
  document.getElementById('changeResumeBtn')?.addEventListener('click', () => {
    document.getElementById('jobDescSection').style.display = 'none';
    document.getElementById('resumeSetup').style.display = 'block';
  });

  // Analyse button
  document.getElementById('analyzeBtn').addEventListener('click', runAnalysis);

  // Re-analyse
  document.getElementById('reAnalyzeBtn').addEventListener('click', () => {
    document.getElementById('resultsSection').style.display = 'none';
    document.getElementById('jobDescSection').style.display = 'block';
  });
}

// ── PDF Upload & Text Extraction ──────────────────────────────
async function handlePDFUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const status = document.getElementById('uploadStatus');
  status.textContent = 'Reading PDF...';

  try {
    // Set PDF.js worker
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      '../lib/pdf.worker.min.js';

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += pageText + '\n';
    }

    if (!fullText.trim()) {
      status.textContent = 'Could not extract text. Make sure your PDF is not scanned/image-based.';
      return;
    }

    resumeText = fullText.trim();

    // Save to storage
    await sendMessage({
      type: 'UPDATE_SETTINGS',
      updates: { resumeText: resumeText, resumeFileName: file.name }
    });

    status.textContent = `✅ ${file.name} loaded successfully!`;
    setTimeout(() => {
      document.getElementById('resumeSetup').style.display = 'none';
      showJobDescSection(file.name);
    }, 800);

  } catch (err) {
    status.textContent = 'Error reading PDF: ' + err.message;
  }
}

function showJobDescSection(fileName) {
  document.getElementById('resumeSetup').style.display = 'none';
  document.getElementById('jobDescSection').style.display = 'block';
  document.getElementById('resumeFileName').textContent = fileName;
}

async function getAvailableGeminiModels(apiKey) {
  const defaultModels = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-flash'];
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!res.ok) return defaultModels;
    const data = await res.json();
    if (!data.models || !Array.isArray(data.models)) return defaultModels;

    const validModels = data.models
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => m.name.replace('models/', ''))
      .filter(name => name.includes('flash') || name.includes('pro'));

    return validModels.length > 0 ? validModels : defaultModels;
  } catch {
    return defaultModels;
  }
}

async function callGeminiAPI(prompt, apiKey) {
  const models = await getAvailableGeminiModels(apiKey);

  let lastError = null;
  let hitQuotaLimitZero = false;

  for (const model of models) {
    // Try first with responseMimeType, fallback to standard if rejected
    const configs = [
      { responseMimeType: 'application/json', maxOutputTokens: 2048 },
      { maxOutputTokens: 2048 }
    ];

    for (const genConfig of configs) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: genConfig
          })
        });

        const data = await response.json();

        if (!response.ok) {
          const errMsg = data.error?.message || `HTTP ${response.status}: ${response.statusText}`;
          lastError = new Error(`[${model}] ${errMsg}`);

          const lowerMsg = errMsg.toLowerCase();
          if (lowerMsg.includes('limit: 0') || lowerMsg.includes('quota exceeded')) {
            hitQuotaLimitZero = true;
          }

          if (response.status === 429 || lowerMsg.includes('quota') || lowerMsg.includes('limit')) {
            break; // Move to next model
          }

          if (lowerMsg.includes('api key not valid') || lowerMsg.includes('invalid api key') || response.status === 401) {
            throw lastError;
          }

          continue; // Try next config
        }

        const candidate = data.candidates?.[0];
        if (!candidate || !candidate.content?.parts?.[0]?.text) {
          const finishReason = candidate?.finishReason;
          throw new Error(`Gemini response was empty${finishReason ? ' (reason: ' + finishReason + ')' : ''}.`);
        }

        return candidate.content.parts[0].text.trim();
      } catch (err) {
        lastError = err;
        const lowerErr = err.message.toLowerCase();
        if (lowerErr.includes('api key not valid') || lowerErr.includes('invalid api key')) {
          throw err;
        }
      }
    }
  }

  if (hitQuotaLimitZero) {
    throw new Error('Your Google AI Studio API key has 0 free quota assigned.\n\nTo fix this:\n1. Go to https://aistudio.google.com/apikey\n2. Click "Create API Key"\n3. Choose "Create API key in new project"\n4. Save the new key in Settings.');
  }

  throw lastError || new Error('All Gemini API models failed. Please verify your API key in Google AI Studio.');
}

function parseAIJSONResponse(rawText) {
  if (!rawText) throw new Error('AI response was empty.');

  // 1. Direct JSON parse
  try {
    return JSON.parse(rawText);
  } catch (e) {}

  // 2. Strip markdown backticks
  let cleaned = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {}

  // 3. Extract outer JSON object {...}
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    let jsonStr = match[0];
    try {
      return JSON.parse(jsonStr);
    } catch (e) {}

    // 4. Clean trailing commas and raw control characters inside text strings
    try {
      jsonStr = jsonStr
        .replace(/,\s*([\]}])/g, '$1')
        .replace(/[\r\n\t]/g, ' ')
        .replace(/\\'/g, "'");
      return JSON.parse(jsonStr);
    } catch (e) {}
  }

  // 5. Try repairing truncated JSON by auto-closing string/arrays/objects
  try {
    let repairedStr = cleaned;
    const startIdx = repairedStr.indexOf('{');
    if (startIdx !== -1) {
      repairedStr = repairedStr.substring(startIdx);
      // Remove incomplete trailing key/value or unclosed quote
      repairedStr = repairedStr.replace(/,\s*"[^"]*"?\s*:?\s*$/, '');
      repairedStr = repairedStr.replace(/,\s*$/, '');
      if ((repairedStr.match(/"/g) || []).length % 2 !== 0) {
        repairedStr += '"';
      }
      let openBrackets = (repairedStr.match(/\[/g) || []).length - (repairedStr.match(/\]/g) || []).length;
      let openBraces = (repairedStr.match(/\{/g) || []).length - (repairedStr.match(/\}/g) || []).length;
      while (openBrackets > 0) { repairedStr += ']'; openBrackets--; }
      while (openBraces > 0) { repairedStr += '}'; openBraces--; }
      return JSON.parse(repairedStr);
    }
  } catch (e) {}

  console.warn('[Trackezz] Raw AI text that failed parsing:', rawText);
  throw new Error('Could not parse AI response. Raw output:\n' + rawText.substring(0, 150));
}

// ── AI Analysis ───────────────────────────────────────────────
async function runAnalysis() {
  const jobDesc = document.getElementById('jobDesc').value.trim();
  if (!jobDesc) {
    alert('Please paste the job description first.');
    return;
  }
  if (!resumeText) {
    alert('No resume found. Please upload your resume.');
    return;
  }

  // Show loading
  document.getElementById('jobDescSection').style.display = 'none';
  document.getElementById('resultsSection').style.display = 'none';
  document.getElementById('loadingSection').style.display = 'flex';

  try {
    const prompt = `You are an expert ATS (Applicant Tracking System) and career counsellor.

Analyse how well the following resume matches the job description.

RESUME:
${resumeText.substring(0, 2500)}

JOB DESCRIPTION:
${jobDesc.substring(0, 1800)}

${jobRole ? `Job Role: ${jobRole}` : ''}
${jobCompany ? `Company: ${jobCompany}` : ''}

Respond ONLY with a single valid JSON object matching this structure:
{
  "score": 75,
  "verdict": "Strong Match",
  "summary": "Brief 2 sentence summary of overall fit.",
  "strengths": ["Key strength 1", "Key strength 2"],
  "gaps": ["Missing skill 1", "Missing skill 2"],
  "suggestions": ["Improvement suggestion 1", "Improvement suggestion 2"]
}`;

    // Get API key from settings
    const settingsData = await sendMessage({ type: 'GET_SETTINGS' });
    const apiKey = (settingsData.geminiKey || '').trim();
    if (!apiKey) {
      throw new Error('No API key found. Please add your Gemini API key in extension Settings.');
    }

    const rawText = await callGeminiAPI(prompt, apiKey);

    // Parse JSON response safely
    const result = parseAIJSONResponse(rawText);

    // Show results
    document.getElementById('loadingSection').style.display = 'none';
    showResults(result);

  } catch (err) {
    document.getElementById('loadingSection').style.display = 'none';
    document.getElementById('jobDescSection').style.display = 'block';
    alert('Analysis failed:\n\n' + err.message);
  }
}

// ── Render Results ────────────────────────────────────────────
function showResults(result) {
  const score = Math.min(100, Math.max(0, result.score || 0));

  // Animate score arc
  const arc = document.getElementById('scoreArc');
  const circumference = 289;
  const offset = circumference - (score / 100) * circumference;

  // Color arc based on score
  const arcColor = score >= 70 ? '#4A7A63' : score >= 50 ? '#99CDD8' : score >= 30 ? '#D4956A' : '#C97355';
  arc.style.stroke = arcColor;

  document.getElementById('scoreNum').textContent = score;
  document.getElementById('scoreLabel').textContent = result.verdict || 'Match Score';
  document.getElementById('scoreSub').textContent = result.summary || '';

  // Animate number
  let current = 0;
  const step = score / 40;
  const interval = setInterval(() => {
    current = Math.min(score, current + step);
    document.getElementById('scoreNum').textContent = Math.round(current);
    arc.style.strokeDashoffset = circumference - (current / 100) * circumference;
    if (current >= score) clearInterval(interval);
  }, 20);

  // Build results sections
  const body = document.getElementById('resultsBody');
  body.innerHTML = '';

  if (result.strengths?.length) {
    body.appendChild(buildSection('Matching Strengths', result.strengths, 'green'));
  }
  if (result.gaps?.length) {
    body.appendChild(buildSection('Missing Requirements', result.gaps, 'red'));
  }
  if (result.suggestions?.length) {
    body.appendChild(buildSection('How to Improve', result.suggestions, 'blue'));
  }

  document.getElementById('resultsSection').style.display = 'block';
}

function buildSection(title, items, color) {
  const icons = {
    green: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20,6 9,17 4,12"/></svg>`,
    red: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    blue: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
  };

  const section = document.createElement('div');
  section.className = 'result-section';
  section.innerHTML = `
    <div class="result-section-title ${color}">${icons[color]} ${title}</div>
    ${items.map(item => `
      <div class="result-item">
        <div class="result-dot ${color}"></div>
        <span>${escHtml(item)}</span>
      </div>`).join('')}
  `;
  return section;
}

// ── Helpers ───────────────────────────────────────────────────
function sendMessage(msg) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(msg, res => {
      if (chrome.runtime.lastError) { resolve({}); return; }
      resolve(res || {});
    });
  });
}

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
