---
name: linkedin-job-search
description: "Actively searches LinkedIn job listings using Playwright, scrapes job descriptions, analyzes fit against your profile, and saves top matches. Use when you want to discover new job opportunities beyond your saved jobs."
metadata:
  author: rubenviolinha
  version: "1.0"
  type: utility
  mode: assistive
  domain: career
---

# linkedin-job-search

Searches LinkedIn for jobs matching a keyword + location, filters results against your profile, and saves a shortlist.

## Description

Actively searches LinkedIn job listings (not just your saved ones) using a Playwright browser with your existing session. Scrapes candidates across pages, fetches full job descriptions, scores them against your profile, and outputs a filtered shortlist — ready to hand off to `/job-analyzer` or `/resume-cover-letter-generator`.

## Usage

```
/linkedin-job-search
Keywords: Supply Chain Manager
Location: Oslo, Norway
Save top: 10
Flags: flag if Norwegian required, note if relocation expected
```

Or minimal:
```
/linkedin-job-search
Keywords: Operations Manager
Location: London, UK
```

## Inputs

| Input | Required | Default | Notes |
|---|---|---|---|
| Keywords | Yes | — | Job title or search terms |
| Location | No | Worldwide | City, region, or country |
| Jobs to scan | No | All on page (up to 5 pages) | How many job listings to read and evaluate. Use `--max-jobs N`. 25 per page, so 50 = 2 pages, 75 = 3, etc. |
| Save top N | No | 10 | How many qualifying jobs to save on LinkedIn after evaluation |
| Flags | No | — | Same flag syntax as `/job-analyzer` (e.g. "flag if visa required") |

If no resume is provided in the message, ask the user to share it (text paste or file path). The resume is the source of truth for preferences — do not invent a profile.

## Workflow

### Phase 1 — Setup & Scrape with Descriptions

1. Copy `linkedin_search.mjs` to `/tmp/pw-runner/` if not already there:
   ```bash
   mkdir -p /tmp/pw-runner
   cp /path/to/repo/scraper/linkedin_search.mjs /tmp/pw-runner/
   cd /tmp/pw-runner && npm install playwright 2>/dev/null | tail -2
   ```
2. Run the scraper — the browser opens, sets the location filter, then clicks through every card, waits for the right panel to load, and reads the full job description. Use `--max-jobs` to cap how many jobs are scanned (stops mid-page when reached):
   ```bash
   cd /tmp/pw-runner && node linkedin_search.mjs \
     --keywords "Supply Chain Manager" \
     --location "Oslo, Norway" \
     --max-jobs 50 2>&1
   ```
3. Parse the JSON block after `=== SEARCH RESULTS ===` — each entry has `title`, `company`, `location`, `url`, `easyApply`, `posted`, and **`description`** (up to 3000 chars of the full JD).

**Session handling:** Same session as `linkedin-jobs-fetch` (`~/.claude/linkedin-session.json`). If the script reports session expired, tell the user to delete that file and re-run. If no session exists, the browser will open for manual login — instruct user to log in then run `touch /tmp/linkedin-ready`.

### Phase 2 — Evaluate

1. Extract user profile from provided resume: current role, skills, seniority, domain background, languages, location preference.
2. Note any custom flags from user message (language requirements, visa, remote vs on-site, etc.).
3. For each scraped job, assess using the **`description` field** (no separate WebFetch needed):
   - **Domain fit** — honest about skill gaps
   - **Level fit** — seniority match
   - **Location fit** — matches user preference?
   - **Custom flags** — apply ❌/⚠️/✅ markers
   - **Overall fit** — ⭐ to ⭐⭐⭐⭐⭐
4. Sort by overall fit descending, pick top N URLs.

### Phase 3 — Save on LinkedIn

Run the scraper in save mode — it navigates the same search page, clicks through cards, and clicks the LinkedIn "Save" button on each matching job:
```bash
cd /tmp/pw-runner && node linkedin_search.mjs \
  --keywords "Supply Chain Manager" \
  --location "Oslo, Norway" \
  --save-urls "https://www.linkedin.com/jobs/view/123/,https://www.linkedin.com/jobs/view/456/"
```
Parse `=== SAVE RESULTS ===` to confirm how many were saved.

### Phase 4 — Output

Present shortlist as a markdown table:

| Role | Company | Location | Fit | Flags | Easy Apply | URL |
|---|---|---|---|---|---|---|
| ... | ... | ... | ⭐⭐⭐⭐ | ✅ | Yes | [link] |

Save full shortlist to:
```
output/job-search-YYYY-MM-DD.json
```

After outputting the table, offer:
- `/job-analyzer` — for deeper per-job analysis with full summaries
- `/resume-cover-letter-generator` — to generate tailored PDFs for top picks

## Key Rules

- **Always read actual JD** — never assess a job from title alone; descriptions come from the scraper's `description` field, no WebFetch needed
- **Always read actual resume** — ask if not provided, never invent a profile
- **Be honest about gaps** — don't oversell fit
- **Never unsave** — save mode skips jobs already saved (`aria-label="Unsave the job"`)
- **Create output/ folder** if it doesn't exist before saving JSON
- **Idempotent** — re-running overwrites the same-date output file cleanly

## Related Skills

- `linkedin-jobs-fetch` — fetches jobs you've already saved on LinkedIn
- `job-analyzer` — deeper analysis of a job list
- `resume-cover-letter-generator` — generates tailored PDFs for top picks
