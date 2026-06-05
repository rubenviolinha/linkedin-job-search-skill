import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SESSION_PATH = path.join(os.homedir(), '.claude', 'linkedin-session.json');
const READY_SIGNAL = '/tmp/linkedin-ready';
const SAVED_URL = 'https://www.linkedin.com/jobs-tracker/?stage=saved';
const SHOT_PATH = '/tmp/linkedin-notes-result.png';

const args = process.argv.slice(2);
const addNotesIdx = args.indexOf('--add-notes');
const ADD_NOTES_MODE = addNotesIdx !== -1;
const NOTES_FILE = ADD_NOTES_MODE ? args[addNotesIdx + 1] : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jobIdFromUrl = (url) => (url ? (url.match(/\/jobs\/view\/(\d+)/) || [])[1] || null : null);

// ── Session ────────────────────────────────────────────────────────────────
async function ensureSession(browser) {
  if (fs.existsSync(SESSION_PATH)) {
    return await browser.newContext({
      storageState: SESSION_PATH,
      viewport: { width: 1440, height: 900 },
    });
  }
  console.error('No saved session — opening LinkedIn login...');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });
  console.error('>>> Log into LinkedIn in the opened window.');
  console.error(`>>> Once on linkedin.com/feed, run in a terminal: touch ${READY_SIGNAL}`);
  while (!fs.existsSync(READY_SIGNAL)) await sleep(2000);
  await context.storageState({ path: SESSION_PATH });
  try { fs.unlinkSync(READY_SIGNAL); } catch {}
  console.error(`Session saved to ${SESSION_PATH}`);
  return context;
}

// Returns true if logged in, false if the session is expired (redirected to login/authwall).
async function sessionIsValid(page) {
  await page.goto(SAVED_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  const url = page.url();
  return !(url.includes('/login') || url.includes('/authwall') || url.includes('/checkpoint'));
}

async function autoScroll(page) {
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 2200);
    await sleep(500);
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await sleep(400);
}

// ── Scrape ───────────────────────────────────────────────────────────────────
// Parses title / company / posted into separate fields. Prefers the VISIBLE copy
// of each card (LinkedIn renders each card twice — tile + table — and one is hidden,
// so its innerText is empty and we keep the populated copy instead).
async function extractJobsFromPage(page, stage) {
  return await page.evaluate((stage) => {
    const byId = new Map();
    document.querySelectorAll('a[href*="/jobs/view/"]').forEach((a) => {
      const url = a.href.split('?')[0];
      const m = url.match(/\/jobs\/view\/(\d+)/);
      if (!m) return;
      const id = m[1];
      let container = a;
      for (let i = 0; i < 8; i++) {
        container = container.parentElement;
        if (!container) break;
        if (container.querySelectorAll('p').length >= 2) break;
      }
      const ps = container
        ? Array.from(container.querySelectorAll('p')).map((p) => (p.innerText || '').trim()).filter(Boolean)
        : [];
      const title = ps[0] || (a.innerText || '').trim();
      const company = ps[1] || '';
      const posted = ps[2] || '';
      const existing = byId.get(id);
      if (!existing || (!existing.title && title)) {
        byId.set(id, { stage, id, title, company, posted, url: `https://www.linkedin.com/jobs/view/${id}/` });
      }
    });
    return Array.from(byId.values());
  }, stage);
}

// Merge the currently-rendered cards into the accumulator, preferring the copy
// that actually has text (the visible one).
async function collectInto(page, stage, acc) {
  const jobs = await extractJobsFromPage(page, stage);
  for (const j of jobs) {
    const ex = acc.get(j.id);
    if (!ex || (!ex.title && j.title)) acc.set(j.id, j);
  }
}

async function scrapeStage(page, stage, label) {
  console.error(`\n--- Scraping: ${label} (stage=${stage}) ---`);
  await page.goto(`https://www.linkedin.com/jobs-tracker/?stage=${stage}`, {
    waitUntil: 'domcontentloaded', timeout: 20000,
  }).catch(() => {});

  const hasJobs = await page
    .waitForSelector('a[href*="/jobs/view/"]', { timeout: 8000, state: 'attached' })
    .then(() => true)
    .catch(() => false);
  if (!hasJobs) {
    console.error(`  No jobs on ${label}.`);
    return [];
  }
  await sleep(2500);

  const all = new Map();
  let pageNum = 1;
  const maxPages = 30;
  while (pageNum <= maxPages) {
    // The list virtualizes rows, so accumulate while scrolling incrementally
    // instead of taking a single snapshot (which misses off-screen rows).
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await sleep(500);
    let stale = 0;
    for (let step = 0; step < 30 && stale < 3; step++) {
      const before = all.size;
      await collectInto(page, stage, all);
      stale = all.size === before ? stale + 1 : 0;
      await page.mouse.wheel(0, 1100);
      await sleep(650);
    }
    await collectInto(page, stage, all); // bottom
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await sleep(700);
    await collectInto(page, stage, all); // top again (re-virtualized rows)
    console.error(`  Page ${pageNum}: total unique so far: ${all.size}`);

    const nextBtn = page.locator(
      '[data-testid="pagination-controls-next-button-visible"], button[aria-label="Next"], button[aria-label="View next page"]'
    );
    if (!(await nextBtn.count())) break;
    const first = nextBtn.first();
    const disabled = await first.getAttribute('disabled').catch(() => null);
    const ariaDisabled = await first.getAttribute('aria-disabled').catch(() => null);
    if (disabled !== null || ariaDisabled === 'true' || !(await first.isVisible().catch(() => false))) break;

    try {
      await page.keyboard.press('Escape');
      await sleep(300);
      await first.click();
      await page.waitForSelector('a[href*="/jobs/view/"]', { timeout: 10000, state: 'attached' }).catch(() => {});
      await sleep(1800);
    } catch { break; }
    pageNum++;
  }
  return Array.from(all.values());
}

// ── Note editor: open via inline "Add note" OR ⋯ overflow → "Edit note" ────────
async function tagVisibleNoteLink(page, id) {
  return await page.evaluate((jobId) => {
    const isVisible = (el) => {
      if (!el || el.offsetParent === null) return false;
      const r = el.getClientRects();
      return r.length > 0 && r[0].width > 0 && r[0].height > 0;
    };
    for (const a of document.querySelectorAll(`a[href*="/jobs/view/${jobId}"]`)) {
      if (!isVisible(a)) continue;
      let node = a;
      for (let i = 0; i < 10 && node; i++) {
        node = node.parentElement;
        if (!node) break;
        const vis = Array.from(node.querySelectorAll('a, button'))
          .filter((el) => /^(add note|edit note)$/i.test((el.textContent || '').trim()))
          .find(isVisible);
        if (vis) { vis.setAttribute('data-pw-note', jobId); return true; }
      }
    }
    return false;
  }, id);
}

async function tagVisibleOverflow(page, id) {
  return await page.evaluate((jobId) => {
    const isVisible = (el) => {
      if (!el || el.offsetParent === null) return false;
      const r = el.getClientRects();
      return r.length > 0 && r[0].width > 0 && r[0].height > 0;
    };
    for (const a of document.querySelectorAll(`a[href*="/jobs/view/${jobId}"]`)) {
      if (!isVisible(a)) continue;
      let node = a;
      for (let i = 0; i < 10 && node; i++) {
        node = node.parentElement;
        if (!node) break;
        const btn = Array.from(node.querySelectorAll('button[aria-label="Overflow menu"]')).find(isVisible);
        if (btn) { btn.setAttribute('data-pw-overflow', jobId); return true; }
      }
    }
    return false;
  }, id);
}

async function openNoteEditor(page, id) {
  // Path 1: inline "Add note" link (card has no note yet).
  if (await tagVisibleNoteLink(page, id)) {
    const link = page.locator(`[data-pw-note="${id}"]`);
    await link.scrollIntoViewIfNeeded({ timeout: 8000 });
    await link.click({ timeout: 8000 });
    await page.evaluate((j) => document.querySelector(`[data-pw-note="${j}"]`)?.removeAttribute('data-pw-note'), id).catch(() => {});
    return 'add';
  }
  // Path 2: note already exists → ⋯ overflow menu → "Edit note".
  if (!(await tagVisibleOverflow(page, id))) throw new Error('neither Add-note link nor overflow menu found');
  const btn = page.locator(`[data-pw-overflow="${id}"]`);
  await btn.scrollIntoViewIfNeeded({ timeout: 8000 });
  await btn.click({ timeout: 8000 });
  await page.evaluate((j) => document.querySelector(`[data-pw-overflow="${j}"]`)?.removeAttribute('data-pw-overflow'), id).catch(() => {});
  const editItem = page.locator('[role="menu"]').getByText(/^edit note$/i).first();
  await editItem.waitFor({ state: 'visible', timeout: 6000 });
  await editItem.click({ timeout: 6000 });
  return 'edit';
}

async function fillNoteEditor(page, note) {
  const textarea = page.locator('textarea').first();
  try {
    await textarea.waitFor({ state: 'visible', timeout: 10000 });
    await textarea.fill(note.slice(0, 250));
    return;
  } catch {}
  const editable = page.locator('[role="dialog"] [contenteditable="true"], [contenteditable="true"]').first();
  await editable.waitFor({ state: 'visible', timeout: 5000 });
  await editable.click();
  await editable.fill('');
  await page.keyboard.type(note.slice(0, 250));
}

async function clickSave(page) {
  const dialogSave = page.locator('[role="dialog"]').getByRole('button', { name: /^save$/i }).first();
  if (await dialogSave.count()) { await dialogSave.click({ timeout: 8000 }); return; }
  await page.getByRole('button', { name: /^save$/i }).first().click({ timeout: 8000 });
}

async function ensureOnTracker(page) {
  if (!page.url().includes('jobs-tracker')) {
    await page.goto(SAVED_URL, { waitUntil: 'domcontentloaded' });
    await sleep(3000);
    await autoScroll(page);
  }
}

async function addNotes(page, notesMap) {
  const targets = Object.entries(notesMap).map(([url, note]) => ({ id: jobIdFromUrl(url), note }));
  console.error(`Loaded ${targets.length} note targets.`);

  await page.goto(SAVED_URL, { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  await autoScroll(page);

  const done = [];
  for (const { id, note } of targets) {
    try {
      await ensureOnTracker(page);
      const mode = await openNoteEditor(page, id); // 'add' | 'edit'
      await sleep(800);
      await fillNoteEditor(page, note);
      await sleep(300);
      await clickSave(page);
      await sleep(1500);
      try { await page.locator('[role="dialog"]').first().waitFor({ state: 'hidden', timeout: 6000 }); } catch {}
      done.push(id);
      console.error(`✓ Noted ${id} via ${mode} (${done.length}/${targets.length})`);
      await sleep(1000);
    } catch (e) {
      console.error(`✗ Failed to note ${id}: ${(e.message || '').split('\n')[0]}`);
      try { await page.keyboard.press('Escape'); } catch {}
      await sleep(800);
      await ensureOnTracker(page);
    }
  }

  // Verification screenshot of the final tracker state.
  try {
    await ensureOnTracker(page);
    await sleep(1500);
    await page.screenshot({ path: SHOT_PATH, fullPage: false });
    console.error(`Verification screenshot: ${SHOT_PATH}`);
  } catch {}

  console.error(`Done. Annotated ${done.length}/${targets.length}: ${done.join(', ')}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
  const context = await ensureSession(browser);
  const page = await context.newPage();

  try {
    if (!(await sessionIsValid(page))) {
      console.error('Session expired — delete ~/.claude/linkedin-session.json and re-run to log in again.');
      await browser.close();
      process.exit(1);
    }

    if (ADD_NOTES_MODE) {
      const notesMap = JSON.parse(fs.readFileSync(NOTES_FILE, 'utf-8'));
      await addNotes(page, notesMap);
    } else {
      const jobs = await scrapeStage(page, 'saved', 'Saved');
      try { await context.storageState({ path: SESSION_PATH }); } catch {}
      console.log('\n\n=== ALL JOBS BY TAB ===');
      console.log(JSON.stringify({ Saved: jobs }, null, 2));
      console.log(`\nTotal: ${jobs.length} jobs`);
      console.log('=== END ===');
    }
  } catch (e) {
    console.error('FATAL: ' + (e.stack || e.message));
  } finally {
    await sleep(800);
    await browser.close();
  }
})();
