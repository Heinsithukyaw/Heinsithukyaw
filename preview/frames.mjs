/**
 * Captures the banner at several points in time and writes a contact sheet,
 * so we can prove the animation is actually running (and not just a static frame).
 * Usage: node frames.mjs
 */
import { chromium } from '/Users/heinsithukyaw/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.mjs';
import { writeFileSync } from 'node:fs';

const SVG = '/Users/heinsithukyaw/Developer/Heinsithukyaw/assets/banner.svg';
const TIMES = [200, 1200, 2600, 4200, 6000, 7800]; // ms

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1240, height: 460 },
  deviceScaleFactor: 1,
});

const shots = [];
let elapsed = 0;
for (const t of TIMES) {
  await page.goto(`file://${SVG}`, { waitUntil: 'load' });
  await page.waitForTimeout(t);
  const buf = await page.screenshot({ clip: { x: 0, y: 0, width: 1200, height: 420 } });
  shots.push({ t, b64: buf.toString('base64') });
  elapsed = t;
}

// contact sheet: one column, labelled
const rows = shots
  .map(
    (s, i) => `
  <div class="row">
    <div class="lbl">t = ${(s.t / 1000).toFixed(1)}s</div>
    <img src="data:image/png;base64,${s.b64}">
  </div>`
  )
  .join('');

const sheet = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#05080d;font:12px -apple-system,sans-serif;color:#5aa8dd}
  .row{padding:10px 14px}
  .lbl{font-size:11px;letter-spacing:1px;margin-bottom:6px}
  img{width:900px;display:block;border-radius:6px}
</style></head><body>${rows}</body></html>`;

writeFileSync('/tmp/frames.html', sheet);
console.log('frames written, last t =', elapsed);
await browser.close();
