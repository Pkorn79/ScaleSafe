import PDFDocument from 'pdfkit';
import { getSupabase } from '../clients/supabase.client';
import { logger } from '../utils/logger';

interface EnrollmentPacketData {
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  enrollmentDate: string;
  offerName: string;
  price: number;
  paymentType: string;
  installmentAmount?: number;
  installmentFrequency?: string;
  numPayments?: number;
  refundPolicy: string;
  tcHtml: string;
  consentTimestamp: string;
  consentIp: string;
  consentDevice: string;
  consentBrowser: string;
  tcHash: string;
  transactionId: string;
  paymentAmount: number;
  paymentMethod: string;
  milestones: Array<{ name: string; delivers: string }>;
}

export const pdfService = {
  /**
   * Generate an Enrollment Packet PDF and upload to Supabase Storage.
   */
  async generateEnrollmentPacket(
    enrollmentId: string,
    locationId: string,
    data: EnrollmentPacketData,
  ): Promise<string> {
    const buffer = await this.buildEnrollmentPdf(data);
    const path = `enrollment-packets/${locationId}/${enrollmentId}.pdf`;
    const url = await this.uploadToStorage(path, buffer);

    // Update enrollment_packets record
    await getSupabase()
      .from('enrollment_packets')
      .update({ pdf_storage_path: path, pdf_url: url })
      .eq('id', enrollmentId);

    logger.info({ enrollmentId, locationId }, 'Enrollment packet PDF generated');
    return url;
  },

  /**
   * Generate an Evidence PDF compiling all evidence for a client.
   */
  async generateEvidencePdf(
    locationId: string,
    contactId: string,
    contactName: string,
    evidence: any[],
  ): Promise<{ buffer: Buffer; url: string }> {
    const buffer = await this.buildEvidencePdf(contactName, evidence);
    const path = `evidence-pdfs/${locationId}/${contactId}_${Date.now()}.pdf`;
    const url = await this.uploadToStorage(path, buffer);

    logger.info({ locationId, contactId, evidenceCount: evidence.length }, 'Evidence PDF generated');
    return { buffer, url };
  },

  /**
   * Generate a Defense Letter PDF.
   */
  async generateDefenseLetterPdf(
    defenseId: string,
    locationId: string,
    letterText: string,
    merchantName: string,
  ): Promise<string> {
    const buffer = await this.buildDefenseLetterPdf(letterText, merchantName);
    const path = `defense-packets/${locationId}/${defenseId}_letter.pdf`;
    const url = await this.uploadToStorage(path, buffer);

    await getSupabase()
      .from('defense_packets')
      .update({ defense_letter_url: url })
      .eq('id', defenseId);

    logger.info({ defenseId, locationId }, 'Defense letter PDF generated');
    return url;
  },

  // --- PDF builders ---

  async buildEnrollmentPdf(data: EnrollmentPacketData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(20).text('ENROLLMENT PACKET', { align: 'center' });
      doc.moveDown();
      doc.fontSize(10).text(`Generated: ${new Date().toISOString()}`, { align: 'center' });
      doc.moveDown(2);

      // Client Info
      doc.fontSize(14).text('Client Information');
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.5);
      doc.fontSize(10);
      doc.text(`Name: ${data.clientName}`);
      doc.text(`Email: ${data.clientEmail}`);
      doc.text(`Phone: ${data.clientPhone}`);
      doc.text(`Enrollment Date: ${data.enrollmentDate}`);
      doc.moveDown();

      // Offer Details
      doc.fontSize(14).text('Program Details');
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.5);
      doc.fontSize(10);
      doc.text(`Program: ${data.offerName}`);
      doc.text(`Price: $${data.price}`);
      doc.text(`Payment Type: ${data.paymentType}`);
      if (data.installmentAmount) {
        doc.text(`Installment: $${data.installmentAmount} / ${data.installmentFrequency}`);
        doc.text(`Number of Payments: ${data.numPayments}`);
      }
      doc.text(`Refund Policy: ${data.refundPolicy || 'See terms below'}`);
      doc.moveDown();

      // Milestones
      if (data.milestones.length > 0) {
        doc.fontSize(14).text('Program Milestones');
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown(0.5);
        doc.fontSize(10);
        data.milestones.forEach((m, i) => {
          doc.text(`${i + 1}. ${m.name}: ${m.delivers}`);
        });
        doc.moveDown();
      }

      // Consent Record
      doc.fontSize(14).text('Consent Record');
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.5);
      doc.fontSize(10);
      doc.text(`Consent Timestamp: ${data.consentTimestamp}`);
      doc.text(`IP Address: ${data.consentIp}`);
      doc.text(`Device: ${data.consentDevice}`);
      doc.text(`Browser: ${data.consentBrowser}`);
      doc.text(`T&C Version Hash: ${data.tcHash}`);
      doc.moveDown();

      // Payment Confirmation
      doc.fontSize(14).text('Payment Confirmation');
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.5);
      doc.fontSize(10);
      doc.text(`Transaction ID: ${data.transactionId}`);
      doc.text(`Amount: $${data.paymentAmount}`);
      doc.text(`Method: ${data.paymentMethod}`);
      doc.moveDown();

      // T&C text (stripped of HTML tags for PDF)
      doc.addPage();
      doc.fontSize(14).text('Terms & Conditions (as presented)');
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.5);
      doc.fontSize(8);
      const plainTc = data.tcHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      doc.text(plainTc, { width: 500 });

      doc.end();
    });
  },

  async buildEvidencePdf(contactName: string, evidence: any[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(20).text('EVIDENCE COMPILATION', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Client: ${contactName}`, { align: 'center' });
      doc.fontSize(10).text(`Generated: ${new Date().toISOString()}`, { align: 'center' });
      doc.fontSize(10).text(`Total Evidence Records: ${evidence.length}`, { align: 'center' });
      doc.moveDown(2);

      // Group evidence by type
      const grouped: Record<string, any[]> = {};
      for (const e of evidence) {
        const type = e.evidence_type || 'unknown';
        if (!grouped[type]) grouped[type] = [];
        grouped[type].push(e);
      }

      for (const [type, records] of Object.entries(grouped)) {
        doc.fontSize(14).text(type.replace(/_/g, ' ').toUpperCase());
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown(0.5);
        doc.fontSize(9);

        for (const r of records) {
          const date = r.event_date || r.created_at || '';
          const summary = r.summary || JSON.stringify(r.details || {}).slice(0, 200);
          doc.text(`[${date}] ${summary}`, { width: 500 });
          doc.moveDown(0.3);
        }
        doc.moveDown();
      }

      doc.end();
    });
  },

  async buildDefenseLetterPdf(letterText: string, merchantName: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 60 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(10).text(`${merchantName}`, { align: 'right' });
      doc.text(`Date: ${new Date().toLocaleDateString()}`, { align: 'right' });
      doc.moveDown(2);

      doc.fontSize(16).text('CHARGEBACK DEFENSE LETTER', { align: 'center' });
      doc.moveDown(2);

      // Parse the letter text — handle markdown-style headers
      const lines = letterText.split('\n');
      for (const line of lines) {
        if (line.startsWith('## ')) {
          doc.moveDown();
          doc.fontSize(14).text(line.replace('## ', ''));
          doc.moveTo(60, doc.y).lineTo(540, doc.y).stroke();
          doc.moveDown(0.5);
        } else if (line.startsWith('# ')) {
          doc.moveDown();
          doc.fontSize(16).text(line.replace('# ', ''));
          doc.moveDown(0.5);
        } else if (line.startsWith('- ')) {
          doc.fontSize(10).text(`  \u2022 ${line.replace('- ', '')}`, { width: 460 });
        } else if (line.trim() === '') {
          doc.moveDown(0.5);
        } else {
          doc.fontSize(10).text(line, { width: 480 });
        }
      }

      doc.end();
    });
  },

  // --- Storage ---

  async uploadToStorage(path: string, buffer: Buffer): Promise<string> {
    const supabase = getSupabase();

    const { error } = await supabase.storage
      .from('scalesafe-files')
      .upload(path, buffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (error) throw error;

    const { data: urlData } = await supabase.storage
      .from('scalesafe-files')
      .createSignedUrl(path, 60 * 60 * 24 * 365); // 1 year

    return urlData?.signedUrl || path;
  },
};
