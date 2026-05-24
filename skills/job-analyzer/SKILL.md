---
name: job-analyzer
description: "Analyze saved job listings for fit against the user's profile. Fetches actual job descriptions, rates suitability, and flags any target-country language requirements. Use when the user wants to analyze job listings from HTML, URLs, or structured data."
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
**Target country language:** [IF APPLYING TO ROLES IN A SPECIFIC COUNTRY, NOTE WHETHER THAT LANGUAGE IS A HARD REQUIREMENT OR JUST PREFERRED — e.g. "Norwegian must not be required; preferred/plus is fine"]

## Workflow

### Step 1 — Extract job listings from input
Parse the user's input (HTML, plain text, or URLs) to get:
- Job title
- Company
- Location
- LinkedIn job URL

### Step 2 — Fetch all job URLs in parallel
Use WebFetch on every job URL simultaneously. For each job extract:
- Full job description
- Required qualifications
- Preferred qualifications
- Any mention of the target-country language (required vs. preferred vs. not mentioned)

### Step 3 — Analyze each job against the profile
For each job assess:
1. **Domain fit** — does the user's background match what the JD asks for? Be honest about gaps.
2. **Level fit** — does the seniority match?
3. **Location** — target country or elsewhere?
4. **Target language** — required (disqualifier?), preferred/advantageous, or not mentioned?
5. **Overall fit** — ⭐ to ⭐⭐⭐⭐⭐

### Step 4 — Present results

First, a summary table:

| Role | Company | Location | Target country | 🗣️ Lang | Fit | Key note |
|------|---------|----------|---------------|---------|-----|---------|

Then: top 3 picks with 2–3 sentences explaining why each fits or doesn't.

## Key Rules
- **Always fetch the actual JD** — title-based guesses mislead analysis
- Target language REQUIRED = hard disqualifier (if user specified), mark ❌
- Target language preferred/advantageous = acceptable, mark ⚠️
- Target language not mentioned = fine, mark ✅
- Be direct about skill gaps — don't oversell fit to seem encouraging
- Fetch all URLs in parallel to save time
