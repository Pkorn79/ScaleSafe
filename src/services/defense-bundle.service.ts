import { PDFDocument } from 'pdf-lib';
import { getSupabase } from '../clients/supabase.client';
import { defenseRepository } from '../repositories/defense.repository';
import { defenseExhibitsService, normalizeEvidencePriorities, buildTimelineRows, type TimelineRow } from './defense-exhibits.service';
import { defenseLetterPdfService } from './defense-letter-pdf.service';
import { renderHtmlToPdf } from './pdf-renderer.service';
import { merchantRepository } from '../repositories/merchant.repository';
import { logger } from '../utils/logger';
import { storageService } from './storage.service';

/**
 * Defense Bundle Service — assembles the combined defense PDF.
 *
 * The bundle contains:
 *   1. Defense letter (HTML→PDF via Puppeteer)
 *   2. Evidence summary / exhibit pages (HTML→PDF via Puppeteer)
 *   3. Signed enrollment packet (loaded AS-IS from storage — never re-rendered
 *      to preserve forensic integrity of the consent-time document)
 *
 * The three parts are merged via pdf-lib into a single PDF, uploaded to the
 * private storage bucket, and the signed URL is saved on `defense_packets.pdf_url`
 * + `pdf_storage_path`.
 */
export const defenseBundleService = {
  async bundleDefensePdf(
    defenseId: string,
    locationId: string,
    contactId: string,
    opts?: {
      enrollmentId?: string | null;
      scopeConfidence?: string;
      offerId?: string | null;
      enrollmentStart?: string | null;
      enrollmentEnd?: string | null;
    },
  ): Promise<string> {
    const supabase = getSupabase();
    const packet = await defenseRepository.getById(defenseId, locationId);
    const merchant = await merchantRepository.getByLocationId(locationId);

    // 1. Build the exhibit list (same list that was used for the letter prompt).
    // The scope options must match the ones the letter used, or the PDF's exhibits
    // will drift from the letter — e.g. a contact_only packet would otherwise scope
    // to nothing here while the letter cited contact-wide exhibits.
    // Exhibit ordering: derive the reason-code evidence priorities from the packet
    // itself (not from opts) so every rebundle path — initial compile, regenerate,
    // manual edit — assigns identical exhibit letters to identical evidence.
    let evidencePriorities: string[] = [];
    try {
      const strategy = await defenseRepository.getReasonCodeStrategy(packet.chargeback_reason_code || '');
      evidencePriorities = normalizeEvidencePriorities(strategy?.evidence_priorities);
    } catch {}
    const enrollmentId = opts?.enrollmentId || packet.enrollment_id || undefined;
    const exhibitList = await defenseExhibitsService.buildExhibitList(locationId, contactId, {
      enrollmentId,
      scopeConfidence: opts?.scopeConfidence,
      offerId: opts?.offerId ?? (packet as any).offer_id ?? undefined,
      enrollmentStart: opts?.enrollmentStart ?? undefined,
      enrollmentEnd: opts?.enrollmentEnd ?? undefined,
      evidencePriorities,
    });

    // 2. Get the latest letter text
    const letterText = packet.defense_letter_text || '';

    // Resolve client name from GHL (best-effort)
    let clientName = '';
    try {
      const { ghlApi } = require('../clients/ghl.client');
      const api = await ghlApi(locationId);
      const res = await api.get(`/contacts/${contactId}`);
      const c = res.data?.contact || res.data || {};
      clientName = [c.firstName, c.lastName].filter(Boolean).join(' ');
    } catch {}

    // 3. Render the defense letter as PDF
    const letterPdfBuffer = await defenseLetterPdfService.generateLetterPdf({
      letterText,
      merchantName: merchant.business_name || '',
      clientName,
      reasonCode: packet.chargeback_reason_code || '',
      disputeAmount: packet.chargeback_amount || 0,
      disputeDate: packet.chargeback_date || '',
      caseNumber: packet.case_number || '',
      addressee: (packet as any).addressee || 'Dispute Resolution Department',
      defenseId,
      exhibits: exhibitList.exhibits,
    });

    // 4. Render the exhibits summary as PDF (transaction timeline + exhibit
    // summaries). The timeline is server-rendered from the same exhibit list the
    // letter cites, so its dates are exact regardless of what the AI letter says.
    let exhibitsPdfBuffer: Buffer | null = null;
    if (exhibitList.exhibits.length > 0) {
      const timelineRows = buildTimelineRows(exhibitList.exhibits, {
        disputeDate: packet.chargeback_date || null,
      });
      const exhibitsHtml = buildExhibitsSummaryHtml(exhibitList.exhibits, merchant.business_name || '', timelineRows);
      exhibitsPdfBuffer = await renderHtmlToPdf(exhibitsHtml);
    }

    // 5. Load the signed enrollment packet PDF from storage (AS-IS, never re-rendered)
    let enrollmentPdfBuffer: Buffer | null = null;
    if (exhibitList.enrollmentPacketPath) {
      try {
        const { buffer } = await storageService.downloadPrivateFileWithLegacy(exhibitList.enrollmentPacketPath);
        enrollmentPdfBuffer = buffer;
      } catch (err: any) {
        logger.error({ err: err.message, path: exhibitList.enrollmentPacketPath }, 'Failed to download required enrollment packet for defense bundle');
        throw new Error(`Required signed enrollment packet could not be loaded: ${err.message}`);
      }
    }

    // 6. Merge all parts via pdf-lib
    const merged = await PDFDocument.create();

    for (const buf of [letterPdfBuffer, exhibitsPdfBuffer, enrollmentPdfBuffer]) {
      if (!buf) continue;
      try {
        const src = await PDFDocument.load(buf);
        const pages = await merged.copyPages(src, src.getPageIndices());
        for (const p of pages) merged.addPage(p);
      } catch (err: any) {
        logger.warn({ err: err.message }, 'pdf-lib: failed to merge a PDF section — skipping');
      }
    }

    if (merged.getPageCount() === 0) {
      throw new Error('Defense bundle PDF generation produced no pages');
    }

    const mergedBuffer = Buffer.from(await merged.save());

    // 7. Get the latest version number for the storage key
    const { data: maxRow } = await supabase
      .from('defense_letter_versions')
      .select('version_number')
      .eq('defense_packet_id', defenseId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    const versionSuffix = maxRow?.version_number || 1;

    // 8. Upload to Supabase storage with a versioned key
    const storagePath = `defense-packets/${locationId}/${defenseId}-v${versionSuffix}.pdf`;
    const signedUrl = await storageService.uploadPrivateFile(storagePath, mergedBuffer, 'application/pdf');

    // 10. Persist paths on the defense_packets row
    await supabase.from('defense_packets')
      .update({ pdf_storage_path: storagePath, pdf_url: signedUrl })
      .eq('id', defenseId);

    logger.info({
      defenseId,
      storagePath,
      size: mergedBuffer.length,
      pages: merged.getPageCount(),
      exhibitCount: exhibitList.exhibits.length,
    }, 'Defense bundle PDF generated and stored');

    return signedUrl;
  },
};

// ── Exhibits summary HTML (lightweight; lists each exhibit with its server-rendered summary) ──

function esc(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildTimelineHtml(timeline: TimelineRow[]): string {
  if (!timeline || timeline.length < 2) return '';
  const rows = timeline.map((row) => {
    const d = new Date(row.date).toLocaleDateString('en-US', { dateStyle: 'medium' });
    const emphasis = row.isMarker ? 'font-weight:700;color:#991b1b' : 'color:#374151';
    return `<tr>
      <td style="padding:4px 10px;border-bottom:1px solid #e5e7eb;white-space:nowrap;font-size:11px;color:#6b7280">${esc(d)}</td>
      <td style="padding:4px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;${emphasis}">${esc(row.label)}</td>
      <td style="padding:4px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;color:#6b7280;white-space:nowrap">${row.exhibitLetter ? `Exhibit ${esc(row.exhibitLetter)}` : ''}</td>
    </tr>`;
  }).join('');

  return `<div style="margin-bottom:20px">
  <h2 style="font-size:14px;font-weight:700;margin:0 0 8px">Transaction Timeline</h2>
  <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb">
    <thead><tr style="background:#f9fafb">
      <th style="text-align:left;padding:5px 10px;font-size:11px;color:#6b7280">Date</th>
      <th style="text-align:left;padding:5px 10px;font-size:11px;color:#6b7280">Event</th>
      <th style="text-align:left;padding:5px 10px;font-size:11px;color:#6b7280">Reference</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

function buildExhibitsSummaryHtml(exhibits: any[], merchantName: string, timeline: TimelineRow[] = []): string {
  const rows = exhibits.map(ex =>
    `<div style="margin-bottom:12px;padding:10px 14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px">
      <div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:4px">Exhibit ${esc(ex.letter)}: ${esc(ex.name)}</div>
      <div style="font-size:11px;color:#6b7280;margin-bottom:4px">${ex.occurredAt ? new Date(ex.occurredAt).toLocaleDateString('en-US', { dateStyle: 'long' }) : ''} - ${esc(ex.category)}</div>
      <div style="font-size:12px;color:#374151;line-height:1.5">${esc(ex.summary)}</div>
    </div>`,
  ).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1f2937; font-size: 12px; margin: 0; padding: 0; }
  .header { text-align: center; margin-bottom: 16px; padding-bottom: 10px; border-bottom: 2px solid #111827; }
  h1 { font-size: 18px; font-weight: 700; margin: 0 0 4px; }
  .subtitle { color: #6b7280; font-size: 11px; }
</style></head>
<body>
<div class="header">
  <h1>Evidence Exhibits</h1>
  <div class="subtitle">${esc(merchantName)} — ${exhibits.length} exhibits</div>
</div>
${buildTimelineHtml(timeline)}
${rows}
</body>
</html>`;
}
