/**
 * Screenshots the preview HTML with the Playwright chromium already on disk.
 * Usage: node shoot.mjs <url> <out.png> [width]
 */
import { chromium } from '/Users/heinsithukyaw/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const [url, out, w = '1000'] = process.argv.slice(2);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: Number(w), height: 1200 },
  deviceScaleFactor: 2,
});
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3500);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('shot ->', out);
