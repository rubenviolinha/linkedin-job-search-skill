# linkedin-job-search-skill

A [Claude Code](https://claude.ai/code) skill that automates your LinkedIn job search: scrapes your saved jobs, analyzes each one against your profile, and writes a verdict directly onto every job card — so you can see the assessment without leaving LinkedIn.

## How it works

1. **Scrapes** your saved jobs from the LinkedIn jobs tracker using Playwright
2. **Fetches** the actual job description for every role (no title-only guesses)
3. **Analyzes** each JD against your profile: domain fit, seniority, location, language requirements
4. **Writes a one-line verdict** as a note on each job card in your LinkedIn tracker

## Skills

| Skill | Trigger | What it does |
|-------|---------|-------------|
| `linkedin-jobs-fetch` | `/linkedin-jobs-fetch` | Runs the Playwright scraper, handles login and pagination, writes notes back to LinkedIn |
| `job-analyzer` | `/job-analyzer` | Fetches all JDs in parallel, rates fit against your profile, flags language blockers |

Use them together: `/linkedin-jobs-fetch` to pull and analyze your saved jobs, notes land directly on each card.

## Prerequisites

| Tool | Install |
|------|---------|
| **Node.js 18+** | [nodejs.org](https://nodejs.org) — check with `node --version` |
| **Playwright + Chromium** | `cd scraper && npm install && npx playwright install chromium` |
| **Claude Code** | `npm install -g @anthropic-ai/claude-code` |

## Setup

### 1 — Install the skills

```bash
cp -r skills/* ~/.claude/skills/
```

Open `~/.claude/skills/job-analyzer/SKILL.md` and fill in your own details where the `[YOUR ...]` placeholders are — your background, the roles you're targeting, and any language preferences for the country you're applying in.

### 2 — Install scraper dependencies

```bash
cd scraper
npm install
npx playwright install chromium
```

### 3 — First login

The first time you run the scraper, a Chromium window opens at the LinkedIn login page. Log in, wait until you reach `linkedin.com/feed`, then signal the script from a second terminal:

```bash
touch /tmp/linkedin-ready
```

Your session is saved to `~/.claude/linkedin-session.json` (gitignored — never committed). All future runs skip this step.

## Usage

In Claude Code, just run:

```
/linkedin-jobs-fetch
```

Claude will scrape your saved jobs, fetch every JD, analyze fit, and write notes back to LinkedIn automatically.

### Terminal usage (without Claude Code)

**Scrape saved jobs:**
```bash
node scraper/linkedin_fetch.mjs
```

**Write notes to specific jobs:**
```bash
node scraper/linkedin_fetch.mjs --add-notes /path/to/notes.json
```

`notes.json` format:
```json
{
  "https://www.linkedin.com/jobs/view/1234567890/": "⭐⭐⭐⭐⭐ Strong fit. Domain and level align well. Apply.",
  "https://www.linkedin.com/jobs/view/9876543210/": "❌ Target language required. Hard blocker."
}
```

Notes are idempotent — re-running overwrites existing ones. If a run crashes mid-way, use a partial JSON with the remaining jobs and re-run.

## Resume template

`resume/resume-template.html` is a clean, single-page HTML resume template. Open it in any browser, fill in your details, then **Print → Save as PDF** to export.

## Session management

- Session stored at `~/.claude/linkedin-session.json` — outside the repo, gitignored
- To reset: delete the file and re-run; the login flow triggers again

## Customising the job analyzer

Edit `~/.claude/skills/job-analyzer/SKILL.md` and replace the placeholders with:
- Your current role and key achievements
- Your domain background and skills
- Location and role-type preferences
- Language rules (e.g. if applying in Norway: whether Norwegian is a hard disqualifier or just flagged as preferred)
