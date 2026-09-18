/**
 * Screenshots a single file (svg/html/png) or a CSS selector inside the preview.
 * Usage: node shot-el.mjs <fileUrlOrUrl> <out.png> <w> [selector]
 */
import { chromium } from '/Users/heinsithukyaw/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const [url, out, w = '1000', selector] = process.argv.slice(2);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: Number(w), height: 800 },
  deviceScaleFactor: 2,
});
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3000);

if (selector) {
  const el = await page.$(selector);
  if (!el) throw new Error(`selector not found: ${selector}`);
  await el.screenshot({ path: out });
} else {
  await page.screenshot({ path: out, fullPage: true });
}
await browser.close();
console.log('shot ->', out);
