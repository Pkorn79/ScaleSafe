import { Router, Request, Response } from 'express';
import { enrollmentController } from '../controllers/enrollment.controller';
import { offerService } from '../services/offer.service';
import { logger } from '../utils/logger';

const router = Router();

// Enrollment endpoints are PUBLIC (client-facing funnel, no SSO)
router.post('/prep', enrollmentController.prep);
router.get('/offer/:id', enrollmentController.getOffer);
router.post('/consent', enrollmentController.captureConsent);

/**
 * GET /enrollment?offerId=xxx
 * Public enrollment page — serves a standalone HTML page for clients.
 * This is NOT part of the SSO-gated merchant dashboard.
 */
router.get('/', async (req: Request, res: Response) => {
  const offerId = req.query.offerId as string;

  if (!offerId) {
    return res.status(400).send(enrollmentErrorPage('Missing offer ID', 'This enrollment link appears to be invalid. Please contact your service provider for a new link.'));
  }

  try {
    const offer = await offerService.getById(offerId);
    res.send(enrollmentPage(offer));
  } catch (err: any) {
    logger.warn({ err, offerId }, 'Enrollment page: offer not found');
    res.status(404).send(enrollmentErrorPage('Offer Not Found', 'This enrollment link may have expired or is no longer available. Please contact your service provider.'));
  }
});

function enrollmentPage(offer: any): string {
  const price = offer.price ? `$${Number(offer.price).toFixed(2)}` : '';
  const milestones = [];
  for (let i = 1; i <= 8; i++) {
    const name = offer[`m${i}_name`];
    if (name) milestones.push(name);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Enroll — ${escapeHtml(offer.offer_name)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f6fa; color: #1a1a2e; }
    .container { max-width: 600px; margin: 40px auto; padding: 0 20px; }
    .card { background: #fff; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    h1 { font-size: 24px; margin-bottom: 8px; }
    .subtitle { color: #6b7280; font-size: 15px; margin-bottom: 24px; }
    .price { font-size: 28px; font-weight: 700; color: #3b82f6; margin-bottom: 4px; }
    .payment-type { font-size: 13px; color: #6b7280; margin-bottom: 24px; }
    .section-title { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; margin-bottom: 12px; }
    .description { font-size: 14px; line-height: 1.6; color: #374151; margin-bottom: 24px; }
    .milestone-list { list-style: none; margin-bottom: 24px; }
    .milestone-list li { padding: 8px 0; border-bottom: 1px solid #f3f4f6; font-size: 14px; display: flex; align-items: center; gap: 8px; }
    .milestone-list li:last-child { border-bottom: none; }
    .milestone-dot { width: 8px; height: 8px; border-radius: 50%; background: #3b82f6; flex-shrink: 0; }
    .delivery { display: inline-block; background: #dbeafe; color: #1e40af; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 500; margin-bottom: 24px; }
    .cta { display: block; width: 100%; padding: 14px; background: #3b82f6; color: #fff; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; text-align: center; text-decoration: none; }
    .cta:hover { background: #2563eb; }
    .footer { text-align: center; margin-top: 24px; font-size: 12px; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>${escapeHtml(offer.offer_name)}</h1>
      ${offer.program_description ? `<p class="description">${escapeHtml(offer.program_description)}</p>` : ''}
      ${offer.delivery_method ? `<span class="delivery">${escapeHtml(offer.delivery_method)}</span>` : ''}
      <div class="price">${price}</div>
      <p class="payment-type">${formatPaymentType(offer)}</p>
      ${milestones.length > 0 ? `
        <p class="section-title">Program Milestones</p>
        <ul class="milestone-list">
          ${milestones.map(m => `<li><span class="milestone-dot"></span>${escapeHtml(m)}</li>`).join('')}
        </ul>
      ` : ''}
      <p class="footer">Enrollment form coming soon. Contact your service provider to get started.</p>
    </div>
    <p class="footer">Powered by ScaleSafe</p>
  </div>
</body>
</html>`;
}

function enrollmentErrorPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ScaleSafe — ${escapeHtml(title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f6fa; color: #1a1a2e; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 12px; padding: 40px; max-width: 420px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    h1 { font-size: 20px; margin-bottom: 12px; }
    p { color: #6b7280; font-size: 14px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatPaymentType(offer: any): string {
  if (offer.payment_type === 'installments' && offer.installment_amount && offer.num_payments) {
    let text = `${offer.num_payments} payments of $${Number(offer.installment_amount).toFixed(2)}`;
    if (offer.pif_discount_enabled && offer.pif_price) {
      text += ` &middot; or $${Number(offer.pif_price).toFixed(2)} paid in full`;
    }
    return text;
  }
  return 'One-time payment';
}

export default router;
