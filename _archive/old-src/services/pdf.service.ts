/**
 * pdf.service.ts — PDF Generation Service
 *
 * Generates defense packet PDFs from HTML templates using Puppeteer.
 * The defense packet includes:
 * 1. A professional defense letter (written by Claude)
 * 2. An evidence summary appendix (all evidence organized by type)
 *
 * Puppeteer renders HTML → PDF with full CSS support, giving us rich
 * formatting (headers, tables, evidence timelines, signature blocks).
 *
 * Generated PDFs are stored in Supabase Storage and the URL is saved
 * on the defense_packets table.
 *
 * NOTE: Puppeteer is a Phase 4 dependency. For initial development,
 * this service can generate basic text-based PDFs. Full Puppeteer
 * rendering will be added when the package is installed.
 */

import { getSupabaseClient } from '../clients/supabase.client';
import { logger } from '../utils/logger';

/** Data needed to generate a defense packet PDF. */
export interface DefensePacketData {
  defenseId: string;
  merchantName: string;
  merchantEmail: string;
  contactName: string;
  programName: string;
  chargebackAmount: number;
  chargebackDate: string;
  chargebackReasonCode: string;
  defenseLetter: string;
  evidence: Record<string, unknown>[];
  generatedAt: string;
}

/**
 * Generates a defense packet PDF and stores it in Supabase Storage.
 * Returns the storage path and a signed download URL.
 */
export async function generateDefensePacket(
  data: DefensePacketData
): Promise<{ storagePath: string; url: string }> {
  // Build the HTML content
  const html = buildDefenseHtml(data);

  // Convert HTML to PDF buffer
  const pdfBuffer = await htmlToPdf(html);

  // Upload to Supabase Storage
  const storagePath = `defense-packets/${data.defenseId}.pdf`;
  const supabase = getSupabaseClient();

  const { error: uploadError } = await supabase.storage
    .from('scalesafe-files')
    .upload(storagePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (uploadError) {
    logger.error({ error: uploadError, defenseId: data.defenseId }, 'Failed to upload defense PDF');
    throw uploadError;
  }

  // Get a signed URL (valid for 7 days)
  const { data: signedData, error: signError } = await supabase.storage
    .from('scalesafe-files')
    .createSignedUrl(storagePath, 7 * 24 * 60 * 60);

  if (signError) {
    logger.error({ error: signError }, 'Failed to create signed URL for defense PDF');
    throw signError;
  }

  logger.info({ defenseId: data.defenseId, storagePath }, 'Defense PDF generated and uploaded');

  return {
    storagePath,
    url: signedData.signedUrl,
  };
}

/**
 * Generates an evidence summary PDF (without the defense letter).
 * Used for evidence export/review.
 */
export async function generateEvidenceSummary(
  locationId: string,
  contactId: string,
  contactName: string,
  evidence: Record<string, unknown>[]
): Promise<{ storagePath: string; url: string }> {
  const html = buildEvidenceSummaryHtml(contactName, evidence);
  const pdfBuffer = await htmlToPdf(html);

  const storagePath = `evidence-summaries/${locationId}/${contactId}-${Date.now()}.pdf`;
  const supabase = getSupabaseClient();

  const { error: uploadError } = await supabase.storage
    .from('scalesafe-files')
    .upload(storagePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (uploadError) throw uploadError;

  const { data: signedData, error: signError } = await supabase.storage
    .from('scalesafe-files')
    .createSignedUrl(storagePath, 7 * 24 * 60 * 60);

  if (signError) throw signError;

  return { storagePath, url: signedData.signedUrl };
}

/**
 * Converts HTML to a PDF buffer.
 * Currently uses a simple text-based approach.
 * TODO: Replace with Puppeteer for full HTML/CSS rendering when installed.
 */
async function htmlToPdf(html: string): Promise<Buffer> {
  // For now, create a simple text-based PDF-like buffer.
  // When Puppeteer is added (Phase 5), this will be:
  //   const browser = await puppeteer.launch({ headless: true });
  //   const page = await browser.newPage();
  //   await page.setContent(html);
  //   const pdf = await page.pdf({ format: 'A4', margin: { top: '1in', bottom: '1in', left: '0.75in', right: '0.75in' } });
  //   await browser.close();
  //   return Buffer.from(pdf);

  // Placeholder: store the HTML as the "PDF" content for now
  // This lets us test the full pipeline without Puppeteer installed
  return Buffer.from(html, 'utf-8');
}

/** Builds the full defense packet HTML (letter + evidence appendix). */
function buildDefenseHtml(data: DefensePacketData): string {
  const evidenceRows = data.evidence
    .map((e: any) => {
      return `<tr>
        <td>${escapeHtml(e.type || 'unknown')}</td>
        <td>${escapeHtml(e.created_at || '')}</td>
        <td>${escapeHtml(JSON.stringify(e.data || e).substring(0, 200))}</td>
      </tr>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Chargeback Defense Packet — ${escapeHtml(data.contactName)}</title>
  <style>
    body { font-family: Georgia, serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #333; line-height: 1.6; }
    h1 { color: #1a365d; border-bottom: 2px solid #1a365d; padding-bottom: 10px; }
    h2 { color: #2c5282; margin-top: 30px; }
    .header { text-align: center; margin-bottom: 40px; }
    .meta { background: #f7fafc; padding: 15px; border-radius: 5px; margin: 20px 0; }
    .meta p { margin: 5px 0; }
    .letter { white-space: pre-wrap; margin: 20px 0; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 0.9em; }
    th, td { border: 1px solid #e2e8f0; padding: 8px; text-align: left; }
    th { background: #edf2f7; font-weight: bold; }
    .footer { margin-top: 40px; font-size: 0.8em; color: #718096; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Chargeback Defense Packet</h1>
    <p>Prepared by ScaleSafe | ${escapeHtml(data.generatedAt)}</p>
  </div>

  <div class="meta">
    <p><strong>Merchant:</strong> ${escapeHtml(data.merchantName)}</p>
    <p><strong>Client:</strong> ${escapeHtml(data.contactName)}</p>
    <p><strong>Program:</strong> ${escapeHtml(data.programName)}</p>
    <p><strong>Disputed Amount:</strong> $${data.chargebackAmount.toFixed(2)}</p>
    <p><strong>Chargeback Date:</strong> ${escapeHtml(data.chargebackDate)}</p>
    <p><strong>Reason Code:</strong> ${escapeHtml(data.chargebackReasonCode)}</p>
  </div>

  <h2>Defense Letter</h2>
  <div class="letter">${escapeHtml(data.defenseLetter)}</div>

  <h2>Evidence Summary (${data.evidence.length} records)</h2>
  <table>
    <thead>
      <tr><th>Type</th><th>Date</th><th>Details</th></tr>
    </thead>
    <tbody>
      ${evidenceRows}
    </tbody>
  </table>

  <div class="footer">
    <p>This defense packet was automatically generated by ScaleSafe.</p>
    <p>All evidence records are timestamped and stored in an immutable audit trail.</p>
  </div>
</body>
</html>`;
}

/** Builds a standalone evidence summary HTML (no defense letter). */
function buildEvidenceSummaryHtml(
  contactName: string,
  evidence: Record<string, unknown>[]
): string {
  const rows = evidence
    .map((e: any) => `<tr><td>${escapeHtml(e.type || '')}</td><td>${escapeHtml(e.created_at || '')}</td><td>${escapeHtml(JSON.stringify(e.data || e).substring(0, 300))}</td></tr>`)
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Evidence Summary — ${escapeHtml(contactName)}</title>
<style>body{font-family:sans-serif;padding:40px;} table{width:100%;border-collapse:collapse;} th,td{border:1px solid #ccc;padding:8px;text-align:left;} th{background:#f0f0f0;}</style>
</head>
<body>
<h1>Evidence Summary: ${escapeHtml(contactName)}</h1>
<p>Total records: ${evidence.length} | Generated: ${new Date().toISOString()}</p>
<table><thead><tr><th>Type</th><th>Date</th><th>Details</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
