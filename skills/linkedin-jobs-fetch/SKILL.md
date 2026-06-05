---
name: linkedin-jobs-fetch
description: "Fetch saved jobs from LinkedIn's jobs tracker using Playwright with a persisted session. Optionally add or edit notes on jobs. Use when the user wants to retrieve their LinkedIn saved jobs or annotate them."
metadata:
  author: rubenviolinha
  version: "2.1"
  type: utility
  mode: assistive
  domain: career
---

# LinkedIn Jobs Fetch Skill

Automate fetching saved jobs from https://www.linkedin.com/jobs-tracker/?stage=saved using Playwright with a persisted session stored in `~/.claude/linkedin-session.json`.

The working script is bundled with this skill as `linkedin_fetch.mjs` — don't rewrite it from scratch, it already handles LinkedIn's quirks (see "How the script handles LinkedIn's DOM" below).

## Two modes

1. **Scrape** (default) — fetch all saved jobs as clean JSON, then pass to job-analyzer
2. **Add/edit notes** (`--add-notes`) — write or update notes on specific jobs

---

## Scrape mode

### Step 1 — Ensure playwright + the bundled script are in place

```bash
mkdir -p /tmp/pw-runner
ls /tmp/pw-runner/node_modules/playwright 2>/dev/null || (cd /tmp/pw-runner && echo '{"type":"module"}' > package.json && npm install playwright --save && npx playwright install chromium)
cp ~/.claude/skills/linkedin-jobs-fetch/linkedin_fetch.mjs /tmp/pw-runner/linkedin_fetch.mjs
```

### Step 2 — Run the script

```bash
cd /tmp/pw-runner && node linkedin_fetch.mjs 2>&1
```

**First run (no session yet):** A browser window opens to the LinkedIn login page. Tell the user:

> "A browser window has opened. Please log in to LinkedIn. Once you're on the home page (linkedin.com/feed), run this in a new terminal: `touch /tmp/linkedin-ready`"

Wait for the user to confirm, then the script saves the session automatically. Future runs skip login.

**Subsequent runs:** Uses `~/.claude/linkedin-session.json` — no interaction needed. If the session has expired, the script detects the login/authwall redirect and prints a clear message to delete the session file and re-run.

### Step 3 — Parse output and analyze

The script prints a JSON block between `=== ALL JOBS BY TAB ===` and `=== END ===`, with each job parsed into `title`, `company`, `posted`, and `url`:

```json
{ "Saved": [ { "stage": "saved", "id": "123", "title": "...", "company": "... · Oslo", "posted": "Posted 2d ago", "url": "https://www.linkedin.com/jobs/view/123/" } ] }
```

Extract it and pass to the **job-analyzer** skill for full analysis.

---

## Add/edit notes mode

Two sub-workflows:

**A) AI analysis notes** — fetch all saved jobs, run job-analyzer on every JD, then write a one-line verdict (rating + reason) as a note on each job card. The user sees the assessment directly in their LinkedIn tracker.

**B) Manual notes** — user specifies specific jobs and custom text.

### Step 1 — Build a notes JSON file

Create `/tmp/job-notes.json` mapping job URLs to note text (max ~250 chars per note):

```json
{
  "https://www.linkedin.com/jobs/view/1234567890/": "⭐⭐⭐⭐⭐ Strong fit. Domain and seniority align well. Apply.",
  "https://www.linkedin.com/jobs/view/9876543210/": "❌ Target language required. Hard blocker."
}
```

For the AI-analysis workflow, fetch all jobs first (scrape mode), run job-analyzer on all JDs, then build this JSON with a short verdict per job.

### Step 2 — Run with --add-notes flag

```bash
cd /tmp/pw-runner && node linkedin_fetch.mjs --add-notes /tmp/job-notes.json 2>&1
```

For each job ID the script auto-detects which path to use:

- **No note yet →** clicks the inline **"Add note"** link in the card's Notes cell.
- **Note already exists →** there is NO inline link. The script clicks the **⋯ overflow menu** button (next to "Apply", `aria-label="Overflow menu"`), then clicks **"Edit note"** in the popover that appears.

Both open the same modal; the script fills the textarea and clicks **Save**. Notes are idempotent — adding to a job that already has a note overwrites it via the edit path.

A verification screenshot of the final tracker state is written to `/tmp/linkedin-notes-result.png` — read it to confirm the notes landed.

**If it crashes mid-run:** create a partial JSON with only the remaining jobs and re-run. It's safe to re-run — re-writing/editing an existing note just overwrites it.

---

## How the script handles LinkedIn's DOM

- **Each card is rendered twice** (a tile layout and a table-row layout); only one copy is visible at a given width. The script always targets the **visible** copy (checks `offsetParent` + client rects) — never a blind `.first()`, which would hang ~30s on a hidden element and can close the browser ("stuck"). Targeting is done by tagging the right element with a `data-pw-*` attribute inside `page.evaluate`, then acting on it with a Playwright locator (auto-scroll + actionability waits).
- **The list virtualizes rows**, so the scraper accumulates cards while scrolling incrementally rather than taking a single snapshot.
- **Scrape output is parsed**, not a raw blob: title / company / posted come from the card's `<p>` tags, preferring the visible (non-empty `innerText`) copy.

---

## Troubleshooting

- **Session expired** — the script auto-detects the login/authwall redirect and tells you. Delete `~/.claude/linkedin-session.json` and re-run; the login flow will trigger again.
- **"Add note" link / overflow menu not found** — the job may not be on the saved tab, or LinkedIn changed the DOM. The script walks up from the *visible* job-link anchor to its card, then looks for either an inline `<a>`/`<button>` whose text is exactly "Add note"/"Edit note", or a `button[aria-label="Overflow menu"]` (for editing existing notes). If LinkedIn renames these, update `tagVisibleNoteLink` / `tagVisibleOverflow` in `linkedin_fetch.mjs`.
- **Editing an existing note does nothing / navigates away** — the "Edit note" item lives in a body-level popover (`[role="menu"]`) opened by the ⋯ button; the script clicks it there. If the overflow button moved, re-check `openNoteEditor`.
- **Script hangs waiting for signal** — run `touch /tmp/linkedin-ready` in a terminal once logged in.
- **Fewer jobs than expected** — the count reflects what's currently on the Saved tab; unsaving a job removes it from the results.
