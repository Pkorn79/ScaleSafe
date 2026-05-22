import { Router } from 'express';
import { ssoAuth } from '../middleware/ssoAuth';
import { requireTenant } from '../middleware/tenantContext';
import {
  searchCustomers,
  listPaymentLedger,
  getPaymentReconciliation,
  getNmiRecurringDiagnostics,
  getNmiWebhookTrace,
  syncNmiRecurringHistory,
  repairNmiRecurringPayment,
  getPaymentHistory,
  getPaymentMethods,
  chargeStoredCard,
  issueRefund,
} from '../controllers/payment-management.controller';

const router = Router();

// All payment management routes require SSO auth
router.use(ssoAuth, requireTenant);

router.get('/ledger', listPaymentLedger);
router.get('/reconciliation', getPaymentReconciliation);
router.get('/nmi-diagnostics', getNmiRecurringDiagnostics);
router.get('/nmi-webhook-trace', getNmiWebhookTrace);
router.post('/sync/nmi-recurring', syncNmiRecurringHistory);
router.post('/repair/nmi-recurring', repairNmiRecurringPayment);
router.get('/customers', searchCustomers);
router.get('/customer/:contactId', getPaymentHistory);
router.get('/customer/:contactId/methods', getPaymentMethods);
router.post('/charge', chargeStoredCard);
router.post('/refund', issueRefund);

export default router;
