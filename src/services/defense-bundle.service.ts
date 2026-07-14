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
      paymentEventId?: string | null;
      scopeConfidence?: string;
      offerId?: string | null;
      offerName?: string | null;
      enrollmentStart?: string | null;
      enrollmentEnd?: string | null;
    },
  ): Promise<string> {
    const supabase = getSupabase();
    const packet = await defenseRepository.getById(defenseId, locationId);
    const merchant = await merchantRepository.getByLocationId(locationId);
    const { data: letterVersion, error: letterVersionError } = await supabase
      .from('defense_letter_versions')
      .select('version_number, letter_text')
      .eq('defense_packet_id', defenseId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (letterVersionError) throw letterVersionError;
    if (!letterVersion || typeof letterVersion.letter_text !== 'string' || !letterVersion.letter_text.trim()) {
      throw new Error('Defense bundle requires a saved letter version');
    }

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
      paymentEventId: opts?.paymentEventId ?? packet.payment_event_id ?? undefined,
      scopeConfidence: opts?.scopeConfidence,
      offerId: opts?.offerId ?? (packet as any).offer_id ?? undefined,
      offerName: opts?.offerName ?? (packet as any).evidence_snapshot?.scope?.offerName ?? undefined,
      enrollmentStart: opts?.enrollmentStart ?? undefined,
      enrollmentEnd: opts?.enrollmentEnd ?? undefined,
      evidencePriorities,
    });

    // 2. Render the immutable version row, never the mutable packet mirror.
    const letterText = letterVersion.letter_text;

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
        transactionDate: (packet as any).evidence_snapshot?.scope?.transactionDate || null,
        disputeDate: packet.chargeback_date || null,
      });
      const exhibitsHtml = buildExhibitsSummaryHtml(exhibitList.exhibits, merchant.business_name || '', timelineRows);
      exhibitsPdfBuffer = await renderHtmlToPdf(exhibitsHtml);
    }

    const externalAttachmentBuffers = await buildExternalAttachmentPdfs(exhibitList.exhibits, locationId);

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

    const appendPdf = async (buf: Buffer | null, label: string, required: boolean) => {
      if (!buf) {
        if (required) throw new Error(`Required defense PDF section is missing: ${label}`);
        return;
      }
      try {
        const src = await PDFDocument.load(buf);
        const pages = await merged.copyPages(src, src.getPageIndices());
        for (const p of pages) merged.addPage(p);
      } catch (err: any) {
        if (required) throw new Error(`Required defense PDF section could not be merged (${label}): ${err.message}`);
        logger.warn({ err: err.message, label }, 'pdf-lib: optional PDF section could not be merged');
      }
    };

    await appendPdf(letterPdfBuffer, 'defense letter', true);
    await appendPdf(exhibitsPdfBuffer, 'exhibit summary', exhibitList.exhibits.length > 0);
    for (let index = 0; index < externalAttachmentBuffers.length; index += 1) {
      await appendPdf(externalAttachmentBuffers[index], `external attachment ${index + 1}`, false);
    }
    await appendPdf(enrollmentPdfBuffer, 'signed enrollment packet', Boolean(exhibitList.enrollmentPacketPath));

    if (merged.getPageCount() === 0) {
      throw new Error('Defense bundle PDF generation produced no pages');
    }

    const mergedBuffer = Buffer.from(await merged.save());

    // 7. Upload with the same immutable version number that supplied the text.
    const storagePath = `defense-packets/${locationId}/${defenseId}-v${letterVersion.version_number}.pdf`;
    const signedUrl = await storageService.uploadPrivateFile(storagePath, mergedBuffer, 'application/pdf');

    // 10. Persist paths on the defense_packets row
    const { data: updatedPacket, error: packetUpdateError } = await supabase.from('defense_packets')
      .update({ pdf_storage_path: storagePath, pdf_url: signedUrl })
      .eq('id', defenseId)
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .select('id')
      .maybeSingle();
    if (packetUpdateError) throw packetUpdateError;
    if (!updatedPacket) throw new Error('Defense packet PDF path was not persisted');

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

async function buildExternalAttachmentPdfs(exhibits: any[], locationId: string): Promise<Buffer[]> {
  const seen = new Set<string>();
  const attachments: any[] = [];
  for (const exhibit of exhibits) {
    const rows = exhibit?.meta?.defenseMetadata?.connector?.attachments;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row?.storagePath || seen.has(row.storagePath)) continue;
      if (!String(row.storagePath).startsWith(`external-evidence/${locationId}/`)) continue;
      seen.add(row.storagePath);
      attachments.push(row);
      if (attachments.length >= 20) break;
    }
    if (attachments.length >= 20) break;
  }

  const output: Buffer[] = [];
  for (const attachment of attachments) {
    try {
      const { buffer } = await storageService.downloadPrivateFileWithLegacy(attachment.storagePath);
      const contentType = String(attachment.contentType || '').toLowerCase();
      if (contentType === 'application/pdf') {
        await PDFDocument.load(buffer);
        output.push(buffer);
        continue;
      }
      if (contentType === 'image/png' || contentType === 'image/jpeg') {
        const doc = await PDFDocument.create();
        const image = contentType === 'image/png' ? await doc.embedPng(buffer) : await doc.embedJpg(buffer);
        const page = doc.addPage([612, 792]);
        const scale = Math.min(540 / image.width, 700 / image.height, 1);
        const width = image.width * scale;
        const height = image.height * scale;
        page.drawImage(image, { x: (612 - width) / 2, y: (792 - height) / 2, width, height });
        output.push(Buffer.from(await doc.save()));
        continue;
      }
      if (contentType === 'text/plain' || contentType === 'text/csv') {
        const body = esc(buffer.toString('utf8').slice(0, 100_000));
        output.push(await renderHtmlToPdf(`<!doctype html><html><body><h2>${esc(attachment.filename || 'External evidence attachment')}</h2><pre style="white-space:pre-wrap;font:10px monospace">${body}</pre></body></html>`));
      }
    } catch (err: any) {
      logger.warn({ err: err.message, storagePath: attachment.storagePath }, 'Validated connector attachment could not be added to defense bundle');
    }
  }
  return output;
}

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
