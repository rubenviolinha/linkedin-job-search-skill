import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

/**
 * Convert HTML content to PDF file
 * @param {string} htmlContent - HTML content to convert
 * @param {string} outputPath - Full path where PDF should be saved
 * @returns {Promise<boolean>} - True if successful, false otherwise
 */
export async function generatePDF(htmlContent, outputPath) {
  let browser;
  try {
    // Ensure output directory exists
    const dir = dirname(outputPath);
    mkdirSync(dir, { recursive: true });

    // Launch headless browser
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox'],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 1024 },
    });

    const page = await context.newPage();

    // Set content and wait for network to be idle
    await page.setContent(htmlContent, { waitUntil: 'networkidle' });

    // Generate PDF with standard letter size (8.5" x 11")
    await page.pdf({
      path: outputPath,
      format: 'Letter',
      margin: {
        top: '0.5in',
        bottom: '0.5in',
        left: '0.75in',
        right: '0.75in',
      },
    });

    await context.close();
    console.log(`✓ PDF created: ${outputPath}`);
    return true;
  } catch (error) {
    console.error(`✗ Failed to create PDF at ${outputPath}:`, error.message);
    return false;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Batch generate multiple PDFs
 * @param {Array<{html: string, path: string}>} documents - Array of {html, path} objects
 * @returns {Promise<Object>} - Object with success/failure counts and details
 */
export async function generatePDFBatch(documents) {
  const results = {
    total: documents.length,
    succeeded: 0,
    failed: 0,
    details: [],
  };

  for (const doc of documents) {
    const success = await generatePDF(doc.html, doc.path);
    if (success) {
      results.succeeded++;
      results.details.push({ path: doc.path, status: 'success' });
    } else {
      results.failed++;
      results.details.push({ path: doc.path, status: 'failed' });
    }
  }

  return results;
}
