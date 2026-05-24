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

// Capture base URL (includes geoId after location filter) for URL-based pagination
const baseSearchUrl = page.url().split('&start=')[0].split('?start=')[0];
console.log(`Base search URL: ${baseSearchUrl}`);

async function scrapeCurrentPage() {
  await page.waitForTimeout(2000);

  const cardCount = await page.locator('div.ba4d4009').count();
  console.log(`  Found ${cardCount} cards`);
  const jobs = [];

  for (let i = 0; i < cardCount; i++) {
    const card = page.locator('div.ba4d4009').nth(i);

    // Extract static text from card HTML using stable class-based selectors
    const cardData = await card.evaluate(el => {
      // Title: p with c4b61232 class — prefer aria-hidden span for clean text
      const titleEl = el.querySelector('p[class*="c4b61232"] span[aria-hidden="true"]')
                   || el.querySelector('p[class*="c4b61232"]');
      // Company: p with _210f0453 class
      const companyEl = el.querySelector('p[class*="_210f0453"]');
      // Location: p that has both _50917d1d and ba6a2084 (not the company p)
      const locationEl = el.querySelector('p[class*="_50917d1d"][class*="ba6a2084"]');
      const easyApply = !!el.querySelector('svg#linkedin-bug-small');
      // Posted: span[aria-hidden="true"] in the bottom metadata section
      const postedSpans = Array.from(el.querySelectorAll('span[aria-hidden="true"]'));
      const postedSpan = postedSpans.find(s => /\d+\s+(day|week|month|hour)/i.test(s.innerText));

      return {
        title: titleEl?.innerText?.trim() || '',
        company: companyEl?.innerText?.trim() || '',
        location: locationEl?.innerText?.trim() || '',
        easyApply,
        posted: postedSpan?.innerText?.trim() || '',
      };
    });

    if (!cardData.title) continue;

    // Check if card already has an anchor href (some cards do)
    const anchorUrl = await card.evaluate(el => {
      const a = el.querySelector('a[href*="/jobs/view/"]');
      return a ? a.href.split('?')[0].replace(/\/apply\/?$/, '') : null;
    });

    let jobUrl = anchorUrl;

    // If no anchor, click card and wait for currentJobId in URL to change
    if (!jobUrl) {
      try {
        const prevJobId = new URL(page.url()).searchParams.get('currentJobId') || '';
        await card.click();
        // Wait until the URL reflects a *new* job ID (not just any)
        await page.waitForFunction(
          (prev) => {
            const id = new URL(window.location.href).searchParams.get('currentJobId');
            return id && id !== prev;
          },
          prevJobId,
          { timeout: 6000 }
        ).catch(() => {});
        // Small settle delay so the right panel has started loading
        await page.waitForTimeout(600);
        const currentUrl = page.url();
        const jobIdMatch = currentUrl.match(/currentJobId=(\d+)/);
        if (jobIdMatch) jobUrl = `https://www.linkedin.com/jobs/view/${jobIdMatch[1]}/`;
      } catch (_) { /* card may have been removed or navigated away */ }
    }

    if (jobUrl && cardData.title) {
      jobs.push({ ...cardData, url: jobUrl });
    }
  }

  return jobs;
}

const allJobs = [];
let pageNum = 1;

try {
  while (pageNum <= maxPages) {
    console.log(`\nScraping page ${pageNum}...`);
    // Paginate via URL (avoids triggering anti-bot from button clicks)
    if (pageNum > 1) {
      const start = (pageNum - 1) * 25;
      await page.goto(`${baseSearchUrl}&start=${start}`, {
        waitUntil: 'domcontentloaded', timeout: 15000,
      }).catch(() => {});
      await page.waitForSelector('div.ba4d4009', { timeout: 10000, state: 'attached' }).catch(() => {});
    }

    const jobs = await scrapeCurrentPage();
    console.log(`  ${jobs.length} jobs extracted`);
    allJobs.push(...jobs);

    if (pageNum >= maxPages) break;
    pageNum++;
  }
} catch (err) {
  console.log(`Scraping stopped at page ${pageNum}: ${err.message}`);
}

// Deduplicate across pages
const deduped = Array.from(new Map(allJobs.map(j => [j.url, j])).values());

console.log(`\nTotal unique jobs scraped: ${deduped.length}`);
console.log('\n=== SEARCH RESULTS ===');
console.log(JSON.stringify(deduped, null, 2));

await context.storageState({ path: sessionFile }).catch(() => {});
await browser.close().catch(() => {});
