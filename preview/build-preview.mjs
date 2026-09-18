/**
 * Renders README.md through GitHub's own markdown API (so what we screenshot is
 * what GitHub will actually show), wraps it in a GitHub-dark shell, screenshots it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT = '/Users/heinsithukyaw/Developer/Heinsithukyaw';
const md = readFileSync(`${ROOT}/README.md`, 'utf8');

// GitHub's real GFM renderer
const rendered = execFileSync(
  'gh',
  ['api', '-X', 'POST', '/markdown', '-f', 'mode=gfm', '-f', 'context=Heinsithukyaw/Heinsithukyaw', '-f', `text=${md}`],
  { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
);

// GitHub rewrites ./assets/... to raw.githubusercontent.com. Locally the preview
// lives in preview/, so rewrite those relative paths to point one level up.
const localised = rendered
  .replace(/src="\.\/assets\//g, 'src="../assets/')
  .replace(/src='\.\/assets\//g, "src='../assets/");

const html = `<!DOCTYPE html>
<html lang="en" data-color-mode="dark" data-dark-theme="dark">
<head>
<meta charset="utf-8">
<style>
  :root{
    --bg:#0d1117; --fg:#c3d6e8; --border:#1d4f7d; --link:#5aa8dd;
  }
  *{box-sizing:border-box}
  body{
    margin:0; background:var(--bg); color:var(--fg);
    font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Noto Sans,Helvetica,Arial,sans-serif;
  }
  .page{max-width:1012px; margin:0 auto; padding:24px;}
  .card{background:#0d1117; border:1px solid #21262d; border-radius:6px; padding:32px 40px;}
  .markdown-body h3{
    font-size:1.25em; font-weight:600; color:#e6edf3;
    margin:28px 0 12px; border:0; padding:0;
  }
  .markdown-body p{margin:0 0 16px}
  .markdown-body img{max-width:100%; vertical-align:middle}
  .markdown-body a{color:var(--link); text-decoration:none}
  .markdown-body table{border-collapse:collapse; border:0}
  .markdown-body td{border:0; padding:0 12px; vertical-align:middle}
  .markdown-body strong{color:#e6edf3}
  .markdown-body sub{font-size:.75em; color:#7a93ab}
  .markdown-body code{
    background:#161b22; padding:.2em .4em; border-radius:6px; font-size:85%;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  }
  .markdown-body div[align="center"]{text-align:center}
  .markdown-body p[align="center"]{text-align:center}
  .markdown-body div[align="center"] > p{margin:10px 0}
  .markdown-body div[align="center"] img[src*="shields.io"]{margin:3px 2px}
  hr{display:none}
</style>
</head>
<body>
  <div class="page">
    <div class="card markdown-body">${localised}</div>
  </div>
</body>
</html>`;

writeFileSync(`${ROOT}/preview/readme-preview.html`, html, 'utf8');
console.log('wrote preview/readme-preview.html', html.length, 'chars');
