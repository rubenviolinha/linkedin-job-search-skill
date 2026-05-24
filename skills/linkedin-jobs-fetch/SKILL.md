---
name: linkedin-jobs-fetch
description: "Fetch saved jobs from LinkedIn's jobs tracker using Playwright with a persisted session. Optionally add notes to jobs. Use when the user wants to retrieve their LinkedIn saved jobs or annotate them."
metadata:
  author: rubenviolinha
  version: "2.0"
  type: utility
  mode: assistive
  domain: career
---

# LinkedIn Jobs Fetch Skill

Automate fetching saved jobs from https://www.linkedin.com/jobs-tracker/?stage=saved using Playwright with a persisted session stored in `~/.claude/linkedin-session.json`.

## Two modes

1. **Scrape** (default) — fetch all saved jobs as JSON, then pass to job-analyzer
2. **Add notes** (`--add-notes`) — write notes to specific jobs via the LinkedIn dialog

---

## Scrape mode

### Step 1 — Ensure playwright is available

```bash
ls /tmp/pw-runner/node_modules/playwright 2>/dev/null || (mkdir -p /tmp/pw-runner && cd /tmp/pw-runner && echo '{"type":"module"}' > package.json && npm install playwright --save && npx playwright install chromium)
```

### Step 2 — Run the script

```bash
cd /tmp/pw-runner && node linkedin_fetch.mjs 2>&1
```

**First run (no session yet):** A browser window opens to the LinkedIn login page. Tell the user:

> "A browser window has opened. Please log in to LinkedIn. Once you're on the home page (linkedin.com/feed), run this in a new terminal: `touch /tmp/linkedin-ready`"

Wait for the user to confirm they've done this, then the script will save the session automatically. Future runs skip login entirely.

**Subsequent runs:** Uses `~/.claude/linkedin-session.json` — no interaction needed.

### Step 3 — Parse output and analyze

The script prints a JSON block (`=== ALL JOBS BY TAB ===`). Extract it and pass to the **job-analyzer** skill for full analysis.

---

## Add notes mode

Two sub-workflows:

**A) AI analysis notes** — fetch all saved jobs, run job-analyzer on every JD, then write a one-line verdict (rating + reason) as a note on each job card. The user can then see your assessment directly in their LinkedIn tracker without coming back to Claude.

**B) Manual notes** — user specifies specific jobs and custom text to annotate.

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

The script paginates through all saved-jobs pages, finds each matching job card by job ID, clicks its "Add note" / "Edit note" link (it's an `<a>` tag, always visible — no hover needed), fills the textarea, and saves.

**If it crashes mid-run** (e.g. dialog blocking Next button on page boundary): create a partial JSON with only the remaining jobs and re-run. The script is idempotent — re-writing an existing note just overwrites it.

---

## Troubleshooting

- **Session expired** — delete `~/.claude/linkedin-session.json` and re-run; the login flow will trigger again.
- **"Add/Edit note" element not found** — the job may not be on the saved tab, or LinkedIn changed the DOM. The element is an `<a>` tag containing the text "Add note", found by walking up from the job link anchor.
- **Script hangs waiting for signal** — run `touch /tmp/linkedin-ready` in a terminal once logged in.
- **Dialog blocking Next button** — already handled in script (Escape key + wait before paginating), but if it recurs, check that `dialog.waitFor({ state: 'hidden' })` timeout is long enough.
