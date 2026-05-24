---
name: job-analyzer
description: "Analyze saved job listings for fit against the user's profile. Fetches actual job descriptions, rates suitability, and flags criteria the user cares about. Use when the user wants to analyze job listings from HTML, URLs, or structured data."
metadata:
  author: rubenviolinha
  version: "1.0"
  type: utility
  mode: assistive
  domain: career
---

# Job Analyzer Skill

Analyze job listings and rate their fit against the user's profile. Always fetch and read the actual job posting — never assess based on title alone.

## User Profile

> **Customise this section with your own details before using the skill.**

**Name:** [YOUR NAME]  
**Current role:** [YOUR CURRENT ROLE AND COMPANY]  
**Key achievements:** [YOUR KEY MEASURABLE ACHIEVEMENTS]  
**Background:** [YOUR DOMAIN — e.g. process engineering, data analytics, product management]  
**Previous:** [PRIOR ROLES AND COMPANIES]  
**Education:** [YOUR DEGREES AND UNIVERSITIES]  
**Languages:** [YOUR LANGUAGES AND PROFICIENCY LEVELS]  
**Job preferences:** [WHAT YOU'RE LOOKING FOR — location, type of role, things to avoid]

## Custom flags

Beyond the profile above, users can ask the skill to watch for specific things at any time:

> "Flag any roles that require X"  
> "Note if the job mentions Y"  
> "Mark as ❌ anything that needs Z"

Examples of things users commonly flag:
- A specific language being **required** (e.g. "Norwegian must not be required")
- Work authorisation requirements ("must be eligible to work in X")
- Specific tools or tech stacks that are required vs. nice-to-have
- Travel or relocation requirements
- Salary or equity mentions
- Fully remote vs. on-site requirements

If the user specifies flags in their message, apply them to every job in the analysis. If nothing is specified, just assess domain fit, level, and location based on the profile.

## Workflow

### Step 1 — Extract job listings from input
Parse the user's input (HTML, plain text, or URLs) to get:
- Job title
- Company
- Location
- LinkedIn job URL

### Step 2 — Check for custom flags
Re-read the user's message for any specific things to watch out for (language requirements, work auth, tools, etc.). These will be applied in Step 3.

### Step 3 — Fetch all job URLs in parallel
Use WebFetch on every job URL simultaneously. For each job extract:
- Full job description
- Required qualifications
- Preferred qualifications
- Anything matching the user's custom flags

### Step 4 — Analyze each job against the profile
For each job assess:
1. **Domain fit** — does the user's background match what the JD asks for? Be honest about gaps.
2. **Level fit** — does the seniority match?
3. **Location** — is it where the user wants to be?
4. **Custom flags** — mark each flagged criterion as ❌ (hard blocker), ⚠️ (worth noting), or ✅ (not mentioned / fine)
5. **Overall fit** — ⭐ to ⭐⭐⭐⭐⭐

### Step 5 — Present results

First, a summary table:

| Role | Company | Location | Fit | Flags | Key note |
|------|---------|----------|-----|-------|---------|

Then: top 3 picks with 2–3 sentences explaining why each fits or doesn't.

## Key Rules
- **Always fetch the actual JD** — title-based guesses mislead analysis
- Hard blockers (user said "must not") = ❌, mark clearly
- Worth noting (user said "flag" or "note") = ⚠️
- Not mentioned / not a concern = ✅
- Be direct about skill gaps — don't oversell fit to seem encouraging
- Fetch all URLs in parallel to save time
