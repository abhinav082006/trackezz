// ── Trackezz Stats Dashboard ─────────────────────────────────

const STATUS_COLORS = {
  Applied:   '#99CDD8',
  OA:        '#F3C3B2',
  Interview: '#FDE8D3',
  Offer:     '#DAEBE3',
  Hired:     '#CFD6C4',
  Rejected:  '#E8DDD0'
};

document.addEventListener('DOMContentLoaded', async () => {
  // Apply saved theme
  const settingsRes = await sendMessage({ type: 'GET_SETTINGS' });
  const theme = settingsRes.theme || 'auto';
  document.body.classList.remove('dark-mode', 'light-mode');
  if (theme === 'dark') document.body.classList.add('dark-mode');
  if (theme === 'light') document.body.classList.add('light-mode');

  document.getElementById('backBtn').addEventListener('click', () => window.close());

  const res = await sendMessage({ type: 'GET_JOBS' });
  const jobs = res.jobs || [];

  const content = document.getElementById('content');
  document.getElementById('loading').style.display = 'none';

  if (jobs.length === 0) {
    content.innerHTML = `
      <div class="empty-stats">
        <div class="icon">📊</div>
        <p style="font-weight:700;font-size:14px;color:#657166">No data yet</p>
        <p>Import applications from Internshala, LinkedIn or Indeed to see your stats here.</p>
      </div>`;
    return;
  }

  // ── Compute stats ─────────────────────────────────────────
  const total = jobs.length;
  const statusCounts = {};
  for (const j of jobs) {
    statusCounts[j.status] = (statusCounts[j.status] || 0) + 1;
  }

  const responded = jobs.filter(j => j.status !== 'Applied').length;
  const responseRate = total > 0 ? Math.round((responded / total) * 100) : 0;

  const interviews = (statusCounts['Interview'] || 0) + (statusCounts['Offer'] || 0) + (statusCounts['Hired'] || 0);
  const interviewRate = total > 0 ? Math.round((interviews / total) * 100) : 0;

  const siteCounts = {};
  for (const j of jobs) {
    siteCounts[j.site] = (siteCounts[j.site] || 0) + 1;
  }
  const topSite = Object.entries(siteCounts).sort((a, b) => b[1] - a[1])[0];

  // Weekly breakdown (last 8 weeks)
  const weeks = getWeeklyBreakdown(jobs, 8);

  // Insights
  const staleCount = jobs.filter(j => {
    if (j.status !== 'Applied') return false;
    return Math.floor((Date.now() - new Date(j.appliedDate).getTime()) / 86400000) >= 7;
  }).length;

  const avgDaysToRespond = computeAvgDaysToRespond(jobs);

  // ── Render ─────────────────────────────────────────────────
  content.innerHTML = `

    <!-- Big number cards -->
    <div class="big-cards">
      <div class="big-card accent-blue">
        <div class="label">Total Applied</div>
        <div class="value">${total}</div>
        <div class="sub">across ${Object.keys(siteCounts).length} site${Object.keys(siteCounts).length !== 1 ? 's' : ''}</div>
      </div>
      <div class="big-card accent-mint">
        <div class="label">Response Rate</div>
        <div class="value">${responseRate}%</div>
        <div class="sub">${responded} replied</div>
      </div>
      <div class="big-card accent-peach">
        <div class="label">Interview Rate</div>
        <div class="value">${interviewRate}%</div>
        <div class="sub">${interviews} interview${interviews !== 1 ? 's' : ''}</div>
      </div>
      <div class="big-card accent-rose">
        <div class="label">Pending Follow-up</div>
        <div class="value">${staleCount}</div>
        <div class="sub">7+ days no update</div>
      </div>
    </div>

    <!-- Status breakdown donut -->
    <div class="section-card">
      <div class="section-title">Status Breakdown</div>
      <div class="donut-wrap">
        ${renderDonut(statusCounts, total)}
        <div class="donut-legend">
          ${renderLegend(statusCounts, total)}
        </div>
      </div>
    </div>

    <!-- Weekly applications chart -->
    <div class="section-card">
      <div class="section-title">Applications per Week</div>
      ${renderBarChart(weeks)}
    </div>

    <!-- By site -->
    <div class="section-card">
      <div class="section-title">By Platform</div>
      ${renderSiteRows(siteCounts, total)}
    </div>

    <!-- Insights -->
    <div class="section-card">
      <div class="section-title">Insights</div>
      ${renderInsights(jobs, staleCount, avgDaysToRespond, topSite, interviewRate)}
    </div>
  `;
});

// ── Donut chart (SVG) ─────────────────────────────────────────
function renderDonut(statusCounts, total) {
  const statuses = Object.entries(statusCounts).sort((a, b) => b[1] - a[1]);
  const r = 36; const cx = 44; const cy = 44;
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  let paths = '';

  for (const [status, count] of statuses) {
    const pct = count / total;
    const dash = pct * circumference;
    const gap  = circumference - dash;
    const color = STATUS_COLORS[status] || '#CFD6C4';

    paths += `<circle
      cx="${cx}" cy="${cy}" r="${r}"
      fill="none" stroke="${color}" stroke-width="13"
      stroke-dasharray="${dash} ${gap}"
      stroke-dashoffset="${-offset}"
      transform="rotate(-90 ${cx} ${cy})"
    />`;
    offset += dash;
  }

  return `<svg class="donut-svg" width="88" height="88" viewBox="0 0 88 88">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#EAE0D0" stroke-width="13"/>
    ${paths}
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="#657166" font-size="14" font-weight="800">${total}</text>
    <text x="${cx}" y="${cy + 10}" text-anchor="middle" fill="#B2C5BC" font-size="8">total</text>
  </svg>`;
}

function renderLegend(statusCounts, total) {
  return Object.entries(statusCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => {
      const pct = Math.round((count / total) * 100);
      const color = STATUS_COLORS[status] || '#CFD6C4';
      return `<div class="legend-item">
        <div class="legend-dot" style="background:${color}"></div>
        <span class="legend-label">${status}</span>
        <span class="legend-count">${count}</span>
        <span class="legend-pct">${pct}%</span>
      </div>`;
    }).join('');
}

// ── Weekly bar chart ──────────────────────────────────────────
function getWeeklyBreakdown(jobs, numWeeks) {
  const weeks = [];
  const now = new Date();

  for (let w = numWeeks - 1; w >= 0; w--) {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - (w + 1) * 7);
    const weekEnd = new Date(now);
    weekEnd.setDate(now.getDate() - w * 7);

    const count = jobs.filter(j => {
      const d = new Date(j.appliedDate);
      return d >= weekStart && d < weekEnd;
    }).length;

    const label = weekStart.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    weeks.push({ label, count });
  }
  return weeks;
}

function renderBarChart(weeks) {
  const max = Math.max(...weeks.map(w => w.count), 1);
  const bars = weeks.map(w => {
    const h = Math.round((w.count / max) * 58);
    return `<div class="bar-col">
      ${w.count > 0 ? `<div class="bar-num">${w.count}</div>` : ''}
      <div class="bar ${w.count === 0 ? 'empty' : ''}" style="height:${Math.max(h, 3)}px"></div>
      <div class="bar-label">${w.label.split(' ')[0]}<br>${w.label.split(' ')[1] || ''}</div>
    </div>`;
  }).join('');
  return `<div class="bar-chart">${bars}</div>`;
}

// ── Site rows ─────────────────────────────────────────────────
function renderSiteRows(siteCounts, total) {
  const max = Math.max(...Object.values(siteCounts), 1);
  return Object.entries(siteCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([site, count]) => {
      const pct = Math.round((count / max) * 100);
      return `<div class="site-row">
        <div class="site-name">${site}</div>
        <div class="site-bar-wrap"><div class="site-bar" style="width:${pct}%"></div></div>
        <div class="site-count">${count}</div>
      </div>`;
    }).join('');
}

// ── Insights ──────────────────────────────────────────────────
function computeAvgDaysToRespond(jobs) {
  const responded = jobs.filter(j => j.status !== 'Applied' && j.status !== 'Rejected');
  if (responded.length === 0) return null;
  const total = responded.reduce((sum, j) => {
    return sum + Math.floor((Date.now() - new Date(j.appliedDate).getTime()) / 86400000);
  }, 0);
  return Math.round(total / responded.length);
}

function renderInsights(jobs, staleCount, avgDays, topSite, interviewRate) {
  const insights = [];

  if (topSite) {
    insights.push(`<div class="insight-row">
      <span class="insight-icon">🏆</span>
      <span>Most active on <strong>${topSite[0]}</strong> — ${topSite[1]} application${topSite[1] !== 1 ? 's' : ''}</span>
    </div>`);
  }

  if (interviewRate >= 20) {
    insights.push(`<div class="insight-row">
      <span class="insight-icon">🔥</span>
      <span>Strong interview rate of <strong>${interviewRate}%</strong> — keep it up!</span>
    </div>`);
  } else if (interviewRate > 0 && interviewRate < 10) {
    insights.push(`<div class="insight-row">
      <span class="insight-icon">💡</span>
      <span>Interview rate is <strong>${interviewRate}%</strong> — try tailoring your resume more</span>
    </div>`);
  }

  if (staleCount > 0) {
    insights.push(`<div class="insight-row">
      <span class="insight-icon">⏰</span>
      <span><strong>${staleCount}</strong> application${staleCount !== 1 ? 's' : ''} with no update in 7+ days — consider following up</span>
    </div>`);
  }

  if (avgDays !== null) {
    insights.push(`<div class="insight-row">
      <span class="insight-icon">📅</span>
      <span>Average <strong>${avgDays} days</strong> to get a response</span>
    </div>`);
  }

  if (insights.length === 0) {
    insights.push(`<div class="insight-row">
      <span class="insight-icon">🌱</span>
      <span>Keep applying — insights will appear as your data grows!</span>
    </div>`);
  }

  return insights.join('');
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
