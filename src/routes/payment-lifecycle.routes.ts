import { Router, Request, Response, NextFunction } from 'express';
import { ssoAuth } from '../middleware/ssoAuth';
import { requireTenant, resolveLocationId } from '../middleware/tenantContext';
import { paymentLifecycleService } from '../services/payment-lifecycle.service';
import { merchantRepository } from '../repositories/merchant.repository';
import { ValidationError } from '../utils/errors';
import { getSupabase } from '../clients/supabase.client';

const router = Router();

router.use(ssoAuth, requireTenant);

const ENROLLMENT_LIFECYCLE_COLUMNS = 'id, contact_id, offer_id, processor_subscription_id, processor_config_id, whop_membership_id, processor_type, status, payment_type, payments_made, payments_total, billing_completed_at, next_billing_date' as const;

function processorCancellationRequired(enrollment: any): boolean {
  const processorReference = enrollment.processor_subscription_id || enrollment.whop_membership_id;
  if (!processorReference) return false;

  // A Whop membership also controls access, so cancelling the enrollment must
  // continue through Whop even after its payment schedule has finished.
  if (String(enrollment.processor_type || '').toLowerCase() === 'whop') return true;

  const paymentType = String(enrollment.payment_type || '').toLowerCase();
  const paymentsMade = Number(enrollment.payments_made);
  const paymentsTotal = Number(enrollment.payments_total);
  const finitePlanPaid = paymentType !== 'subscription'
    && Number.isFinite(paymentsMade)
    && Number.isFinite(paymentsTotal)
    && paymentsTotal > 0
    && paymentsMade >= paymentsTotal
    && !enrollment.next_billing_date;

  return !(enrollment.billing_completed_at || finitePlanPaid);
}

async function getEnrollmentForLifecycleAction(
  locationId: string,
  enrollmentId: string,
  contactId?: string,
  allowedStatuses: string[] = [],
) {
  let query = getSupabase()
    .from('enrollments')
    .select(ENROLLMENT_LIFECYCLE_COLUMNS)
    .eq('id', enrollmentId)
    .eq('location_id', locationId);

  if (contactId) {
    query = query.eq('contact_id', contactId);
  }
  if (allowedStatuses.length > 0) {
    query = query.in('status', allowedStatuses);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw new ValidationError('Enrollment not found');
  return data;
}

// ─── Subscription Management ────────────────────────────────────

router.post('/subscription/pause', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = resolveLocationId(req);
    if (!locationId) throw new ValidationError('locationId required');
    const merchant = await merchantRepository.getByLocationId(locationId);
    const { enrollmentId, contactId, reason } = req.body;
    if (!enrollmentId) throw new ValidationError('enrollmentId required');
    const enrollment = await getEnrollmentForLifecycleAction(locationId, enrollmentId, contactId, ['enrolled', 'active']);

    await paymentLifecycleService.pauseSubscription({
      merchantId: merchant.id, locationId, contactId: enrollment.contact_id,
      offerId: enrollment.offer_id || '', reason: reason || 'Merchant-initiated pause',
      enrollmentId: enrollment.id,
      processorSubscriptionId: enrollment.processor_subscription_id || enrollment.whop_membership_id || undefined,
      processorType: enrollment.processor_type || undefined,
      processorConfigId: enrollment.processor_config_id || undefined,
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.post('/subscription/resume', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = resolveLocationId(req);
    if (!locationId) throw new ValidationError('locationId required');
    const merchant = await merchantRepository.getByLocationId(locationId);
    const { enrollmentId, contactId } = req.body;
    if (!enrollmentId) throw new ValidationError('enrollmentId required');
    const enrollment = await getEnrollmentForLifecycleAction(locationId, enrollmentId, contactId, ['paused']);

    await paymentLifecycleService.resumeSubscription({
      merchantId: merchant.id, locationId, contactId: enrollment.contact_id,
      offerId: enrollment.offer_id || '', reason: 'Merchant-initiated resume',
      enrollmentId: enrollment.id,
      processorSubscriptionId: enrollment.processor_subscription_id || enrollment.whop_membership_id || undefined,
      processorType: enrollment.processor_type || undefined,
      processorConfigId: enrollment.processor_config_id || undefined,
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.post('/subscription/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = resolveLocationId(req);
    if (!locationId) throw new ValidationError('locationId required');
    const merchant = await merchantRepository.getByLocationId(locationId);
    const { enrollmentId, contactId, reason } = req.body;
    if (!enrollmentId) throw new ValidationError('enrollmentId required');
    const enrollment = await getEnrollmentForLifecycleAction(locationId, enrollmentId, contactId, ['enrolled', 'active', 'paused']);

    await paymentLifecycleService.cancelSubscription({
      merchantId: merchant.id, locationId, contactId: enrollment.contact_id,
      offerId: enrollment.offer_id || '', reason: reason || 'Merchant-initiated cancellation',
      enrollmentId: enrollment.id,
      processorSubscriptionId: enrollment.processor_subscription_id || enrollment.whop_membership_id || undefined,
      processorType: enrollment.processor_type || undefined,
      processorConfigId: enrollment.processor_config_id || undefined,
      processorCancellationRequired: processorCancellationRequired(enrollment),
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── Manual Enrollment Status Change ────────────────────────────

// Statuses each action may legally start from. The lookup filters on these so
// a cancelled/completed enrollment can never be re-transitioned (and a
// mismatched contactId can never act on another contact's enrollment).
const LIFECYCLE_ACTION_STATUSES: Record<string, string[]> = {
  pause: ['enrolled', 'active'],
  resume: ['paused'],
  cancel: ['enrolled', 'active', 'paused', 'past_due', 'delinquent', 'consent_captured', 'device_captured'],
  complete: ['enrolled', 'active', 'paused', 'past_due', 'delinquent'],
};

router.post('/enrollment/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = resolveLocationId(req);
    if (!locationId) throw new ValidationError('locationId required');
    const merchant = await merchantRepository.getByLocationId(locationId);
    const { enrollmentId, contactId, action, reason } = req.body;
    if (!enrollmentId || !contactId || !action) throw new ValidationError('enrollmentId, contactId, and action required');

    const allowedStatuses = LIFECYCLE_ACTION_STATUSES[action];
    if (!allowedStatuses) throw new ValidationError(`Invalid action: ${action}. Must be pause, resume, cancel, or complete`);

    const enrollment = await getEnrollmentForLifecycleAction(locationId, enrollmentId, contactId, allowedStatuses);

    const serviceParams = {
      merchantId: merchant.id,
      locationId,
      contactId: enrollment.contact_id,
      offerId: enrollment.offer_id || '',
      reason: reason || `Merchant-initiated ${action}`,
      enrollmentId: enrollment.id,
      processorSubscriptionId: enrollment.processor_subscription_id || enrollment.whop_membership_id || undefined,
      processorType: enrollment.processor_type || undefined,
      processorConfigId: enrollment.processor_config_id || undefined,
      processorCancellationRequired: processorCancellationRequired(enrollment),
    };

    switch (action) {
      case 'pause':
        await paymentLifecycleService.pauseSubscription(serviceParams);
        break;
      case 'resume':
        await paymentLifecycleService.resumeSubscription(serviceParams);
        break;
      case 'cancel':
        await paymentLifecycleService.cancelSubscription(serviceParams);
        break;
      case 'complete':
        await paymentLifecycleService.completeEnrollment(serviceParams);
        break;
    }

    res.json({ success: true, action });
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

// ─── Send Card Update Request ───────────────────────────────────

router.post('/send-card-update', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = resolveLocationId(req);
    if (!locationId) throw new ValidationError('locationId required');
    const { enrollmentId, contactId } = req.body;
    if (!enrollmentId) throw new ValidationError('enrollmentId required');
    const enrollment = await getEnrollmentForLifecycleAction(
      locationId,
      enrollmentId,
      contactId,
      ['enrolled', 'active', 'paused', 'past_due', 'delinquent'],
    );

    const sendTrigger = req.body.sendTrigger !== false;
    const result = await paymentLifecycleService.sendCardUpdateRequest(locationId, enrollment.contact_id, {
      sendTrigger,
      enrollmentId: enrollment.id,
    });
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
