import { Router, Request, Response } from 'express';
import { merchantRepository } from '../repositories/merchant.repository';
import { merchantService } from '../services/merchant.service';
import { logger } from '../utils/logger';

const router = Router();

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

router.get('/:locationId', async (req: Request, res: Response) => {
  try {
    const locationId = req.params.locationId;
    const merchant = await merchantRepository.findByLocationId(locationId);

    if (!merchant) {
      res.status(404).send(termsPageHtml('Terms Not Available', '<p>This merchant could not be found.</p>', ''));
      return;
    }

    const config = await merchantService.getFullConfig(locationId);

    // Priority 1: External URL redirect
    if (config.tcHasOwn && config.tcDocumentUrl) {
      res.redirect(config.tcDocumentUrl);
      return;
    }

    // Priority 2: Custom pasted terms
    if ((config as any).tcCustomHtml) {
      res.send(termsPageHtml(
        'Terms & Conditions',
        (config as any).tcCustomHtml,
        config.businessName || merchant.business_name || '',
      ));
      return;
    }

    // Priority 3: Default ScaleSafe terms template
    res.send(termsPageHtml(
      'Terms & Conditions',
      defaultTermsHtml(config.businessName || merchant.business_name || ''),
      config.businessName || merchant.business_name || '',
    ));
  } catch (err) {
    logger.error({ err }, 'Terms page error');
    res.status(500).send(termsPageHtml('Error', '<p>Unable to load terms. Please try again later.</p>', ''));
  }
});

function termsPageHtml(title: string, bodyHtml: string, merchantName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}${merchantName ? ' — ' + esc(merchantName) : ''}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #fff;
      color: #1f2937;
      line-height: 1.7;
      padding: 40px 20px;
    }
    .container { max-width: 720px; margin: 0 auto; }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
    .merchant-name { color: #6b7280; font-size: 15px; margin-bottom: 32px; }
    .terms-body { font-size: 15px; }
    .terms-body h2, .terms-body h3 { margin: 24px 0 12px; }
    .terms-body p { margin-bottom: 12px; }
    .terms-body ol, .terms-body ul { padding-left: 24px; margin: 12px 0; }
    .terms-body li { margin-bottom: 8px; }
    .footer { margin-top: 48px; padding-top: 24px; border-top: 1px solid #e5e7eb; font-size: 13px; color: #9ca3af; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${esc(title)}</h1>
    ${merchantName ? '<p class="merchant-name">' + esc(merchantName) + '</p>' : ''}
    <div class="terms-body">${bodyHtml}</div>
    <div class="footer">Powered by ScaleSafe</div>
  </div>
</body>
</html>`;
}

function defaultTermsHtml(businessName: string): string {
  const biz = businessName || 'the Service Provider';
  return `
<h2>1. Services</h2>
<p>${esc(biz)} agrees to provide the services as described in the specific offer or program you are enrolling in. The scope, deliverables, and timeline for your program are outlined on the offer review page presented during enrollment.</p>

<h2>2. Payment Terms</h2>
<p>By completing enrollment, you authorize ${esc(biz)} to charge the payment method provided for the amount specified in your selected offer. If you selected an installment plan, you authorize recurring charges according to the schedule presented at checkout.</p>

<h2>3. Refund Policy</h2>
<p>The refund policy specific to your program is displayed on the offer review page. By proceeding with enrollment, you acknowledge that you have reviewed and agree to the applicable refund terms.</p>

<h2>4. Client Responsibilities</h2>
<p>You agree to participate in good faith in the program, complete assigned tasks and milestones, and communicate promptly with ${esc(biz)} regarding any concerns or issues.</p>

<h2>5. Intellectual Property</h2>
<p>All course materials, frameworks, templates, and proprietary content provided by ${esc(biz)} remain the intellectual property of ${esc(biz)}. You are granted a personal, non-transferable license to use these materials for the duration of your program.</p>

<h2>6. Limitation of Liability</h2>
<p>${esc(biz)} provides services on a best-effort basis. Results may vary based on individual circumstances, effort, and market conditions. ${esc(biz)} does not guarantee specific outcomes or results.</p>

<h2>7. Dispute Resolution</h2>
<p>In the event of a dispute, both parties agree to attempt resolution through direct communication before pursuing any formal dispute process. If you have concerns about services rendered, please contact ${esc(biz)} directly using the contact information provided during enrollment.</p>

<h2>8. Electronic Consent</h2>
<p>By providing your electronic signature during enrollment, you confirm that you have read and agree to these terms, that you are authorized to make the payment, and that you understand the services being provided.</p>

<h2>9. Modifications</h2>
<p>${esc(biz)} reserves the right to update these terms. Any changes to terms affecting your active enrollment will be communicated to you directly.</p>
`;
}

export default router;
