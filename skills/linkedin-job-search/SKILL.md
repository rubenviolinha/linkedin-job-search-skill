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
| Save top N | No | 10 | How many qualifying jobs to save to output file |
| Flags | No | — | Same flag syntax as `/job-analyzer` (e.g. "flag if visa required") |

If no resume is provided in the message, ask the user to share it (text paste or file path). The resume is the source of truth for preferences — do not invent a profile.

## Workflow

### Phase 1 — Setup & Search

1. Copy `linkedin_search.mjs` to `/tmp/pw-runner/` if not already there:
   ```bash
   mkdir -p /tmp/pw-runner
   cp /path/to/repo/scraper/linkedin_search.mjs /tmp/pw-runner/
   cd /tmp/pw-runner && npm install playwright 2>/dev/null | tail -2
   ```
2. Run the scraper — use ~3× the target count as page budget to have enough candidates to filter:
   ```bash
   cd /tmp/pw-runner && node linkedin_search.mjs \
     --keywords "Supply Chain Manager" \
     --location "Oslo, Norway" \
     --max-pages 4 2>&1
   ```
3. Parse the JSON block after `=== SEARCH RESULTS ===` → raw candidates list.

**Session handling:** Same session as `linkedin-jobs-fetch` (`~/.claude/linkedin-session.json`). If the script reports session expired, tell the user to delete that file and re-run. If no session exists, the browser will open for manual login — instruct user to log in then run `touch /tmp/linkedin-ready`.

### Phase 2 — Evaluate

1. Extract user profile from provided resume (same approach as `job-analyzer`): current role, skills, seniority, domain background, languages, location preference.
2. Note any custom flags from user message (language requirements, visa, remote vs on-site, etc.).
3. Fetch full job descriptions **in parallel** using `WebFetch` for every candidate.
4. For each job, assess:
   - **Domain fit** — honest about skill gaps
   - **Level fit** — seniority match
   - **Location fit** — matches user preference?
   - **Custom flags** — apply ❌/⚠️/✅ markers
   - **Overall fit** — ⭐ to ⭐⭐⭐⭐⭐
5. Sort by overall fit descending, take top N.

### Phase 3 — Output

Present shortlist as a markdown table:

| Role | Company | Location | Fit | Flags | Easy Apply | URL |
|---|---|---|---|---|---|---|
| ... | ... | ... | ⭐⭐⭐⭐ | ✅ | Yes | [link] |

Then save the full shortlist to:
```
output/job-search-YYYY-MM-DD.json
```

Format:
```json
[
  {
    "title": "...",
    "company": "...",
    "location": "...",
    "url": "...",
    "easyApply": true,
    "posted": "...",
    "fitScore": 4,
    "flags": "✅",
    "fitSummary": "Strong match — supply chain background aligns well, no language barrier."
  }
]
```

After outputting the table, offer:
- `/job-analyzer` — for deeper per-job analysis with full summaries
- `/resume-cover-letter-generator` — to generate tailored PDFs for top picks

## Key Rules

- **Always fetch actual JD** — never assess a job from title alone
- **Always read actual resume** — ask if not provided, never invent a profile
- **Be honest about gaps** — don't oversell fit
- **Parallel JD fetching** — use WebFetch concurrently to keep latency low
- **Create output/ folder** if it doesn't exist before saving JSON
- **Idempotent** — re-running overwrites the same-date output file cleanly

## Related Skills

- `linkedin-jobs-fetch` — fetches jobs you've already saved on LinkedIn
- `job-analyzer` — deeper analysis of a job list
- `resume-cover-letter-generator` — generates tailored PDFs for top picks
