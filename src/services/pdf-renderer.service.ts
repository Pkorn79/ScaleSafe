import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { logger } from '../utils/logger';

/**
 * Shared HTML→PDF renderer used by enrollment-packet, defense-letter, and
 * defense-bundle services. Production uses system Chromium installed via apk
 * in the Dockerfile; local dev uses the @sparticuz/chromium bundled binary.
 *
 * Returns a Buffer suitable for upload to Supabase storage or merge via pdf-lib.
 */
export async function renderHtmlToPdf(
  html: string,
  opts: {
    format?: 'Letter' | 'A4';
    margin?: { top: string; bottom: string; left: string; right: string };
    headerTemplate?: string;
    footerTemplate?: string;
    displayHeaderFooter?: boolean;
  } = {},
): Promise<Buffer> {
  let browser;
  try {
    const systemChromium = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (systemChromium) {
      browser = await puppeteer.launch({
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--single-process',
        ],
        defaultViewport: { width: 1280, height: 900 },
        executablePath: systemChromium,
        headless: true,
      });
    } else {
      browser = await puppeteer.launch({
        args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
        defaultViewport: { width: 1280, height: 900 },
        executablePath: await chromium.executablePath(),
        headless: true,
      });
    }

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: opts.format || 'Letter',
      printBackground: true,
      displayHeaderFooter: opts.displayHeaderFooter ?? true,
      headerTemplate: opts.headerTemplate || '<span></span>',
      footerTemplate: opts.footerTemplate || `<div style="width:100%;text-align:center;font-size:9px;color:#9ca3af;padding:0 0.6in">
        <span class="pageNumber"></span> of <span class="totalPages"></span>
      </div>`,
      margin: opts.margin || { top: '0.4in', bottom: '0.6in', left: '0.6in', right: '0.6in' },
    });

    return Buffer.from(pdfBuffer);
  } catch (err: any) {
    logger.error(
      { err: err.message, stack: err.stack, execPath: process.env.PUPPETEER_EXECUTABLE_PATH || 'chromium-bundled' },
      'Puppeteer PDF rendering failed',
    );
    throw err;
  } finally {
    if (browser) await browser.close();
  }
}
