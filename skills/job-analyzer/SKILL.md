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

## Getting the user's profile

Read the user's profile from their **resume**. If they haven't shared one yet, ask:

> "Please share your resume — paste the text, attach the file, or drop in the HTML. I'll use it as your profile for the analysis."

Extract from the resume:
- Current role and company
- Key achievements (especially quantified ones)
- Domain background and core skills
- Previous roles and companies
- Education
- Languages and proficiency levels
- Any location or role preferences mentioned

If the user has stated preferences in their message (e.g. "I want to stay in London" or "I'm only looking at senior roles"), combine those with what's in the resume.

## Custom flags

Users can also ask the skill to watch out for specific things at analysis time:

> "Flag anything that requires French language"  
> "Note if the role requires a work visa"  
> "Mark as ❌ any roles that are fully on-site"

Examples of things users commonly flag:
- A specific language being **required**
- Work authorisation or visa requirements
- Specific tools or tech stacks that are deal-breakers
- Travel or relocation requirements
- Salary or equity mentions
- Remote vs. on-site requirements

If the user specifies flags in their message, apply them to every job in the analysis.

## Workflow

### Step 1 — Get the resume
If no resume has been shared in the conversation, ask for it before proceeding.

### Step 2 — Extract job listings from input
Parse the user's input (HTML, plain text, or URLs) to get:
- Job title
- Company
- Location
- LinkedIn job URL

### Step 3 — Check for custom flags
Re-read the user's message for any specific things to watch out for. These will be applied in Step 4.

### Step 4 — Fetch all job URLs in parallel
Use WebFetch on every job URL simultaneously. For each job extract:
- Full job description
- Required qualifications
- Preferred qualifications
- Anything matching the user's custom flags

### Step 5 — Analyze each job against the profile
For each job assess:
1. **Domain fit** — does the user's background match what the JD asks for? Be honest about gaps.
2. **Level fit** — does the seniority match?
3. **Location** — is it where the user wants to be?
4. **Custom flags** — mark each flagged criterion as ❌ (hard blocker), ⚠️ (worth noting), or ✅ (not mentioned / fine)
5. **Overall fit** — ⭐ to ⭐⭐⭐⭐⭐

### Step 6 — Present results

First, a summary table:

| Role | Company | Location | Fit | Flags | Key note |
|------|---------|----------|-----|-------|---------|

Then: top 3 picks with 2–3 sentences explaining why each fits or doesn't.

## Key Rules
- **Always fetch the actual JD** — title-based guesses mislead analysis
- **Always read the actual resume** — don't make up or assume profile details
- Hard blockers (user said "must not") = ❌, mark clearly
- Worth noting (user said "flag" or "note") = ⚠️
- Not mentioned / not a concern = ✅
- Be direct about skill gaps — don't oversell fit to seem encouraging
- Fetch all URLs in parallel to save time
