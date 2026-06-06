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
const saveIds = saveUrlsArg
  ? saveUrlsArg.split(',').map(u => (u.match(/jobs\/view\/(\d+)/) || [])[1]).filter(Boolean)
  : null;
const isSaveMode = !!saveIds;

if (!keywords) {
  console.error('Usage: node linkedin_search.mjs --keywords "..." [--location "..."] [--max-jobs N] [--max-pages N]');
  console.error('       node linkedin_search.mjs --keywords "..." [--location "..."] --save-urls "url1,url2"');
  process.exit(1);
}

if (fs.existsSync(readySignal)) fs.unlinkSync(readySignal);

const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
const context = hasSession
  ? await browser.newContext({ storageState: sessionFile, viewport: { width: 1320, height: 950 } })
  : await browser.newContext({ viewport: { width: 1320, height: 950 } });
const page = await context.newPage();

// First-time login flow
if (!hasSession) {
  console.log('No saved session — opening LinkedIn login...');
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });
  console.log('\n⚠️  Log into LinkedIn in the browser, then run: touch /tmp/linkedin-ready\n');
  while (!fs.existsSync(readySignal)) await new Promise(r => setTimeout(r, 1000));
  fs.unlinkSync(readySignal);
  await context.storageState({ path: sessionFile });
  console.log('Session saved — future runs won\'t need login.\n');
}

// Use the classic authenticated jobs search; keywords + location go straight in the URL.
const baseSearchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keywords)}` +
  (location ? `&location=${encodeURIComponent(location)}` : '');

async function gotoPage(pageNum) {
  const url = pageNum === 1 ? baseSearchUrl : `${baseSearchUrl}&start=${(pageNum - 1) * 25}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  if (page.url().includes('/login') || page.url().includes('/authwall')) {
    console.log('Session expired — delete ~/.claude/linkedin-session.json and re-run.');
    await browser.close();
    process.exit(1);
  }
  return page.waitForSelector('li[data-occludable-job-id]', { timeout: 12000 })
    .then(() => true).catch(() => false);
}

// LinkedIn lazy-renders cards; scroll each list item into view to force render.
async function loadAllCards() {
  const lis = page.locator('li[data-occludable-job-id]');
  const total = await lis.count();
  for (let i = 0; i < total; i++) {
    await lis.nth(i).scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(600);
  return page.locator('li[data-occludable-job-id]').evaluateAll(
    els => els.map(e => e.getAttribute('data-occludable-job-id')).filter(Boolean)
  );
}

const cardSelForId = (id) => `li[data-occludable-job-id="${id}"]`;

async function readCardMeta(li) {
  return li.evaluate(el => {
    const txt = (sel) => el.querySelector(sel)?.innerText?.trim().split('\n')[0] || '';
    const title = txt('.artdeco-entity-lockup__title a') || txt('.job-card-list__title--link') ||
                  txt('.artdeco-entity-lockup__title') || txt('a.job-card-container__link');
    const company = txt('.artdeco-entity-lockup__subtitle');
    const loc = txt('.artdeco-entity-lockup__caption') || txt('.job-card-container__metadata-wrapper');
    const footer = el.innerText || '';
    const easyApply = /Easy Apply/i.test(footer);
    const posted = el.querySelector('time')?.innerText?.trim() ||
      (footer.match(/(\d+\s+(?:second|minute|hour|day|week|month)s?\s+ago)/i)?.[1] || '');
    return { title, company, location: loc, easyApply, posted };
  });
}

async function extractDescription() {
  await page.waitForSelector('#job-details, .jobs-description__content, .jobs-box__html-content', {
    timeout: 8000,
  }).catch(() => {});
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const el = document.querySelector('#job-details') ||
               document.querySelector('.jobs-description-content__text') ||
               document.querySelector('.jobs-description__content') ||
               document.querySelector('.jobs-box__html-content');
    return el ? el.innerText.trim().slice(0, 3000) : '';
  });
}

function currentJobUrl() {
  const m = page.url().match(/currentJobId=(\d+)/);
  return m ? `https://www.linkedin.com/jobs/view/${m[1]}/` : null;
}

// ── SCRAPE MODE ──────────────────────────────────────────────────────────────
async function scrape() {
  const allJobs = [];
  for (let pageNum = 1; pageNum <= maxPages && allJobs.length < maxJobs; pageNum++) {
    console.log(`\nScraping page ${pageNum}...`);
    const ok = await gotoPage(pageNum);
    if (!ok) { console.log('  No cards on this page — stopping.'); break; }
    const ids = await loadAllCards();
    console.log(`  ${ids.length} cards found.`);

    for (const id of ids) {
      if (allJobs.length >= maxJobs) break;
      const li = page.locator(cardSelForId(id)).first();
      try {
        await li.scrollIntoViewIfNeeded().catch(() => {});
        const meta = await readCardMeta(li);
        const link = li.locator('a.job-card-container__link, a.job-card-list__title--link, a[href*="/jobs/view/"]').first();
        await link.click({ timeout: 5000 });
        await page.waitForTimeout(700);
        const description = await extractDescription();
        const url = currentJobUrl() || `https://www.linkedin.com/jobs/view/${id}/`;
        if (meta.title) {
          allJobs.push({ ...meta, url, description });
          console.log(`    [${allJobs.length}] ${meta.title} @ ${meta.company} — ${description.length} chars`);
        }
      } catch (err) {
        if (err.message?.includes('closed')) throw err;
        console.log(`    skipped ${id}: ${err.message.split('\n')[0]}`);
      }
      await page.waitForTimeout(500 + Math.floor(Math.random() * 900));
    }
  }

  const deduped = Array.from(new Map(allJobs.map(j => [j.url, j])).values());
  console.log(`\nTotal unique jobs scraped: ${deduped.length}`);
  console.log('\n=== SEARCH RESULTS ===');
  console.log(JSON.stringify(deduped, null, 2));
}

// ── SAVE MODE ────────────────────────────────────────────────────────────────
async function saveMatchingJobs() {
  const remaining = new Set(saveIds);
  let saved = 0;
  console.log(`\nLooking to save ${remaining.size} job(s) across up to ${maxPages} pages...`);

  for (let pageNum = 1; pageNum <= maxPages && remaining.size > 0; pageNum++) {
    console.log(`\nPage ${pageNum}...`);
    const ok = await gotoPage(pageNum);
    if (!ok) break;
    const ids = await loadAllCards();

    for (const id of ids) {
      if (!remaining.has(id)) continue;
      const li = page.locator(cardSelForId(id)).first();
      try {
        await li.scrollIntoViewIfNeeded().catch(() => {});
        const link = li.locator('a.job-card-container__link, a[href*="/jobs/view/"]').first();
        await link.click({ timeout: 5000 });
        await page.waitForTimeout(1200);
        const saveBtn = page.locator('button.jobs-save-button').first();
        await saveBtn.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
        const label = (await saveBtn.innerText().catch(() => '')).trim().toLowerCase();
        if (label.startsWith('saved')) {
          console.log(`  ✅ already saved: ${id}`);   // never unsave
        } else {
          await saveBtn.click({ timeout: 4000 });
          await page.waitForTimeout(800);
          console.log(`  ✅ saved: ${id}`);
        }
        saved++;
        remaining.delete(id);
      } catch (err) {
        console.log(`  ⚠️  could not save ${id}: ${err.message.split('\n')[0]}`);
      }
    }
  }

  if (remaining.size > 0) {
    console.log(`\n⚠️  Could not find ${remaining.size} job(s) on the search pages:`);
    remaining.forEach(id => console.log(`  - ${id}`));
  }
  console.log('\n=== SAVE RESULTS ===');
  console.log(JSON.stringify({ saved, notFound: [...remaining] }, null, 2));
}

// ── ENTRY ────────────────────────────────────────────────────────────────────
try {
  if (isSaveMode) await saveMatchingJobs();
  else await scrape();
} catch (err) {
  console.log(`Stopped: ${err.message.split('\n')[0]}`);
}

await context.storageState({ path: sessionFile }).catch(() => {});
await browser.close().catch(() => {});
