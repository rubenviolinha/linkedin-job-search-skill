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
const maxPages = parseInt(getArg('--max-pages') || '5', 10);
const maxJobs = parseInt(getArg('--max-jobs') || '999', 10);
const saveUrlsArg = getArg('--save-urls');
const saveUrls = saveUrlsArg
  ? saveUrlsArg.split(',').map(u => u.trim().split('?')[0].replace(/\/+$/, ''))
  : null;
const isSaveMode = !!saveUrls;

if (!keywords) {
  console.error('Usage: node linkedin_search.mjs --keywords "..." [--location "..."] [--max-jobs N] [--max-pages N]');
  console.error('       node linkedin_search.mjs --keywords "..." [--location "..."] --save-urls "url1,url2"');
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

  await page.locator('svg#location-marker-small').first()
    .waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});

  await page.evaluate(() => {
    const svg = document.querySelector('svg#location-marker-small');
    if (!svg) return;
    const btn = svg.closest('[role="button"]') || svg.parentElement;
    btn?.click();
  });

  const locationInput = page.locator('[aria-label="Location"]').first();
  await locationInput.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

  const clearBtn = page.locator('[aria-label="Clear location"]');
  if (await clearBtn.count() > 0) {
    await clearBtn.click();
    await page.waitForTimeout(300);
  }

  await locationInput.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(location);

  const firstSuggestion = page.locator('a[href*="geoId="]').first();
  const appeared = await firstSuggestion.waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true).catch(() => false);

  if (appeared) {
    await firstSuggestion.click();
    await page.waitForSelector('div.ba4d4009', { timeout: 15000, state: 'attached' }).catch(() => {});
    console.log('Location filter applied.');
  } else {
    console.log('Location autocomplete did not appear — proceeding without location filter.');
  }
}

// Confirm job cards are present
const hasJobs = await page.waitForSelector('div.ba4d4009', {
  timeout: 10000, state: 'attached',
}).then(() => true).catch(() => false);

if (!hasJobs) {
  console.log('No jobs found.');
  console.log('\n=== SEARCH RESULTS ===');
  console.log(JSON.stringify([]));
  await browser.close();
  process.exit(0);
}

const baseSearchUrl = page.url().split('&start=')[0].split('?start=')[0];
console.log(`Base search URL: ${baseSearchUrl}`);

// ── Helpers ───────────────────────────────────────────────────────────────────

// Click a card and wait for currentJobId in URL to change to a new value.
// Returns the new job URL, or null on timeout.
async function clickCardAndGetUrl(card) {
  const prevJobId = new URL(page.url()).searchParams.get('currentJobId') || '';
  await card.click();
  await page.waitForFunction(
    (prev) => {
      const id = new URL(window.location.href).searchParams.get('currentJobId');
      return id && id !== prev;
    },
    prevJobId,
    { timeout: 6000 }
  ).catch(() => {});
  const jobIdMatch = page.url().match(/currentJobId=(\d+)/);
  return jobIdMatch ? `https://www.linkedin.com/jobs/view/${jobIdMatch[1]}/` : null;
}

// Wait for the right panel to finish loading.
async function waitForRightPanel() {
  // Either button (Save or Unsave) confirms panel chrome is rendered
  await page.waitForSelector('button[aria-label="Save the job"], button[aria-label="Unsave the job"]', {
    state: 'visible', timeout: 8000,
  }).catch(() => {});
  // Expandable-text-button is injected only after the description body loads
  await page.waitForSelector('[data-testid="expandable-text-button"]', {
    state: 'attached', timeout: 6000,
  }).catch(() => {});
}

// Extract the job description text from the right panel.
// Walks up from the expandable-text-button to find the containing description block.
async function extractDescription() {
  return page.evaluate(() => {
    const btn = document.querySelector('[data-testid="expandable-text-button"]');
    if (btn) {
      let el = btn.parentElement;
      while (el && el !== document.body) {
        const text = el.innerText?.trim();
        // The description container has substantial text but is NOT the whole page
        // (exclude anything that contains the left-panel job cards)
        if (text && text.length > 200 && text.length < 10000) {
          if (!el.querySelector('div.ba4d4009')) {
            return text.slice(0, 3000);
          }
        }
        el = el.parentElement;
      }
    }
    return '';
  });
}

// Navigate to a specific search page by offset.
async function goToPage(pageNum) {
  if (pageNum === 1) return;
  const start = (pageNum - 1) * 25;
  await page.goto(`${baseSearchUrl}&start=${start}`, {
    waitUntil: 'domcontentloaded', timeout: 15000,
  }).catch(() => {});
  await page.waitForSelector('div.ba4d4009', { timeout: 10000, state: 'attached' }).catch(() => {});
  await page.waitForTimeout(1000);
}

// ── Scrape mode ───────────────────────────────────────────────────────────────

async function scrapeCurrentPage(limit = 999) {
  await page.waitForTimeout(1500);
  const cardCount = Math.min(await page.locator('div.ba4d4009').count(), limit);
  console.log(`  Found ${cardCount} cards`);
  const jobs = [];

  for (let i = 0; i < cardCount; i++) {
    const card = page.locator('div.ba4d4009').nth(i);

    // Extract static card data from left panel HTML
    const cardData = await card.evaluate(el => {
      const titleEl = el.querySelector('p[class*="c4b61232"] span[aria-hidden="true"]')
                   || el.querySelector('p[class*="c4b61232"]');
      const companyEl = el.querySelector('p[class*="_210f0453"]');
      const locationEl = el.querySelector('p[class*="_50917d1d"][class*="ba6a2084"]');
      const easyApply = !!el.querySelector('svg#linkedin-bug-small');
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

    // Also check for direct anchor link
    const anchorUrl = await card.evaluate(el => {
      const a = el.querySelector('a[href*="/jobs/view/"]');
      return a ? a.href.split('?')[0].replace(/\/apply\/?$/, '') : null;
    });

    // Click card, wait for URL to change, read right panel
    let jobUrl = anchorUrl;
    let description = '';
    try {
      const clickedUrl = await clickCardAndGetUrl(card);
      if (clickedUrl) jobUrl = clickedUrl;
      await waitForRightPanel();
      description = await extractDescription();
    } catch (err) {
      if (err.message?.includes('closed')) throw err; // propagate browser-closed upward
    }

    if (jobUrl && cardData.title) {
      jobs.push({ ...cardData, url: jobUrl, description });
      console.log(`    [${i + 1}/${cardCount}] ${cardData.title} @ ${cardData.company}`);
    }

    // Random jitter to avoid anti-bot detection (800ms–2000ms)
    await page.waitForTimeout(800 + Math.floor(Math.random() * 1200));
    // Longer pause every 5 cards
    if ((i + 1) % 5 === 0) await page.waitForTimeout(2000);
  }

  return jobs;
}

// ── Save mode ─────────────────────────────────────────────────────────────────

async function saveMatchingJobs() {
  const remaining = new Set(saveUrls);
  let saved = 0;
  let pageNum = 1;

  console.log(`\nLooking to save ${remaining.size} job(s) across up to ${maxPages} pages...`);

  while (remaining.size > 0 && pageNum <= maxPages) {
    console.log(`\nPage ${pageNum}...`);
    await goToPage(pageNum);
    await page.waitForTimeout(1500);

    const cardCount = await page.locator('div.ba4d4009').count();
    console.log(`  ${cardCount} cards`);

    for (let i = 0; i < cardCount && remaining.size > 0; i++) {
      const card = page.locator('div.ba4d4009').nth(i);
      let jobUrl = null;
      try {
        jobUrl = await clickCardAndGetUrl(card);
      } catch (_) { continue; }

      if (!jobUrl) continue;

      const normalised = jobUrl.split('?')[0].replace(/\/+$/, '');
      if (!remaining.has(normalised)) continue;

      // This is a target — wait for right panel then click Save
      await waitForRightPanel();

      // Check if already saved — don't unsave it
      const alreadySaved = await page.locator('button[aria-label="Unsave the job"]').count() > 0;
      if (alreadySaved) {
        remaining.delete(normalised);
        saved++;
        console.log(`  ✅ Already saved (${saved}): ${normalised}`);
        continue;
      }

      const saveBtn = page.locator('button[aria-label="Save the job"]');
      if (await saveBtn.count() > 0) {
        await saveBtn.click();
        await page.waitForTimeout(800);
        remaining.delete(normalised);
        saved++;
        console.log(`  ✅ Saved (${saved}): ${normalised}`);
      } else {
        console.log(`  ⚠️  Save button not found for: ${normalised}`);
      }
    }

    pageNum++;
  }

  if (remaining.size > 0) {
    console.log(`\n⚠️  Could not find ${remaining.size} job(s) on the search results pages:`);
    remaining.forEach(u => console.log(`  - ${u}`));
  }

  console.log(`\n=== SAVE RESULTS ===`);
  console.log(JSON.stringify({ saved, notFound: [...remaining] }, null, 2));
}

// ── Entry point ───────────────────────────────────────────────────────────────

if (isSaveMode) {
  await saveMatchingJobs();
} else {
  const allJobs = [];
  let pageNum = 1;

  try {
    while (pageNum <= maxPages && allJobs.length < maxJobs) {
      console.log(`\nScraping page ${pageNum}...`);
      await goToPage(pageNum);
      const jobs = await scrapeCurrentPage(maxJobs - allJobs.length);
      console.log(`  ${jobs.length} jobs extracted`);
      allJobs.push(...jobs);
      if (pageNum >= maxPages || allJobs.length >= maxJobs) break;
      pageNum++;
    }
  } catch (err) {
    console.log(`Scraping stopped at page ${pageNum}: ${err.message}`);
  }

  const deduped = Array.from(new Map(allJobs.map(j => [j.url, j])).values());
  console.log(`\nTotal unique jobs scraped: ${deduped.length}`);
  console.log('\n=== SEARCH RESULTS ===');
  console.log(JSON.stringify(deduped, null, 2));
}

await context.storageState({ path: sessionFile }).catch(() => {});
await browser.close().catch(() => {});
