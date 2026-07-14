import { getSupabase } from '../clients/supabase.client';
import { enrollmentRepository } from '../repositories/enrollment.repository';
import { offerRepository, OfferRecord } from '../repositories/offer.repository';
import { merchantService } from './merchant.service';
import { renderHtmlToPdf } from './pdf-renderer.service';
import { storageService } from './storage.service';
import { logger } from '../utils/logger';

interface PacketData {
  enrollment: Record<string, any>;
  offer: OfferRecord | null;
  merchant: { businessName: string; supportEmail: string; logoUrl: string };
  evidence: any[];
}

export const enrollmentPacketService = {
  /**
   * Generate an enrollment packet PDF. Returns the PDF buffer.
   */
  async generatePacket(enrollmentId: string, locationId: string): Promise<Buffer> {
    // Gather all data
    const enrollment = await enrollmentRepository.getById(enrollmentId, locationId);
    const offer = enrollment.offer_id ? await offerRepository.findById(enrollment.offer_id, locationId) : null;

    let merchant = { businessName: '', supportEmail: '', logoUrl: '' };
    try {
      const config = await merchantService.getFullConfig(locationId);
      merchant = {
        businessName: config.businessName || '',
        supportEmail: config.supportEmail || '',
        logoUrl: config.logoUrl || '',
      };
    } catch {
      logger.warn({ locationId }, 'Could not fetch merchant config for enrollment packet');
    }

    // Fetch evidence for this enrollment
    const supabase = getSupabase();
    const { data: evidence } = await supabase
      .from('evidence')
      .select('evidence_type, data, created_at, ip_address, device_info')
      .eq('enrollment_id', enrollmentId)
      .order('created_at', { ascending: true });

    const html = buildEnrollmentPacketHtml(
      { enrollment: enrollment as any, offer, merchant, evidence: evidence || [] },
    );

    return await renderHtmlToPdf(html);
  },

  /**
   * Generate and store the packet in Supabase Storage.
   * Returns the signed URL.
   */
  async generateAndStore(enrollmentId: string, locationId: string): Promise<string> {
    logger.info({ enrollmentId, locationId }, 'PACKET: generateAndStore starting');

    const buffer = await this.generatePacket(enrollmentId, locationId);
    logger.info({ enrollmentId, bufferSize: buffer.length }, 'PACKET: PDF buffer generated');

    const storagePath = `enrollment-packets/${locationId}/${enrollmentId}.pdf`;

    const supabase = getSupabase();
    const signedUrl = await storageService.uploadPrivateFile(storagePath, buffer, 'application/pdf');

    // Save path to enrollment record
    await supabase
      .from('enrollments')
      .update({ packet_pdf_path: storagePath })
      .eq('id', enrollmentId);

    logger.info({ enrollmentId, locationId, storagePath }, 'Enrollment packet PDF generated and stored');
    return signedUrl || storagePath;
  },
};

// ─── HTML template builder ─────────────────────────────────────

function buildEnrollmentPacketHtml(data: PacketData): string {
  const { enrollment: e, offer, merchant, evidence } = data;

  const enrollDate = e.enrolled_at
    ? new Date(e.enrolled_at).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Chicago' })
    : 'N/A';
  const consentDate = e.consent_captured_at
    ? new Date(e.consent_captured_at).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'long', timeZone: 'America/Chicago' })
    : 'N/A';
  const clientName = [e.first_name, e.last_name].filter(Boolean).join(' ') || e.digital_signature || e.email || 'N/A';

  // Parse device info
  let deviceDisplay = 'N/A';
  try {
    const d = typeof e.consent_device === 'string' ? JSON.parse(e.consent_device) : e.consent_device;
    if (d) {
      const parts: string[] = [];
      if (d.userAgent) {
        const ua = d.userAgent;
        if (ua.includes('Chrome')) parts.push('Chrome');
        else if (ua.includes('Firefox')) parts.push('Firefox');
        else if (ua.includes('Safari')) parts.push('Safari');
        else parts.push('Browser');
        if (ua.includes('Windows')) parts.push('Windows');
        else if (ua.includes('Mac')) parts.push('macOS');
        else if (ua.includes('Linux')) parts.push('Linux');
      }
      if (d.screenResolution) parts.push(d.screenResolution);
      if (d.timezone) parts.push(d.timezone);
      // Plain ASCII separator: the middle dot renders as "?"/replacement glyphs
      // in some PDF font subsets, which reads as sloppy evidence to a reviewer.
      deviceDisplay = parts.join(' - ') || 'N/A';
    }
  } catch { /* ignore parse errors */ }

  // Build milestones with full detail (name, deliverables, client responsibility)
  const milestones: Array<{ name: string; delivers: string; clientDoes: string }> = [];
  if (offer) {
    for (let i = 1; i <= 8; i++) {
      const name = (offer as any)[`m${i}_name`];
      if (name) milestones.push({
        name,
        delivers: (offer as any)[`m${i}_delivers`] || '',
        clientDoes: (offer as any)[`m${i}_client_does`] || '',
      });
    }
  }

  // Build clauses
  const clauseItems: string[] = [];
  const acceptedSet = new Set((e.clauses_accepted || []).filter(Boolean));
  if (offer) {
    for (let i = 1; i <= 11; i++) {
      const title = (offer as any)[`clause_slot_${i}_title`];
      if (title) {
        const accepted = acceptedSet.has(`clause_${i}`);
        clauseItems.push(`<tr>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${accepted ? '✓' : '—'}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb"><strong>${esc(title)}</strong><br><span style="color:#6b7280;font-size:11px">${esc((offer as any)[`clause_slot_${i}_text`] || '')}</span></td>
        </tr>`);
      }
    }
  }

  // Determine if this is an installment enrollment
  const isInstallment = e.payment_type === 'installment' ||
    (offer?.payment_type === 'installment' && offer?.installment_amount && e.payment_amount < (offer?.price || 0));

  // Price: total program cost
  let displayPrice = (offer?.price || 0);
  if (!isInstallment && offer?.pif_discount_enabled && offer?.pif_price) {
    displayPrice = offer.pif_price;
  }

  // Payment structure: human-readable
  let paymentStructure = '';
  if (isInstallment && offer?.installment_amount) {
    paymentStructure = `Installment Plan — ${offer.num_payments || '?'} ${offer.installment_frequency || 'monthly'} payments of $${offer.installment_amount.toFixed(2)}`;
  } else {
    paymentStructure = 'Paid in Full';
    if (offer?.pif_discount_enabled && offer?.pif_price && offer?.price && offer.pif_price < offer.price) {
      paymentStructure += ` (discounted from $${offer.price.toFixed(2)})`;
    }
  }

  // Payment type: human-readable
  function humanPaymentType(t: string): string {
    if (!t) return 'N/A';
    if (t === 'pif') return 'Paid in Full';
    if (t === 'installment') return 'Installment Plan';
    return t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, ' ');
  }

  // Installment payment details for section 5
  const totalProgramCost = offer?.price || 0;
  const remainingBalance = isInstallment ? Math.max(0, totalProgramCost - (e.payment_amount || 0)) : 0;
  const selectedCheckoutItems = Array.isArray(e.selected_checkout_items) ? e.selected_checkout_items : [];
  const pricingAdjustment = selectedCheckoutItems.find((item: any) => item?.type === 'dual_pricing_adjustment');
  const pricingSnapshot = pricingAdjustment?.pricing || null;
  const selectedPaymentMethod = e.initial_payment_method || pricingSnapshot?.selectedPaymentMethod || '';
  const selectedItemRows = selectedCheckoutItems.map((item: any) => {
    const amount = Number.isFinite(Number(item?.amount))
      ? Number(item.amount)
      : Number(item?.amountCents || 0) / 100;
    return `<tr><td>${esc(item?.label || item?.type || 'Checkout item')}</td><td>$${amount.toFixed(2)}</td></tr>`;
  }).join('');
  const dualPricingRows = pricingSnapshot ? `
  <tr><td>Bank Transfer Price Shown</td><td>$${(Number(pricingSnapshot.achAmountCents || 0) / 100).toFixed(2)}</td></tr>
  <tr><td>Card Price Shown</td><td>$${(Number(pricingSnapshot.cardAmountCents || 0) / 100).toFixed(2)}</td></tr>
  <tr><td>Selected Payment Method</td><td>${esc(selectedPaymentMethod === 'ach' ? 'Bank Transfer' : 'Card')}</td></tr>` : '';

  const logoHtml = merchant.logoUrl
    ? `<img src="${esc(merchant.logoUrl)}" style="max-width:150px;max-height:60px;margin-bottom:8px" /><br>`
    : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1f2937; font-size: 12px; line-height: 1.45; margin: 0; padding: 0; }
  h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; color: #111827; }
  h2 { font-size: 15px; font-weight: 600; color: #374151; border-bottom: 2px solid #e5e7eb; padding-bottom: 3px; margin: 16px 0 8px; }
  .subtitle { color: #6b7280; font-size: 11px; margin-bottom: 20px; }
  .header { text-align: center; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid #111827; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  .info-table { width: 100%; table-layout: fixed; }
  .info-table td { padding: 3px 0; vertical-align: top; }
  .info-table td:first-child { color: #6b7280; width: 180px; font-size: 12px; }
  .info-table td:last-child { font-weight: 500; }
  /* Long unbroken values (T&C version hash, processor transaction IDs) must wrap
     inside their cell — overflow shifts values visually onto neighboring rows,
     which reads as tampered/sloppy evidence to a bank reviewer. */
  .info-table code { word-break: break-all; white-space: normal; }
  .info-table td:last-child { word-break: break-word; }
  .clause-table { border: 1px solid #e5e7eb; border-radius: 4px; }
  .clause-table th { background: #f9fafb; padding: 8px 10px; text-align: left; font-size: 12px; border-bottom: 1px solid #e5e7eb; }
  .footer { margin-top: 16px; padding-top: 8px; border-top: 1px solid #d1d5db; font-size: 10px; color: #9ca3af; text-align: center; }
  .tc-html { background: #f9fafb; border: 1px solid #e5e7eb; padding: 12px 16px; border-radius: 4px; font-size: 11px; line-height: 1.6; max-height: none; }
  .evidence-row td { padding: 5px 8px; border-bottom: 1px solid #f3f4f6; font-size: 12px; }
</style></head>
<body>

<div class="header">
  ${logoHtml}
  <div style="font-size:14px;font-weight:600;color:#374151">${esc(merchant.businessName)}</div>
  <h1>Enrollment Packet</h1>
  <div class="subtitle">Generated ${new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })} — This document is a frozen record of the enrollment agreement</div>
  <div style="font-size:10px;color:#9ca3af;margin-top:2px">Document Ref: EP-${esc(e.id?.slice(0, 8) || 'N/A')}</div>
</div>

<h2>1. Client Information</h2>
<table class="info-table">
  <tr><td>Name</td><td>${esc(clientName)}</td></tr>
  <tr><td>Email</td><td>${esc(e.email || 'N/A')}</td></tr>
  <tr><td>Enrollment Date</td><td>${enrollDate}</td></tr>
  <tr><td>Digital Signature</td><td><em>"${esc(e.digital_signature || 'N/A')}"</em></td></tr>
</table>

<h2>2. Program Details</h2>
<table class="info-table">
  <tr><td>Program</td><td>${esc(offer?.offer_name || 'N/A')}</td></tr>
  ${offer?.program_description ? `<tr><td>Description</td><td>${esc(offer.program_description)}</td></tr>` : ''}
  <tr><td>Delivery Method</td><td>${esc(offer?.delivery_method || 'N/A')}</td></tr>
  <tr><td>Price</td><td>$${displayPrice.toFixed(2)}</td></tr>
  <tr><td>Payment Structure</td><td>${esc(paymentStructure)}</td></tr>
  ${offer?.program_duration_value ? `<tr><td>Duration</td><td>${offer.program_duration_value} ${offer.program_duration_unit || ''}</td></tr>` : ''}
  <tr><td>Refund Policy</td><td>${esc(offer?.refund_window_text || 'See terms below')}</td></tr>
</table>
${milestones.length > 0 ? `
<div style="margin-top:12px">
  <strong style="font-size:13px">Program Milestones</strong>
  <p style="font-size:11px;color:#6b7280;margin:4px 0 8px">The following program milestones were presented to the client during enrollment and individually acknowledged via clickwrap consent. Each milestone documents both the services to be delivered and the client's agreed responsibilities.</p>
  ${milestones.map((m, i) => `<div style="margin-bottom:10px;padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:4px">
    <strong style="font-size:12px">${i + 1}. ${esc(m.name)}</strong>
    ${m.delivers ? `<div style="font-size:11px;margin-top:4px"><span style="color:#6b7280">Deliverables:</span> ${esc(m.delivers)}</div>` : ''}
    ${m.clientDoes ? `<div style="font-size:11px;margin-top:2px"><span style="color:#6b7280">Client Responsibility:</span> ${esc(m.clientDoes)}</div>` : ''}
  </div>`).join('')}
</div>` : ''}

<h2>3. Terms & Conditions</h2>
${(offer as any)?.tc_url
    ? `<p style="font-size:12px;line-height:1.5">The client reviewed and accepted the Terms &amp; Conditions document available at: <a href="${esc((offer as any).tc_url)}" style="color:#3b82f6">${esc((offer as any).tc_url)}</a></p>`
    : `<p style="font-size:12px;line-height:1.5">The client reviewed and accepted the Terms &amp; Conditions compiled from the clauses detailed in the Individual Clause Acceptance section below.</p>`}
<p style="font-size:11px;color:#6b7280;margin-top:4px">The T&amp;C version hash (shown in Section 4 — Consent Forensics) can be used to verify the exact version of the terms presented at the time of enrollment.</p>
${clauseItems.length > 0 ? `
<div style="margin-top:12px">
  <strong style="font-size:12px">Individual Clause Acceptance</strong>
  <p style="font-size:11px;color:#374151;margin:6px 0 8px;line-height:1.5">The following clauses were individually presented to the client during the enrollment process. Each clause required separate review and active acknowledgment before the client could proceed. Checked clauses below were individually accepted by the client.</p>
  <table class="clause-table" style="margin-top:4px"><thead><tr><th style="width:30px">✓</th><th>Clause</th></tr></thead><tbody>${clauseItems.join('')}</tbody></table>
  <p style="font-size:11px;color:#374151;margin:8px 0 0;line-height:1.5">In addition to the individual clauses above, the client scrolled through the full terms document (scroll depth: ${e.scroll_depth != null ? e.scroll_depth + '%' : 'N/A'}) and provided their digital signature to confirm acceptance.</p>
</div>` : ''}

<h2>4. Consent Forensics</h2>
<table class="info-table">
  <tr><td>Consent Timestamp</td><td>${consentDate}</td></tr>
  <tr><td>IP Address</td><td>${esc(e.consent_ip || 'N/A')}</td></tr>
  <tr><td>Device / Browser</td><td>${esc(deviceDisplay)}</td></tr>
  <tr><td>T&C Version Hash</td><td><code style="font-size:10px;background:#f3f4f6;padding:2px 4px;border-radius:2px">${esc(e.tc_version_hash || 'N/A')}</code></td></tr>
  <tr><td>Scroll Depth</td><td>${e.scroll_depth != null ? e.scroll_depth + '%' : 'N/A'}</td></tr>
  <tr><td>Digital Signature</td><td><em>"${esc(e.digital_signature || 'N/A')}"</em></td></tr>
</table>

<h2>5. Payment Confirmation</h2>
<table class="info-table">
  <tr><td>${isInstallment ? 'Amount Paid (this payment)' : 'Amount Paid'}</td><td>$${(e.payment_amount || 0).toFixed(2)}</td></tr>
  ${dualPricingRows}
  ${selectedItemRows}
  ${isInstallment ? `<tr><td>Total Program Cost</td><td>$${totalProgramCost.toFixed(2)}</td></tr>
  <tr><td>Payment Schedule</td><td>${offer?.num_payments || '?'} ${offer?.installment_frequency || 'monthly'} payments of $${(offer?.installment_amount || 0).toFixed(2)}</td></tr>
  <tr><td>Remaining Balance</td><td>$${remainingBalance.toFixed(2)}</td></tr>` : ''}
  <tr><td>Payment Type</td><td>${esc(humanPaymentType(e.payment_type || ''))}</td></tr>
  <tr><td>Transaction ID</td><td><code style="font-size:10px;background:#f3f4f6;padding:2px 4px;border-radius:2px">${esc(e.payment_transaction_id || 'N/A')}</code></td></tr>
  <tr><td>Enrolled At</td><td>${enrollDate}</td></tr>
</table>

<div class="footer">
  This document is a system-generated record of the enrollment agreement as captured at the time of acceptance.
</div>

</body>
</html>`;
}

function esc(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
