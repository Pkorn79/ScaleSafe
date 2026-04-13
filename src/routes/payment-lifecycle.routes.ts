import { Router, Request, Response, NextFunction } from 'express';
import { ssoAuth } from '../middleware/ssoAuth';
import { requireTenant, resolveLocationId } from '../middleware/tenantContext';
import { paymentLifecycleService } from '../services/payment-lifecycle.service';
import { merchantRepository } from '../repositories/merchant.repository';
import { ValidationError } from '../utils/errors';

const router = Router();

router.use(ssoAuth, requireTenant);

// ─── Subscription Management ────────────────────────────────────

router.post('/subscription/pause', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = resolveLocationId(req);
    if (!locationId) throw new ValidationError('locationId required');
    const merchant = await merchantRepository.getByLocationId(locationId);
    const { contactId, offerId, reason, subscriptionId } = req.body;
    if (!contactId) throw new ValidationError('contactId required');

    await paymentLifecycleService.pauseSubscription({
      merchantId: merchant.id, locationId, contactId,
      offerId: offerId || '', reason: reason || 'Merchant-initiated pause',
      processorSubscriptionId: subscriptionId,
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.post('/subscription/resume', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = resolveLocationId(req);
    if (!locationId) throw new ValidationError('locationId required');
    const merchant = await merchantRepository.getByLocationId(locationId);
    const { contactId, offerId } = req.body;
    if (!contactId) throw new ValidationError('contactId required');

    await paymentLifecycleService.resumeSubscription({
      merchantId: merchant.id, locationId, contactId,
      offerId: offerId || '', reason: 'Merchant-initiated resume',
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.post('/subscription/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = resolveLocationId(req);
    if (!locationId) throw new ValidationError('locationId required');
    const merchant = await merchantRepository.getByLocationId(locationId);
    const { contactId, offerId, reason, subscriptionId } = req.body;
    if (!contactId) throw new ValidationError('contactId required');

    await paymentLifecycleService.cancelSubscription({
      merchantId: merchant.id, locationId, contactId,
      offerId: offerId || '', reason: reason || 'Merchant-initiated cancellation',
      processorSubscriptionId: subscriptionId,
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── Card Management ────────────────────────────────────────────

router.get('/cards/:contactId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = resolveLocationId(req);
    if (!locationId) throw new ValidationError('locationId required');
    const merchant = await merchantRepository.getByLocationId(locationId);

    const cards = await paymentLifecycleService.listCards({
      merchantId: merchant.id, locationId, contactId: req.params.contactId,
    });
    res.json({ cards });
  } catch (err) { next(err); }
});

router.delete('/cards/:contactId/:cardId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = resolveLocationId(req);
    if (!locationId) throw new ValidationError('locationId required');
    const merchant = await merchantRepository.getByLocationId(locationId);

    await paymentLifecycleService.deleteCard(
      { merchantId: merchant.id, locationId, contactId: req.params.contactId },
      req.params.cardId,
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.post('/cards/:contactId/default', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = resolveLocationId(req);
    if (!locationId) throw new ValidationError('locationId required');
    const merchant = await merchantRepository.getByLocationId(locationId);
    const { cardId } = req.body;
    if (!cardId) throw new ValidationError('cardId required');

    await paymentLifecycleService.updateDefaultCard(
      { merchantId: merchant.id, locationId, contactId: req.params.contactId },
      cardId,
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── Dunning ────────────────────────────────────────────────────

router.post('/dunning/retry', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = resolveLocationId(req);
    if (!locationId) throw new ValidationError('locationId required');
    const merchant = await merchantRepository.getByLocationId(locationId);
    const { contactId, paymentEventId } = req.body;
    if (!contactId || !paymentEventId) throw new ValidationError('contactId and paymentEventId required');

    const result = await paymentLifecycleService.retryPayment(
      merchant.id, locationId, contactId, paymentEventId,
    );
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
