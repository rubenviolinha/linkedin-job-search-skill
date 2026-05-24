# linkedin-job-search-skill

Two [Claude Code](https://claude.ai/code) skills that automate your LinkedIn job search end-to-end.

This toolkit provides four complementary skills:

- **`/linkedin-jobs-fetch`** — Fetches all your saved jobs from LinkedIn, analyzes each against your profile, and writes verdicts directly as notes on every job card.
- **`/linkedin-job-search`** — Actively discovers jobs matching your keywords + location, reads job descriptions, filters by fit, and saves top matches to LinkedIn's saved jobs.
- **`/job-analyzer`** — Performs detailed per-job analysis including role suitability, visa requirements, relocation expectations, and domain fit. Great for deep-dive on a specific role.
- **`/resume-cover-letter-generator`** — Generates tailored resume and cover letter PDFs for your top job picks, customized to each role's requirements.

All skills work together: discover jobs with `/linkedin-job-search` → analyze shortlist with `/job-analyzer` → generate tailored PDFs with `/resume-cover-letter-generator`.

---

## Before you start: have your resume ready

The job analyzer reads your resume to understand your profile — no manual setup needed. When you run `/job-analyzer`, it will ask you to share your resume if you haven't already. You can paste the text, attach the file, or share the HTML.

You can also tell the skill to watch out for specific things at analysis time:

> "Flag anything that requires French language"  
> "Note if the role requires a work visa"  
> "Mark as ❌ any roles that are fully on-site"

---

## Installation

### 1 — Install the Claude Code skills

```bash
cp -r skills/* ~/.claude/skills/
```

### 2 — Install the scraper dependencies

```bash
cd scraper
npm install
npx playwright install chromium
```

**Requirements:** Node.js 18+ ([nodejs.org](https://nodejs.org))

### 3 — First-time LinkedIn login

The first time you run the scraper, a browser window opens at the LinkedIn login page. Log in, wait until you reach `linkedin.com/feed`, then run this in a second terminal to signal that you're in:

```bash
touch /tmp/linkedin-ready
```

Your session is saved to `~/.claude/linkedin-session.json` (gitignored — never committed). All future runs skip the login step entirely.

---

## Usage

In Claude Code:

```
/linkedin-jobs-fetch
```

That's it. Claude handles the rest — scraping, fetching JDs, analyzing, and writing notes back to LinkedIn.

### Running the scraper directly (without Claude Code)

**Scrape saved jobs and print as JSON:**
```bash
node scraper/linkedin_fetch.mjs
```

**Write notes to specific jobs:**
```bash
node scraper/linkedin_fetch.mjs --add-notes /path/to/notes.json
```

Where `notes.json` maps job URLs to note text:
```json
{
  "https://www.linkedin.com/jobs/view/1234567890/": "⭐⭐⭐⭐⭐ Strong fit. Domain and level align well. Apply.",
  "https://www.linkedin.com/jobs/view/9876543210/": "❌ Language required. Hard blocker."
}
```

Notes are idempotent — re-running overwrites existing ones. If a run crashes mid-way, create a partial JSON with the remaining jobs and re-run.

---

## Resume template

`resume/resume-template.html` is a clean single-page HTML resume. Open in any browser → **Print → Save as PDF** to export.

If you already have a resume PDF, you don't need this — the skill only reads your profile from `job-analyzer/SKILL.md`, not a file.

---

## Session management

- Session stored at `~/.claude/linkedin-session.json` — outside the repo, never committed
- If LinkedIn logs you out: delete that file and re-run the scraper. The login flow will trigger again.
