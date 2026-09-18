/**
 * Generates every stats card in assets/ from the GitHub GraphQL API.
 * No third-party card services — the SVGs are committed to the repo and
 * refreshed daily by .github/workflows/stats.yml.
 *
 *   node scripts/generate-assets.mjs
 *
 * Auth: GH_TOKEN / GITHUB_TOKEN env var, or falls back to `gh auth token`.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOGIN = process.env.PROFILE_LOGIN || 'Heinsithukyaw';

/* ── palette (matches assets/banner.svg) ───────────────────────── */
const C = {
  bg: '#0A1929',
  bgSoft: '#0E2036',
  stroke: '#1D4F7D',
  grid: '#14345A',
  title: '#5AA8DD',
  value: '#EAF4FC',
  label: '#7A93AB',
  text: '#C3D6E8',
  accent: '#2F7AB8',
  bright: '#9FD4F5',
};
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Ubuntu,'Helvetica Neue',Arial,sans-serif";

/* ── auth + graphql ────────────────────────────────────────────── */
function token() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
}

const TOKEN = token();

async function gql(query, variables = {}) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'profile-readme-generator',
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors, null, 2));
  return json.data;
}

/* ── data ──────────────────────────────────────────────────────── */
// GitHub's contribution calendar is keyed to the profile's local timezone.
// Comparing `new Date(date) <= now` treats dates as UTC midnight and silently
// drops *today* for anyone east of UTC — so resolve "today" in the profile's
// timezone and compare the YYYY-MM-DD strings instead.
const TZ = process.env.PROFILE_TZ || 'Asia/Yangon';
const todayISO = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const YEAR = Number(todayISO.slice(0, 4));
const from = `${YEAR}-01-01T00:00:00Z`;
const to = `${YEAR}-12-31T23:59:59Z`;

const data = await gql(
  `
  query ($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      name
      login
      followers { totalCount }
      repositories(first: 100, ownerAffiliations: OWNER, isFork: false) {
        totalCount
        nodes {
          name
          description
          url
          pushedAt
          stargazerCount
          forkCount
          primaryLanguage { name color }
          languages(first: 12, orderBy: { field: SIZE, direction: DESC }) {
            edges { size node { name color } }
          }
        }
      }
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
        totalPullRequestContributions
        totalIssueContributions
        totalPullRequestReviewContributions
        restrictedContributionsCount
        contributionYears
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount } }
        }
      }
    }
  }`,
  { login: LOGIN, from, to }
);

const user = data.user;
const cc = user.contributionsCollection;

// all-time contributions: sum each contribution year
const years = cc.contributionYears ?? [YEAR];
let totalAllTime = 0;
const perYear = [];
for (const y of years) {
  const d = await gql(
    `query ($login: String!, $from: DateTime!, $to: DateTime!) {
       user(login: $login) {
         contributionsCollection(from: $from, to: $to) { contributionCalendar { totalContributions } }
       }
     }`,
    { login: LOGIN, from: `${y}-01-01T00:00:00Z`, to: `${y}-12-31T23:59:59Z` }
  );
  const n = d.user.contributionsCollection.contributionCalendar.totalContributions;
  totalAllTime += n;
  perYear.push({ year: y, count: n });
}

const days = cc.contributionCalendar.weeks
  .flatMap((w) => w.contributionDays)
  .filter((d) => d.date <= todayISO)
  .sort((a, b) => a.date.localeCompare(b.date));

const stars = user.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0);

// language bytes across own repos
const langBytes = new Map();
for (const repo of user.repositories.nodes) {
  for (const e of repo.languages.edges) {
    const cur = langBytes.get(e.node.name) ?? { size: 0, color: e.node.color };
    cur.size += e.size;
    langBytes.set(e.node.name, cur);
  }
}
const totalBytes = [...langBytes.values()].reduce((s, v) => s + v.size, 0) || 1;
const langs = [...langBytes.entries()]
  .map(([name, v]) => ({ name, pct: (v.size / totalBytes) * 100, color: v.color || C.accent }))
  .sort((a, b) => b.pct - a.pct)
  .slice(0, 8);

// streaks — longest, and the one still running
let longest = 0, longestStart = null, longestEnd = null;
let run = 0, runStart = null;
for (const d of days) {
  if (d.contributionCount > 0) {
    if (run === 0) runStart = d.date;
    run++;
    if (run > longest) { longest = run; longestStart = runStart; longestEnd = d.date; }
  } else {
    run = 0;
    runStart = null;
  }
}

// current streak = the run ending on the latest day with activity, as long as
// that day is today or yesterday (otherwise the streak is already broken)
let cur = 0, curStart = null, curEnd = null;
const lastDay = days[days.length - 1];
if (lastDay && lastDay.contributionCount > 0) {
  cur = run; curStart = runStart; curEnd = lastDay.date;
} else {
  const tail = days.slice(0, -1);
  let n = 0, s = null;
  for (let i = tail.length - 1; i >= 0; i--) {
    if (tail[i].contributionCount > 0) { n++; s = tail[i].date; } else break;
  }
  const gap = lastDay ? (Date.parse(lastDay.date) - Date.parse(s ?? lastDay.date)) / 86400000 : 99;
  if (n > 0 && gap <= 2) { cur = n; curStart = s; curEnd = tail[tail.length - 1].date; }
}

/* ── svg helpers ───────────────────────────────────────────────── */
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const nf = new Intl.NumberFormat('en-US');

function panel(w, h) {
  return `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12"
      fill="${C.bg}" stroke="${C.stroke}" stroke-opacity="0.85"/>`;
}

function heading(w, title) {
  return `
  <text x="26" y="38" font-size="14.5" font-weight="700" fill="${C.title}"
        font-family="${FONT}" letter-spacing="0.3">${esc(title)}</text>
  <rect x="26" y="50" width="54" height="2" rx="1" fill="${C.accent}"/>
  <rect x="80" y="50" width="${w - 106}" height="1" fill="${C.grid}" opacity="0.7"/>`;
}

/* ── stats.svg ─────────────────────────────────────────────────── */
const STATS_W = 480;
const COLS = 4;

// Candidates in priority order. Zero-valued metrics are dropped so a new
// account doesn't advertise a wall of zeroes — they appear automatically
// once they're non-zero.
const candidates = [
  { v: totalAllTime, l: 'CONTRIBUTIONS' },
  { v: cc.totalCommitContributions + cc.restrictedContributionsCount, l: `COMMITS '${String(YEAR).slice(2)}` },
  { v: cc.totalPullRequestContributions, l: 'PULL REQUESTS' },
  { v: cc.totalIssueContributions, l: 'ISSUES OPENED' },
  { v: cc.totalPullRequestReviewContributions, l: 'REVIEWS' },
  { v: stars, l: 'STARS EARNED' },
  { v: user.followers.totalCount, l: 'FOLLOWERS' },
  { v: user.repositories.totalCount, l: 'PUBLIC REPOS' },
  { v: langBytes.size, l: 'LANGUAGES' },
  { v: years.length, l: 'ACTIVE YEARS' },
  { v: longest, l: 'LONGEST STREAK' },
  { v: cur, l: 'CURRENT STREAK' },
  { v: Math.min(...years), l: 'ACTIVE SINCE' },
];

const tiles = candidates.filter((t) => t.v > 0).slice(0, 8).map((t) => ({ ...t, v: nf.format(t.v) }));
const ROWS = Math.max(1, Math.ceil(tiles.length / COLS));
const STATS_H = 74 + ROWS * 66 + 16;

const gx = 26, gy = 74, gw = STATS_W - gx * 2;
const cw = gw / COLS, rh = 66;

let tilesSvg = '';
tiles.forEach((t, i) => {
  const col = i % COLS, row = Math.floor(i / COLS);
  const cx = gx + col * cw;
  const cy = gy + row * rh;
  if (col > 0) {
    tilesSvg += `<line x1="${cx - 10}" y1="${cy + 6}" x2="${cx - 10}" y2="${cy + 48}"
      stroke="${C.grid}" stroke-opacity="0.55"/>`;
  }
  tilesSvg += `
    <text x="${cx}" y="${cy + 30}" font-size="23" font-weight="700" fill="${C.value}"
          font-family="${FONT}">${esc(t.v)}</text>
    <text x="${cx}" y="${cy + 50}" font-size="9.5" font-weight="600" fill="${C.label}"
          font-family="${FONT}" letter-spacing="0.7">${esc(t.l)}</text>`;
});

const statsSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${STATS_W}" height="${STATS_H}"
     viewBox="0 0 ${STATS_W} ${STATS_H}" role="img" aria-label="GitHub statistics for ${esc(LOGIN)}">
  ${panel(STATS_W, STATS_H)}
  ${heading(STATS_W, 'GitHub Stats')}
  ${tilesSvg}
</svg>`;

/* ── langs.svg ─────────────────────────────────────────────────── */
const LANG_W = 480, LANG_H = STATS_H;
const barX = 26, barY = 74, barW = LANG_W - barX * 2, barH = 14;

let off = 0;
let segs = '';
for (const l of langs) {
  const w = (l.pct / 100) * barW;
  segs += `<rect x="${(barX + off).toFixed(2)}" y="${barY}" width="${w.toFixed(2)}" height="${barH}"
     fill="${l.color}"/>`;
  off += w;
}
// rounded ends
segs = `<clipPath id="barClip"><rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="7"/></clipPath>
  <g clip-path="url(#barClip)">${segs}</g>`;

let legend = '';
const lc = 2, lr = Math.ceil(langs.length / lc);
const colW = (LANG_W - barX * 2) / lc;
langs.forEach((l, i) => {
  const col = i % lc, row = Math.floor(i / lc);
  const x = barX + col * colW;
  const y = barY + 44 + row * 26;
  legend += `
    <circle cx="${x + 5}" cy="${y - 4}" r="5" fill="${l.color}"/>
    <text x="${x + 18}" y="${y}" font-size="12" font-weight="600" fill="${C.text}"
          font-family="${FONT}">${esc(l.name)}</text>
    <text x="${x + colW - 22}" y="${y}" font-size="12" font-weight="700" fill="${C.title}"
          font-family="${FONT}" text-anchor="end">${l.pct.toFixed(1)}%</text>`;
});

const langsSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${LANG_W}" height="${LANG_H}"
     viewBox="0 0 ${LANG_W} ${LANG_H}" role="img" aria-label="Most used languages for ${esc(LOGIN)}">
  ${panel(LANG_W, LANG_H)}
  ${heading(LANG_W, 'Most Used Languages')}
  <defs>${segs.slice(0, segs.indexOf('<g clip-path'))}</defs>
  ${segs.slice(segs.indexOf('<g clip-path'))}
  ${legend}
</svg>`;

/* ── activity.svg ──────────────────────────────────────────────── */
const ACT_W = 880, ACT_H = 250;
const ax = 46, ay = 74, aw = ACT_W - ax - 30, ah = ACT_H - ay - 42;
const counts = days.map((d) => d.contributionCount);
const rawMax = Math.max(...counts, 1);

// round the axis up to a "nice" number so ticks read 0/10/20/30 instead of 0/13/27/40
function niceStep(x) {
  const exp = Math.pow(10, Math.floor(Math.log10(x)));
  const f = x / exp;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return n * exp;
}
const step = niceStep(rawMax / 4);
const max = step * 4;

const px = (i) => ax + (i / Math.max(counts.length - 1, 1)) * aw;
const py = (v) => ay + ah - Math.min(v / max, 1) * ah;

const line = counts.map((v, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
const area = `${line} L${px(counts.length - 1).toFixed(1)},${(ay + ah).toFixed(1)} L${ax},${(ay + ah).toFixed(1)} Z`;

// y grid
let grid = '';
for (let g = 0; g <= 4; g++) {
  const y = ay + (ah / 4) * g;
  const val = Math.round((max / 4) * (4 - g));
  grid += `
    <line x1="${ax}" y1="${y.toFixed(1)}" x2="${ax + aw}" y2="${y.toFixed(1)}"
          stroke="${C.grid}" stroke-opacity="${g === 4 ? 0.9 : 0.45}"/>
    <text x="${ax - 10}" y="${(y + 4).toFixed(1)}" font-size="10" fill="${C.label}"
          font-family="${FONT}" text-anchor="end">${val}</text>`;
}

// month ticks
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
let months = '';
let seen = '';
days.forEach((d, i) => {
  const m = d.date.slice(0, 7);
  if (m !== seen) {
    seen = m;
    const mi = Number(d.date.slice(5, 7)) - 1;
    months += `<text x="${px(i).toFixed(1)}" y="${ay + ah + 22}" font-size="10.5"
      fill="${C.label}" font-family="${FONT}" text-anchor="middle">${MONTHS[mi]}</text>`;
  }
});

const actSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ACT_W}" height="${ACT_H}"
     viewBox="0 0 ${ACT_W} ${ACT_H}" role="img" aria-label="Contribution graph for ${esc(LOGIN)}">
  <defs>
    <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${C.title}" stop-opacity="0.55"/>
      <stop offset="60%" stop-color="${C.accent}" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="${C.accent}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="lineStroke" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${C.accent}"/>
      <stop offset="50%" stop-color="${C.bright}"/>
      <stop offset="100%" stop-color="${C.title}"/>
    </linearGradient>
  </defs>

  ${panel(ACT_W, ACT_H)}
  ${heading(ACT_W, 'Contribution Graph')}

  <text x="${ACT_W - 26}" y="38" font-size="12" fill="${C.label}" font-family="${FONT}"
        text-anchor="end">${esc(String(YEAR))} ·
    <tspan fill="${C.title}" font-weight="700">${nf.format(cc.contributionCalendar.totalContributions)}</tspan>
    <tspan fill="${C.label}"> contributions</tspan></text>

  ${grid}
  <path d="${area}" fill="url(#areaFill)"/>
  <path d="${line}" fill="none" stroke="url(#lineStroke)" stroke-width="2"
        stroke-linejoin="round" stroke-linecap="round"/>
  ${months}

  <text x="${ax}" y="${ACT_H - 10}" font-size="10" fill="${C.label}" font-family="${FONT}">
    <tspan font-weight="700" fill="${C.title}">${cur}</tspan>-day current streak
    <tspan fill="${C.grid}">  ·  </tspan>
    longest <tspan font-weight="700" fill="${C.title}">${longest}</tspan> days
    <tspan fill="${C.grid}">  ·  </tspan>
    <tspan font-weight="700" fill="${C.title}">${nf.format(totalAllTime)}</tspan> contributions all-time
  </text>
</svg>`;

/* ── projects.svg ──────────────────────────────────────────────── */
const FEATURED = ['Callme.ai', 'DailyNews', 'PIG', 'AgentOS'];

const PROJ_W = 880, PROJ_H = 268;
const cardGap = 18;
const cardW = (PROJ_W - 26 * 2 - cardGap) / 2;
const cardH = 86;

const byName = new Map(user.repositories.nodes.map((r) => [r.name, r]));

function truncate(s, n) {
  const t = (s || '').trim();
  if (!t) return 'No description yet.';
  return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + '…';
}

function relTime(iso) {
  if (!iso) return '—';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  if (d < 365) return `${Math.round(d / 30)}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}

// Optional per-repo description overrides, used when a repo has none on GitHub.
// Fill these in (or set real descriptions on the repos — better for SEO anyway).
const DESCRIPTIONS = {
  // 'AgentOS': 'Agent orchestration runtime',
};

let cards = '';
FEATURED.forEach((name, i) => {
  const r = byName.get(name);
  if (!r) return;
  const col = i % 2, row = Math.floor(i / 2);
  const x = 26 + col * (cardW + cardGap);
  const y = 74 + row * (cardH + 18);
  const lang = r.primaryLanguage?.name ?? '—';
  const dot = r.primaryLanguage?.color ?? C.accent;
  const stats = [
    r.stargazerCount > 0 ? `★ ${nf.format(r.stargazerCount)}` : null,
    r.forkCount > 0 ? `${nf.format(r.forkCount)} forks` : null,
  ].filter(Boolean);

  cards += `
  <g>
    <rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="9"
          fill="${C.bgSoft}" stroke="${C.grid}" stroke-opacity="0.9"/>
    <rect x="${x}" y="${y}" width="3" height="${cardH}" rx="1.5" fill="${C.accent}" opacity="0.85"/>
    <text x="${x + 18}" y="${y + 26}" font-size="14" font-weight="700" fill="${C.title}"
          font-family="${FONT}">${esc(r.name)}</text>
    ${stats.length
      ? `<text x="${x + cardW - 16}" y="${y + 26}" font-size="11.5" font-weight="600" fill="${C.bright}"
          font-family="${FONT}" text-anchor="end">${esc(stats.join('  ·  '))}</text>`
      : ''}
    <text x="${x + 18}" y="${y + 48}" font-size="10.5" fill="${C.label}"
          font-family="${FONT}">${esc(truncate(DESCRIPTIONS[r.name] ?? r.description, 58))}</text>
    <circle cx="${x + 23}" cy="${y + 68}" r="4.5" fill="${dot}"/>
    <text x="${x + 34}" y="${y + 71.5}" font-size="10.5" font-weight="600" fill="${C.text}"
          font-family="${FONT}">${esc(lang)}</text>
    <text x="${x + cardW - 16}" y="${y + 71.5}" font-size="10.5" fill="${C.label}"
          font-family="${FONT}" text-anchor="end">updated ${esc(relTime(r.pushedAt))}</text>
  </g>`;
});

const projectsSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PROJ_W}" height="${PROJ_H}"
     viewBox="0 0 ${PROJ_W} ${PROJ_H}" role="img" aria-label="Featured projects by ${esc(LOGIN)}">
  ${panel(PROJ_W, PROJ_H)}
  ${heading(PROJ_W, 'Featured Projects')}
  ${cards}
</svg>`;

/* ── streak.svg ────────────────────────────────────────────────── */
const STR_W = 720, STR_H = 168;

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDay(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return `${MON[m - 1]} ${d}`;
}
function fmtRange(a, b) {
  if (!a) return '—';
  return a === b ? fmtDay(a) : `${fmtDay(a)} – ${fmtDay(b)}`;
}
const firstYear = Math.min(...years);

const streakCols = [
  { v: nf.format(totalAllTime), l: 'Total Contributions', s: `${MON[9]} 7, ${firstYear} – Present`, hot: false },
  { v: nf.format(cur), l: 'Current Streak', s: cur ? fmtRange(curStart, curEnd) : 'No active streak', hot: true },
  { v: nf.format(longest), l: 'Longest Streak', s: longest ? fmtRange(longestStart, longestEnd) : '—', hot: false },
];

const sColW = (STR_W - 2) / 3;
let streakSvg = '';
streakCols.forEach((c, i) => {
  const cx = 1 + sColW * i + sColW / 2;
  if (i > 0) {
    streakSvg += `<line x1="${(1 + sColW * i).toFixed(1)}" y1="30" x2="${(1 + sColW * i).toFixed(1)}" y2="${STR_H - 30}"
      stroke="${C.grid}" stroke-opacity="0.7"/>`;
  }
  streakSvg += `
    <text x="${cx.toFixed(1)}" y="76" font-size="38" font-weight="700"
          fill="${c.hot ? C.title : C.value}" font-family="${FONT}" text-anchor="middle">${esc(c.v)}</text>
    <text x="${cx.toFixed(1)}" y="104" font-size="12.5" font-weight="600"
          fill="${c.hot ? C.title : C.text}" font-family="${FONT}" text-anchor="middle">${esc(c.l)}</text>
    <text x="${cx.toFixed(1)}" y="126" font-size="11" fill="${C.label}"
          font-family="${FONT}" text-anchor="middle">${esc(c.s)}</text>`;
});

const streakSvgOut = `<svg xmlns="http://www.w3.org/2000/svg" width="${STR_W}" height="${STR_H}"
     viewBox="0 0 ${STR_W} ${STR_H}" role="img" aria-label="Contribution streak for ${esc(LOGIN)}">
  ${panel(STR_W, STR_H)}
  ${streakSvg}
</svg>`;

/* ── write ─────────────────────────────────────────────────────── */
mkdirSync(join(ROOT, 'assets'), { recursive: true });
writeFileSync(join(ROOT, 'assets/stats.svg'), statsSvg);
writeFileSync(join(ROOT, 'assets/langs.svg'), langsSvg);
writeFileSync(join(ROOT, 'assets/activity.svg'), actSvg);
writeFileSync(join(ROOT, 'assets/streak.svg'), streakSvgOut);
writeFileSync(join(ROOT, 'assets/projects.svg'), projectsSvg);
writeFileSync(
  join(ROOT, 'assets/stats.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      login: LOGIN,
      name: user.name,
      totalContributionsAllTime: totalAllTime,
      perYear,
      year: YEAR,
      contributionsThisYear: cc.contributionCalendar.totalContributions,
      commitsThisYear: cc.totalCommitContributions + cc.restrictedContributionsCount,
      pullRequests: cc.totalPullRequestContributions,
      issues: cc.totalIssueContributions,
      reviews: cc.totalPullRequestReviewContributions,
      publicRepos: user.repositories.totalCount,
      stars,
      followers: user.followers.totalCount,
      currentStreak: cur,
      longestStreak: longest,
      topLanguages: langs.map((l) => ({ name: l.name, pct: +l.pct.toFixed(2) })),
    },
    null,
    2
  ) + '\n'
);

console.log('✓ assets/stats.svg, assets/langs.svg, assets/activity.svg, assets/stats.json');
console.log(`  all-time ${totalAllTime} · this year ${cc.contributionCalendar.totalContributions} · streak ${cur} (max ${longest})`);
console.log(`  top langs: ${langs.map((l) => `${l.name} ${l.pct.toFixed(1)}%`).join(', ')}`);
