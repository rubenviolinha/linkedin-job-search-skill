---
name: resume-cover-letter-generator
description: "Generate tailored resumes and cover letters as PDFs for job applications. Takes job URLs or job analyzer results and creates customized documents. Use to batch-process top job picks."
metadata:
  author: rubenviolinha
  version: "1.0"
  type: utility
  mode: assistive
  domain: career
---

# resume-cover-letter-generator

Generates tailored resumes and cover letters for targeted job applications.

## Description

Takes a list of job URLs (typically from `/job-analyzer` results) and automatically generates tailored resume and cover letter PDFs customized for each role. Perfect for batch-processing your top job picks.

## Input Format

Users provide one of:
1. **Job URLs** - Direct LinkedIn job URLs or list of URLs
2. **Job analyzer results** - Copy-paste from job-analyzer output (skill auto-extracts URLs)
3. **Manual job list** - Simple list: "TechCorp Senior PM", "Google PM", etc.

Plus:
- **User's resume** - Paste your current resume text or mention a file path
- **Optional context** - Any specific achievements or projects you want highlighted

## Usage Examples

```
/resume-cover-letter-generator
Jobs: 
- https://www.linkedin.com/jobs/view/123456/
- https://www.linkedin.com/jobs/view/234567/
- https://www.linkedin.com/jobs/view/345678/

Resume: [paste your resume here or say "use my resume at ~/path"]
```

Or after using job-analyzer:

```
The top 3 picks look great. Generate tailored resumes and cover letters for:
- TechCorp (Senior Product Manager)
- Google (Product Manager)
- Microsoft (Senior PM)

My resume is at ~/Documents/resume.txt
```

## Workflow

**Phase 1: Parse Input**
- Extract job URLs from user message
- Fetch full job descriptions in parallel (WebFetch)
- Extract company name, job title, key requirements, skills from each JD

**Phase 2: Analyze & Generate**
- For each job:
  1. Identify top 3-5 key requirements from JD
  2. Generate tailored resume (Claude) - reorder/emphasize relevant experience
  3. Generate tailored cover letter (Claude) - address specific role + company
  4. Save both as HTML files (for review before PDF if needed)

**Phase 3: PDF Export**
- Convert each resume HTML → PDF via Playwright
- Convert each cover letter HTML → PDF via Playwright
- Organize in `output/{CompanyName}/` folders
- Verify all PDFs created successfully

**Phase 4: Summary**
- Show list of generated documents
- Display file paths for easy access
- Offer to open folder or export summary

## Output

**File Structure:**
```
output/
├── CompanyName_1/
│   ├── Resume_CompanyName_1.pdf
│   └── CoverLetter_CompanyName_1.pdf
├── CompanyName_2/
│   ├── Resume_CompanyName_2.pdf
│   └── CoverLetter_CompanyName_2.pdf
```

**Resume:** Tailored version highlighting role-relevant experience, reordered to match job requirements
**Cover Letter:** Standard business format with specific company/role references and 1-2 tailored requirements

## Key Rules

- **Always fetch actual JD** - Never invent job requirements
- **Reuse existing experience** - Don't fabricate skills or roles, emphasize what's relevant
- **Specific over generic** - Cover letters mention company name + specific requirement
- **Parallel generation** - Process 3-5 jobs simultaneously (~20-30s total time)
- **ATS-friendly** - Resume uses standard format readable by applicant tracking systems
- **Idempotent** - Safe to re-run; overwrites existing PDFs without duplication
- **User's resume is source of truth** - All content tailored from provided resume, never invented

## Implementation Notes

- Reuse `job-analyzer` WebFetch pattern for parallel job fetching
- Use Playwright (from `scraper/pdf_generator.mjs` utility) for HTML → PDF conversion
- Resume template: Adapt existing `resume/resume-template.html` with dynamic data injection
- Cover letter template: New clean HTML template with standard business letter format
- Folder creation: Auto-create `output/{company}/` if doesn't exist
- Error handling: If any PDF fails, report which job(s) and why; continue with others

## Related Skills

- `job-analyzer` - Use this first to find/rate jobs, then pass results here for doc generation
- `linkedin-jobs-fetch` - Use to fetch your saved LinkedIn jobs as input

## Feedback Loop

Generated docs can be:
- Reviewed before final PDF (with Claude help for edits)
- Directly submitted via LinkedIn/company career pages
- Fine-tuned for multiple rounds of applications
