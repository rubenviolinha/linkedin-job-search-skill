import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

const sessionFile = path.join(os.homedir(), '.claude', 'linkedin-session.json');
const readySignal = '/tmp/linkedin-ready';
const hasSession = fs.existsSync(sessionFile);

// Parse flags
const addNotesIdx = process.argv.indexOf('--add-notes');
const notesFile = addNotesIdx !== -1 ? process.argv[addNotesIdx + 1] : null;
const notesMap = notesFile ? JSON.parse(fs.readFileSync(notesFile, 'utf8')) : null;

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
  console.log(`Session saved — future runs won't need login.\n`);
}

// Check session is valid
console.log('Verifying session...');
await page.goto('https://www.linkedin.com/jobs-tracker/?stage=saved', {
  waitUntil: 'domcontentloaded', timeout: 30000,
}).catch(() => {});

if (page.url().includes('/login') || page.url().includes('/authwall')) {
  console.log('Session expired — delete ~/.claude/linkedin-session.json and re-run.');
  await browser.close();
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractJobsFromPage(stage) {
  return page.evaluate((stage) => {
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
      const title = allP[0] || a.innerText?.trim() || '';
      const company = allP[1] || '';
      const posted = allP[2] || '';
      if (title && url) results.push({ stage, title, company, posted, url });
    });
    return results;
  }, stage);
}

async function scrapeStage(stage, label) {
  console.log(`\n--- Scraping: ${label} (stage=${stage}) ---`);
  await page.goto(`https://www.linkedin.com/jobs-tracker/?stage=${stage}`, {
    waitUntil: 'domcontentloaded', timeout: 20000,
  }).catch(() => {});

  const hasJobs = await page.waitForSelector('a[href*="/jobs/view/"]', {
    timeout: 8000, state: 'attached',
  }).then(() => true).catch(() => false);

  if (!hasJobs) {
    console.log(`  No jobs on ${label}.`);
    return [];
  }

  const allJobs = [];
  let pageNum = 1;

  while (true) {
    console.log(`  Page ${pageNum}...`);
    await page.waitForTimeout(1000);
    const jobs = await extractJobsFromPage(stage);
    console.log(`    ${jobs.length} jobs found`);
    allJobs.push(...jobs);

    const nextBtn = page.locator('[data-testid="pagination-controls-next-button-visible"]');
    const hasNext = await nextBtn.count() > 0;
    if (!hasNext) break;

    await nextBtn.click();
    await page.waitForSelector('a[href*="/jobs/view/"]', { timeout: 10000, state: 'attached' }).catch(() => {});
    pageNum++;
  }

  return allJobs;
}

async function addNoteToJob(jobUrl, noteText) {
  const jobId = jobUrl.match(/\/jobs\/view\/(\d+)/)?.[1];
  if (!jobId) { console.log(`  Cannot parse job ID from ${jobUrl}`); return false; }

  // "Add note" is an <a> tag (always visible, no hover needed).
  // Walk up from the job link until we find it in the same card container.
  const clicked = await page.evaluate((jobId) => {
    const links = Array.from(document.querySelectorAll(`a[href*="/jobs/view/${jobId}"]`));
    if (!links.length) return false;
    for (const link of links) {
      let container = link;
      for (let i = 0; i < 15; i++) {
        container = container.parentElement;
        if (!container) break;
        const el = Array.from(container.querySelectorAll('a, button')).find(e => {
          const t = e.innerText?.trim().toLowerCase();
          return t === 'add note' || t === 'edit note';
        });
        if (el) { el.click(); return true; }
      }
    }
    return false;
  }, jobId);

  if (!clicked) {
    console.log(`  Job ${jobId}: "Add/Edit note" element not found`);
    return false;
  }

  const dialog = page.locator('[data-testid="dialog"]');
  const appeared = await dialog.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
  if (!appeared) { console.log(`  Job ${jobId}: dialog did not open`); return false; }

  const textarea = dialog.locator('textarea');
  await textarea.fill(noteText);

  const saveBtn = dialog.locator('button:has-text("Save")');
  await saveBtn.click();

  await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);

  console.log(`  ✅ Note saved for job ${jobId}`);
  return true;
}

// ── Note-adding mode ──────────────────────────────────────────────────────────

if (notesMap) {
  console.log(`\n=== ADD NOTES MODE (${Object.keys(notesMap).length} jobs) ===`);

  // Navigate to saved page and iterate through all pages
  await page.goto('https://www.linkedin.com/jobs-tracker/?stage=saved', {
    waitUntil: 'domcontentloaded', timeout: 20000,
  }).catch(() => {});

  await page.waitForSelector('a[href*="/jobs/view/"]', { timeout: 8000, state: 'attached' }).catch(() => {});

  let pageNum = 1;
  let totalAdded = 0;

  while (true) {
    console.log(`\n--- Page ${pageNum} ---`);
    await page.waitForTimeout(1000);

    // Find which notes apply to jobs on this page
    const jobsOnPage = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href*="/jobs/view/"]'))
        .map(a => a.href.split('?')[0])
    );

    for (const [noteUrl, noteText] of Object.entries(notesMap)) {
      const normalised = noteUrl.split('?')[0].replace(/\/$/, '');
      const match = jobsOnPage.find(u => u.replace(/\/$/, '') === normalised);
      if (match) {
        console.log(`  Adding note to: ${normalised}`);
        try {
          const ok = await addNoteToJob(match, noteText);
          if (ok) totalAdded++;
        } catch (e) {
          console.log(`  Job error: ${e.message}`);
        }
      }
    }

    const nextBtn = page.locator('[data-testid="pagination-controls-next-button-visible"]');
    const hasNext = await nextBtn.count() > 0;
    if (!hasNext) break;

    // Close any lingering dialog before navigating
    const openDialog = page.locator('[data-testid="dialog"]');
    if (await openDialog.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape');
      await openDialog.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    }

    await nextBtn.click();
    await page.waitForSelector('a[href*="/jobs/view/"]', { timeout: 10000, state: 'attached' }).catch(() => {});
    pageNum++;
  }

  console.log(`\nDone. ${totalAdded} / ${Object.keys(notesMap).length} notes saved.`);
  await browser.close();
  process.exit(0);
}

// ── Scrape mode (default) ─────────────────────────────────────────────────────

const stagesToCheck = [{ stage: 'saved', label: 'Saved' }];

const allJobs = {};
for (const { stage, label } of stagesToCheck) {
  const jobs = await scrapeStage(stage, label);
  if (jobs.length > 0) allJobs[label] = jobs;
}

console.log('\n\n=== ALL JOBS BY TAB ===');
console.log(JSON.stringify(allJobs, null, 2));

let total = 0;
for (const [label, jobs] of Object.entries(allJobs)) {
  console.log(`\n${label}: ${jobs.length} jobs`);
  total += jobs.length;
}
console.log(`\nTotal across all tabs: ${total} jobs`);

await browser.close();
