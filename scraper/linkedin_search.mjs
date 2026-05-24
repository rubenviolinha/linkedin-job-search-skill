import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

const sessionFile = path.join(os.homedir(), '.claude', 'linkedin-session.json');
const readySignal = '/tmp/linkedin-ready';
const hasSession = fs.existsSync(sessionFile);

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

const keywords = getArg('--keywords');
const location = getArg('--location');
const maxPages = parseInt(getArg('--max-pages') || '3', 10);

if (!keywords) {
  console.error('Usage: node linkedin_search.mjs --keywords "..." [--location "..."] [--max-pages N]');
  process.exit(1);
}

if (fs.existsSync(readySignal)) fs.unlinkSync(readySignal);

const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });

const context = hasSession
  ? await browser.newContext({ storageState: sessionFile, viewport: { width: 1280, height: 900 } })
  : await browser.newContext({ viewport: { width: 1280, height: 900 } });

const page = await context.newPage();

if (!hasSession) {
  console.log('No saved session — opening LinkedIn login...');
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });
  console.log('\n⚠️  Log into LinkedIn in the browser, then run: touch /tmp/linkedin-ready\n');
  while (!fs.existsSync(readySignal)) await new Promise(r => setTimeout(r, 1000));
  fs.unlinkSync(readySignal);
  await context.storageState({ path: sessionFile });
  console.log('Session saved — future runs won\'t need login.\n');
}

const searchUrl = `https://www.linkedin.com/jobs/search-results/?keywords=${encodeURIComponent(keywords)}`;
console.log(`Navigating to: ${searchUrl}`);
await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

if (page.url().includes('/login') || page.url().includes('/authwall')) {
  console.log('Session expired — delete ~/.claude/linkedin-session.json and re-run.');
  await browser.close();
  process.exit(1);
}

// Apply location filter via UI
if (location) {
  console.log(`Setting location filter: ${location}`);

  // Wait for the location marker icon to confirm page has loaded
  await page.locator('svg#location-marker-small').first()
    .waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});

  // Click the location filter button (parent of the location-marker SVG)
  await page.evaluate(() => {
    const svg = document.querySelector('svg#location-marker-small');
    if (!svg) return;
    const btn = svg.closest('[role="button"]') || svg.parentElement;
    btn?.click();
  });

  // Wait for the location popover input
  const locationInput = page.locator('[aria-label="Location"]').first();
  await locationInput.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

  // Clear any pre-filled location
  const clearBtn = page.locator('[aria-label="Clear location"]');
  if (await clearBtn.count() > 0) {
    await clearBtn.click();
    await page.waitForTimeout(300);
  }

  // Type the desired location
  await locationInput.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(location);

  // Wait for autocomplete and click first geo suggestion
  const firstSuggestion = page.locator('a[href*="geoId="]').first();
  const appeared = await firstSuggestion.waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true).catch(() => false);

  if (appeared) {
    await firstSuggestion.click();
    await page.waitForSelector('a[href*="/jobs/view/"]', { timeout: 15000, state: 'attached' }).catch(() => {});
    console.log('Location filter applied.');
  } else {
    console.log('Location autocomplete did not appear — proceeding without location filter.');
  }
}

// Confirm jobs are present
const hasJobs = await page.waitForSelector('a[href*="/jobs/view/"]', {
  timeout: 10000, state: 'attached',
}).then(() => true).catch(() => false);

if (!hasJobs) {
  console.log('No jobs found.');
  console.log('\n=== SEARCH RESULTS ===');
  console.log(JSON.stringify([]));
  await browser.close();
  process.exit(0);
}

function extractSearchJobs() {
  return page.evaluate(() => {
    const seen = new Set();
    const results = [];
    document.querySelectorAll('a[href*="/jobs/view/"]').forEach(a => {
      const url = a.href.split('?')[0];
      if (seen.has(url)) return;
      seen.add(url);

      let container = a;
      for (let i = 0; i < 8; i++) {
        container = container.parentElement;
        if (!container) break;
        if (container.querySelectorAll('p').length >= 2) break;
      }

      const allP = container
        ? Array.from(container.querySelectorAll('p')).map(p => p.innerText?.trim()).filter(Boolean)
        : [];

      const title    = allP[0] || a.innerText?.trim() || '';
      const company  = allP[1] || '';
      const location = allP[2] || '';
      const posted   = allP[3] || '';
      const easyApply = container ? !!container.querySelector('svg#linkedin-bug-small') : false;

      if (title && url) results.push({ title, company, location, url, easyApply, posted });
    });
    return results;
  });
}

const allJobs = [];
let pageNum = 1;

while (pageNum <= maxPages) {
  console.log(`Scraping page ${pageNum}...`);
  await page.waitForTimeout(1000);

  const jobs = await extractSearchJobs();
  console.log(`  ${jobs.length} jobs found`);
  allJobs.push(...jobs);

  const nextBtn = page.locator('[data-testid="pagination-controls-next-button-visible"]');
  if ((await nextBtn.count()) === 0 || pageNum >= maxPages) break;

  await nextBtn.click();
  await page.waitForSelector('a[href*="/jobs/view/"]', { timeout: 10000, state: 'attached' }).catch(() => {});
  pageNum++;
}

// Deduplicate across pages
const deduped = Array.from(new Map(allJobs.map(j => [j.url, j])).values());

console.log(`\nTotal unique jobs scraped: ${deduped.length}`);
console.log('\n=== SEARCH RESULTS ===');
console.log(JSON.stringify(deduped, null, 2));

await context.storageState({ path: sessionFile });
await browser.close();
