/**
 * Generates every stats card in assets/ from the GitHub GraphQL API.
 * No third-party card services — the SVGs are committed to the repo and
 * refreshed daily by .github/workflows/stats.yml.
 *
 *   node scripts/generate-assets.mjs
 *
 * Auth: GH_TOKEN / GITHUB_TOKEN env var, or falls back to `gh auth token`.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
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

// Repository data comes from REST, not GraphQL.
// The Actions GITHUB_TOKEN is an installation token scoped to THIS repo, so
// `user.repositories` over GraphQL would only ever see the profile repo itself
// (publicRepos: 1). The public REST endpoints return the real list regardless
// of token scope, so the numbers are the same locally and in CI.
async function restGet(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'profile-readme-generator',
    },
  });
  if (!res.ok) throw new Error(`REST ${path} -> ${res.status} ${res.statusText}`);
  return res.json();
}

// linguist colours, since the REST API only returns the language *name*
const LANG_COLORS = {
  TypeScript: '#3178C6', JavaScript: '#F1E05A', Python: '#3572A5', HTML: '#E34F26',
  CSS: '#563D7C', SCSS: '#C6538C', PHP: '#4F5D95', Blade: '#F7523F', Go: '#00ADD8',
  'Go Template': '#00ADD8', Solidity: '#AA6746', Kotlin: '#A97BFF', 'C++': '#F34B7D',
  C: '#555555', 'C#': '#178600', Java: '#B07219', Ruby: '#701516', Rust: '#DEA584',
  Shell: '#89E051', PowerShell: '#012456', Dockerfile: '#384D54', Makefile: '#427819',
  'PLpgSQL': '#336790', HCL: '#844FBA', TeX: '#3D6117', Mako: '#7E858D',
  'Open Policy Agent': '#7D9199', Vue: '#41B883', Svelte: '#FF3E00', MDX: '#FCB32C',
};

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

const cc = data.user.contributionsCollection;

// ── profile + repositories over REST ────────────────────────────
const profile = await restGet(`/users/${LOGIN}`);
const rawRepos = await restGet(`/users/${LOGIN}/repos?per_page=100&type=owner&sort=updated`);

const repos = [];
for (const r of rawRepos) {
  if (r.fork) continue;
  let langs = {};
  try {
    langs = await restGet(`/repos/${LOGIN}/${r.name}/languages`);
  } catch {
    /* empty repo, or languages unavailable */
  }
  repos.push({
    name: r.name,
    description: r.description,
    url: r.html_url,
    pushedAt: r.pushed_at,
    stargazerCount: r.stargazers_count,
    forkCount: r.forks_count,
    primaryLanguage: r.language
      ? { name: r.language, color: LANG_COLORS[r.language] ?? C.accent }
      : null,
    languages: Object.entries(langs).map(([name, size]) => ({
      name,
      size,
      color: LANG_COLORS[name] ?? C.accent,
    })),
  });
}

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

const stars = repos.reduce((s, r) => s + r.stargazerCount, 0);

// language bytes across own repos
const langBytes = new Map();
for (const repo of repos) {
  for (const l of repo.languages) {
    const cur = langBytes.get(l.name) ?? { size: 0, color: l.color };
    cur.size += l.size;
    langBytes.set(l.name, cur);
  }
}
const totalBytes = [...langBytes.values()].reduce((s, v) => s + v.size, 0) || 1;

// The breakdown itself prefers the committed local snapshot
// (scripts/languages.json, built by measure-languages.mjs). The public API can
// only see public repos, and every one of this profile's own repos is private —
// so an API-derived mix would describe *fork* code, not the work on display.
// The snapshot also excludes markup/data formats (JSON, Markdown, YAML) that
// would otherwise dominate a byte-count and say nothing about the code written.
const CODE_LANGS = new Set([
  'TypeScript', 'JavaScript', 'Python', 'Go', 'Rust', 'Java', 'Kotlin', 'Ruby',
  'PHP', 'C#', 'Swift', 'C', 'C++', 'Shell', 'SQL', 'SCSS', 'CSS', 'Vue',
  'Svelte', 'Dart', 'Elixir', 'Scala', 'Perl', 'Lua', 'R', 'Objective-C',
]);

const snapshotPath = join(ROOT, 'scripts/languages.json');
const snapshot = existsSync(snapshotPath)
  ? JSON.parse(readFileSync(snapshotPath, 'utf8'))
  : null;

let langs;
let ownProjectCount = repos.length;
if (snapshot) {
  ownProjectCount = snapshot.projectsScanned;
  const code = snapshot.languages.filter((l) => CODE_LANGS.has(l.name));
  const sum = code.reduce((s, l) => s + l.size, 0) || 1;
  langs = code
    .map((l) => ({ name: l.name, pct: (l.size / sum) * 100, color: LANG_COLORS[l.name] ?? C.accent }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 6);
} else {
  langs = [...langBytes.entries()]
    .map(([name, v]) => ({ name, pct: (v.size / totalBytes) * 100, color: v.color || C.accent }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 8);
}
const langCount = snapshot
  ? snapshot.languages.filter((l) => CODE_LANGS.has(l.name)).length
  : langBytes.size;

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
  { v: profile.followers, l: 'FOLLOWERS' },
  { v: ownProjectCount, l: 'PROJECTS' },
  { v: langCount, l: 'LANGUAGES' },
  { v: years.length, l: 'ACTIVE YEARS' },
  { v: longest, l: 'LONGEST STREAK' },
  { v: cur, l: 'CURRENT STREAK' },
  { v: Math.min(...years), l: 'ON GITHUB SINCE', raw: true },
];

// `raw` opts a tile out of thousands-grouping — a year must not render "2,019".
const tiles = candidates
  .filter((t) => t.v > 0)
  .slice(0, 8)
  .map((t) => ({ ...t, v: t.raw ? String(t.v) : nf.format(t.v) }));
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
     viewBox="0 0 ${LANG_W} ${LANG_H}" role="img" aria-label="Primary languages for ${esc(LOGIN)}">
  ${panel(LANG_W, LANG_H)}
  ${heading(LANG_W, 'Primary Languages')}
  <defs>${segs.slice(0, segs.indexOf('<g clip-path'))}</defs>
  ${segs.slice(segs.indexOf('<g clip-path'))}
  ${legend}
  <text x="${barX}" y="${LANG_H - 14}" font-size="10" fill="${C.label}" font-family="${FONT}"
        >share of source in my own projects${snapshot ? ` · ${snapshot.generatedAt}` : ''}</text>
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
// The featured list is curated locally (scripts/featured.json) rather than
// derived from the API. Most of these repos are private, and a private repo is
// invisible to the public /users/:login/repos endpoint — which previously left
// this card rendering empty for every logged-out visitor. Curating locally also
// lets the card show real descriptions instead of "No description yet."
const FEATURED = JSON.parse(readFileSync(join(ROOT, 'scripts/featured.json'), 'utf8'));

const PROJ_W = 880;
const PAD = 26;
const GAP = 16;
const innerW = PROJ_W - PAD * 2;
const pColW = (innerW - GAP) / 2;
const FLAG_H = 104;
const SM_H = 88;
const Y0 = 66;

const FLAG = FEATURED.find((f) => f.flagship) ?? FEATURED[0];
const OTHERS = FEATURED.filter((f) => f !== FLAG);
const gridTop = Y0 + FLAG_H + GAP;
const gridRows = Math.ceil((OTHERS.length + 1) / 2); // +1 = the "all repos" cell
const PROJ_H = gridTop + gridRows * SM_H + (gridRows - 1) * GAP + 24;

// Public repos, if any — used only to enrich a card with live stars/forks.
const byName = new Map(repos.map((r) => [r.name, r]));

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

/* Ambient motion lives in CSS so `prefers-reduced-motion` can switch it off.
   The one-shot entrance / bar-grow is SMIL, which has no CSS equivalent for
   geometry attributes. */
const PROJ_CSS = `
  .pj-aurora{animation:pjDrift 18s ease-in-out infinite}
  .pj-shimmer{animation:pjSweep 8s linear infinite;animation-delay:1.6s}
  .pj-glow{animation:pjGlow 5.5s ease-in-out infinite}
  .pj-arrow{animation:pjArrow 2.6s ease-in-out infinite}
  .pj-p0{animation:pjPill 5.2s ease-in-out infinite}
  .pj-p1{animation:pjPill 5.2s ease-in-out infinite;animation-delay:-1.3s}
  .pj-p2{animation:pjPill 5.2s ease-in-out infinite;animation-delay:-2.6s}
  .pj-p3{animation:pjPill 5.2s ease-in-out infinite;animation-delay:-3.9s}
  @keyframes pjDrift{0%,100%{transform:translateX(-90px)}50%{transform:translateX(70px)}}
  @keyframes pjSweep{0%{transform:translateX(-320px)}100%{transform:translateX(1220px)}}
  @keyframes pjGlow{0%,100%{opacity:.18}50%{opacity:.6}}
  @keyframes pjPill{0%,100%{opacity:.42}50%{opacity:1}}
  @keyframes pjArrow{0%,100%{transform:translateX(0)}50%{transform:translateX(5px)}}
  @media (prefers-reduced-motion:reduce){
    .pj-aurora,.pj-shimmer,.pj-glow,.pj-arrow,.pj-p0,.pj-p1,.pj-p2,.pj-p3{animation:none}
  }`;

const PROJ_DEFS = `
  <style>${PROJ_CSS}</style>
  <linearGradient id="pjCard" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#102741"/><stop offset="1" stop-color="#0B1B2E"/>
  </linearGradient>
  <linearGradient id="pjFlag" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#13324F"/><stop offset="0.6" stop-color="#0E2440"/>
    <stop offset="1" stop-color="#0B1B2E"/>
  </linearGradient>
  <radialGradient id="pjAurora" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#2F7AB8" stop-opacity="0.6"/>
    <stop offset="0.55" stop-color="#2F7AB8" stop-opacity="0.18"/>
    <stop offset="1" stop-color="#2F7AB8" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="pjShimmer" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#9FD4F5" stop-opacity="0"/>
    <stop offset="0.5" stop-color="#9FD4F5" stop-opacity="0.15"/>
    <stop offset="1" stop-color="#9FD4F5" stop-opacity="0"/>
  </linearGradient>
  <pattern id="pjDots" width="24" height="24" patternUnits="userSpaceOnUse">
    <circle cx="1" cy="1" r="1" fill="#2F7AB8" opacity="0.5"/>
  </pattern>
  <clipPath id="pjFlagClip">
    <rect x="${PAD}" y="${Y0}" width="${innerW}" height="${FLAG_H}" rx="12"/>
  </clipPath>`;

// NOTE: every animation below is *additive* — the card renders fully visible
// with no animation running at all. Nothing gates visibility on an animation,
// because a failed animation would otherwise leave the section blank on the
// live profile.

/* ── flagship hero ──────────────────────────────────────────────── */
const flagX = PAD, flagY = Y0;
let pillX = flagX + 24;
let pills = '';
(FLAG.surfaces ?? []).forEach((s, i) => {
  const w = 22 + s.length * 6.4;
  pills += `
      <g class="pj-p${i}">
        <rect x="${pillX.toFixed(1)}" y="${flagY + 66}" width="${w.toFixed(1)}" height="20" rx="10"
              fill="${C.accent}" fill-opacity="0.2" stroke="${C.stroke}" stroke-opacity="0.75"/>
        <text x="${(pillX + w / 2).toFixed(1)}" y="${flagY + 79.6}" font-size="10" font-weight="600"
              fill="${C.bright}" font-family="${FONT}" text-anchor="middle"
              letter-spacing="0.6">${esc(s)}</text>
      </g>`;
  pillX += w + 8;
});

const flagDot = FLAG.color ?? C.accent;
const flagSvg = `
  <g>
    <rect x="${flagX}" y="${flagY}" width="${innerW}" height="${FLAG_H}" rx="12"
          fill="none" stroke="${C.accent}" stroke-width="1.2" class="pj-glow"/>
    <rect x="${flagX}" y="${flagY}" width="${innerW}" height="${FLAG_H}" rx="12"
          fill="url(#pjFlag)" stroke="${C.stroke}" stroke-opacity="0.9"/>
    <g clip-path="url(#pjFlagClip)">
      <ellipse cx="${(flagX + innerW * 0.68).toFixed(0)}" cy="${flagY + FLAG_H / 2}" rx="300" ry="88"
               fill="url(#pjAurora)" class="pj-aurora"/>
      <rect x="${flagX}" y="${flagY}" width="${innerW}" height="${FLAG_H}"
            fill="url(#pjDots)" opacity="0.45"/>
      <rect x="${flagX}" y="${flagY}" width="170" height="${FLAG_H}"
            fill="url(#pjShimmer)" class="pj-shimmer"/>
    </g>
    <rect x="${flagX}" y="${flagY}" width="3" height="${FLAG_H}" rx="1.5" fill="${C.bright}"/>
    <rect x="${flagX + 12}" y="${flagY + 1}" width="${innerW - 24}" height="1"
          fill="${C.bright}" opacity="0.28"/>
    <text x="${flagX + 24}" y="${flagY + 34}" font-size="19" font-weight="700" fill="${C.value}"
          font-family="${FONT}">${esc(FLAG.name)}</text>
    <rect x="${flagX + innerW - 90}" y="${flagY + 18}" width="66" height="18" rx="9"
          fill="${C.accent}" fill-opacity="0.24" stroke="${C.stroke}" stroke-opacity="0.85"/>
    <text x="${flagX + innerW - 57}" y="${flagY + 30.6}" font-size="9.5" font-weight="700"
          fill="${C.bright}" font-family="${FONT}" text-anchor="middle"
          letter-spacing="0.9">FLAGSHIP</text>
    <text x="${flagX + 24}" y="${flagY + 55}" font-size="11.5" fill="#93AEC6"
          font-family="${FONT}">${esc(truncate(FLAG.description, 76))}</text>
    ${pills}
    <circle cx="${flagX + innerW - 24}" cy="${flagY + 79}" r="4.5" fill="${flagDot}"/>
    <circle cx="${flagX + innerW - 24}" cy="${flagY + 79}" r="4.5" fill="none" stroke="${flagDot}"
            opacity="0.45">
      <animate attributeName="r" values="4.5;12" dur="3.2s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.6;0" dur="3.2s" repeatCount="indefinite"/>
    </circle>
    <text x="${flagX + innerW - 36}" y="${flagY + 82.5}" font-size="10.5" font-weight="600"
          fill="${C.text}" font-family="${FONT}" text-anchor="end">${esc(FLAG.language)}</text>
  </g>`;

/* ── small cards + the "all repos" cell ─────────────────────────── */
const cells = OTHERS.map((f) => ({ kind: 'repo', f }));
cells.push({ kind: 'cta' });

let cards = '';
cells.forEach((cell, i) => {
  const col = i % 2, row = Math.floor(i / 2);
  const x = PAD + col * (pColW + GAP);
  const y = gridTop + row * (SM_H + GAP);
  const delay = 0.18 + i * 0.07;

  if (cell.kind === 'cta') {
    cards += `
  <g>
    <rect x="${x}" y="${y}" width="${pColW}" height="${SM_H}" rx="11"
          fill="none" stroke="${C.stroke}" stroke-opacity="0.7" stroke-dasharray="5 5"/>
    <text x="${x + pColW / 2}" y="${y + 38}" font-size="13" font-weight="700" fill="${C.title}"
          font-family="${FONT}" text-anchor="middle">All repositories</text>
    <g class="pj-arrow">
      <text x="${x + pColW / 2}" y="${y + 62}" font-size="11.5" fill="${C.label}"
            font-family="${FONT}" text-anchor="middle">see everything I'm building  →</text>
    </g>
  </g>`;
    return;
  }

  const { f } = cell;
  const r = byName.get(f.name); // undefined when the repo is private
  const lang = f.language ?? r?.primaryLanguage?.name ?? '—';
  const dot = f.color ?? r?.primaryLanguage?.color ?? C.accent;
  const stats = [
    r?.stargazerCount > 0 ? `★ ${nf.format(r.stargazerCount)}` : null,
    r?.forkCount > 0 ? `${nf.format(r.forkCount)} forks` : null,
  ].filter(Boolean);
  const meta = stats.length
    ? `
    <text x="${x + pColW - 16}" y="${y + 28}" font-size="11" font-weight="600" fill="${C.bright}"
          font-family="${FONT}" text-anchor="end">${esc(stats.join('  ·  '))}</text>`
    : r?.pushedAt
      ? `
    <text x="${x + pColW - 16}" y="${y + 74.5}" font-size="10.5" fill="${C.label}"
          font-family="${FONT}" text-anchor="end">${esc(relTime(r.pushedAt))}</text>`
      : '';

  cards += `
  <g>
    <rect x="${x}" y="${y}" width="${pColW}" height="${SM_H}" rx="11"
          fill="url(#pjCard)" stroke="${C.grid}" stroke-opacity="0.95"/>
    <rect x="${x}" y="${y}" width="3" height="${SM_H}" rx="1.5" fill="${C.accent}"/>
    <rect x="${x + 12}" y="${y + 1}" width="${pColW - 24}" height="1"
          fill="${C.bright}" opacity="0.16"/>
    <text x="${x + 18}" y="${y + 28}" font-size="14" font-weight="700" fill="${C.title}"
          font-family="${FONT}">${esc(f.name)}</text>
    ${meta}
    <text x="${x + 18}" y="${y + 50}" font-size="10.5" fill="${C.label}"
          font-family="${FONT}">${esc(truncate(f.description ?? r?.description, 56))}</text>
    <circle cx="${x + 23}" cy="${y + 71}" r="4.5" fill="${dot}"/>
    <circle cx="${x + 23}" cy="${y + 71}" r="4.5" fill="none" stroke="${dot}" opacity="0.45">
      <animate attributeName="r" values="4.5;11" dur="3s"
        begin="${(delay + 0.4).toFixed(2)}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.55;0" dur="3s"
        begin="${(delay + 0.4).toFixed(2)}s" repeatCount="indefinite"/>
    </circle>
    <text x="${x + 34}" y="${y + 74.5}" font-size="10.5" font-weight="600" fill="${C.text}"
          font-family="${FONT}">${esc(lang)}</text>
  </g>`;
});

const projectsSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PROJ_W}" height="${PROJ_H}"
     viewBox="0 0 ${PROJ_W} ${PROJ_H}" role="img" aria-label="Featured projects by ${esc(LOGIN)}">
  <title>Featured projects by ${esc(LOGIN)}</title>
  <defs>${PROJ_DEFS}</defs>
  ${panel(PROJ_W, PROJ_H)}
  ${heading(PROJ_W, 'Featured Projects')}
  ${flagSvg}
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
      name: profile.name,
      totalContributionsAllTime: totalAllTime,
      perYear,
      year: YEAR,
      contributionsThisYear: cc.contributionCalendar.totalContributions,
      commitsThisYear: cc.totalCommitContributions + cc.restrictedContributionsCount,
      pullRequests: cc.totalPullRequestContributions,
      issues: cc.totalIssueContributions,
      reviews: cc.totalPullRequestReviewContributions,
      publicRepos: repos.length,
      stars,
      followers: profile.followers,
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
