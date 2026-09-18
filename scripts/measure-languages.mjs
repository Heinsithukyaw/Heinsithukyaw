/**
 * Measures the language distribution across the user's OWN projects on disk
 * (excluding vendored/generated trees) and writes scripts/languages.json.
 *
 * Why: the public /users/:login/repos endpoint cannot see private repos, so an
 * API-derived language card reflects fork code rather than the user's own work.
 * This snapshot is committed and read by generate-assets.mjs.
 *
 *   node scripts/measure-languages.mjs
 */
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { homedir } from 'node:os';

const DEV = join(homedir(), 'Developer');

// Directories that are dependencies, build output, caches or VCS metadata.
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.output',
  'venv', '.venv', 'env', '__pycache__', 'vendor', 'coverage', '.ruff_cache',
  '.mypy_cache', '.pytest_cache', 'site-packages', '.pnpm-store', '.turbo',
  'graphify-out', '.cache', 'target', '.gradle', 'Pods', '.terraform',
  'htmlcov', '.tox', 'eggs', '.eggs', '.idea', '.vscode', 'backups',
]);

// Only these projects count as "my own work". Forks and scratch folders are out.
const PROJECTS = [
  'Ominibridge', 'Callme-ai', 'DailyNews', 'Veridra', 'Guru',
  'Organizational Agent OS', 'Private Investment Gateway Project',
  'REVO CORE', 'ReVoLab-AGI', 'A-Book', 'EzRecovery',
];

const LANG_BY_EXT = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.py': 'Python', '.pyi': 'Python',
  '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.kt': 'Kotlin',
  '.rb': 'Ruby', '.php': 'PHP', '.cs': 'C#', '.swift': 'Swift',
  '.c': 'C', '.h': 'C', '.cc': 'C++', '.cpp': 'C++', '.hpp': 'C++',
  '.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell',
  '.sql': 'SQL', '.html': 'HTML', '.htm': 'HTML',
  '.css': 'CSS', '.scss': 'SCSS', '.sass': 'SCSS', '.less': 'Less',
  '.vue': 'Vue', '.svelte': 'Svelte',
  '.md': 'Markdown', '.mdx': 'Markdown',
  '.yml': 'YAML', '.yaml': 'YAML', '.json': 'JSON', '.toml': 'TOML',
};

const bytes = {};
const files = {};
const perProject = {};

function walk(dir, proj) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      walk(full, proj);
    } else if (e.isFile()) {
      const lang = LANG_BY_EXT[extname(e.name).toLowerCase()];
      if (!lang) continue;
      let size = 0;
      try { size = statSync(full).size; } catch { continue; }
      bytes[lang] = (bytes[lang] ?? 0) + size;
      files[lang] = (files[lang] ?? 0) + 1;
      perProject[proj] ??= {};
      perProject[proj][lang] = (perProject[proj][lang] ?? 0) + size;
    }
  }
}

for (const p of PROJECTS) walk(join(DEV, p), p);

const total = Object.values(bytes).reduce((a, b) => a + b, 0);
const languages = Object.entries(bytes)
  .map(([name, size]) => ({
    name,
    size,
    files: files[name],
    pct: +((size / total) * 100).toFixed(1),
  }))
  .sort((a, b) => b.size - a.size);

const out = {
  generatedAt: new Date().toISOString().slice(0, 10),
  source: 'local working copies (private repos are invisible to the public API)',
  projectsScanned: PROJECTS.length,
  totalBytes: total,
  languages,
  perProject,
};

writeFileSync(join(import.meta.dirname, 'languages.json'), JSON.stringify(out, null, 2) + '\n');

console.log(`scanned ${PROJECTS.length} projects · ${(total / 1e6).toFixed(1)} MB of source`);
for (const l of languages.slice(0, 8)) {
  console.log(`  ${l.name.padEnd(12)} ${String(l.pct).padStart(5)}%  ${String(l.files).padStart(6)} files`);
}
