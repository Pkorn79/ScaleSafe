import { getSupabase } from '../clients/supabase.client';
import { resolveProcessor, createProcessorClient } from './processor.factory';
import { handleRecurringPaymentSuccess, handleRecurringPaymentFailure } from './recurring-payment.service';
import { nmiDiagnosticLogService } from './nmi-diagnostic-log.service';
import { SubscriptionTransaction } from '../types/processor.types';
import { logger } from '../utils/logger';

interface NmiSyncResult {
  enrollmentId: string;
  subscriptionId: string;
  checked: number;
  imported: number;
  failedRecorded: number;
  duplicates: number;
  noNewTransactions: boolean;
  paymentEventIds: string[];
  errors: string[];
}

interface NmiDiagnosticRow {
  enrollmentId: string;
  contactId: string;
  customerName: string;
  customerEmail: string;
  programName: string;
  paymentType: string;
  status: string;
  subscriptionId: string | null;
  nextBillingDate: string | null;
  paymentsMade: number;
  paymentsTotal: number | null;
  lastScaleSafePaymentDate: string | null;
  lastScaleSafePaymentAmount: number | null;
  lastScaleSafeTransactionId: string | null;
  lastNmiPostDate: string | null;
  lastNmiPostAction: string | null;
  lastNmiPostTransactionId: string | null;
  issueCode: string;
  issueLabel: string;
}

function isRecurringType(value: unknown): boolean {
  const type = String(value || '').toLowerCase();
  return ['installment', 'installments', 'subscription'].includes(type);
}

function isActiveStatus(value: unknown): boolean {
  const status = String(value || '').toLowerCase();
  return ['enrolled', 'active', 'paused'].includes(status);
}

function isBillingComplete(enrollment: any): boolean {
  const paymentType = String(enrollment.payment_type || '').toLowerCase();
  const paymentsMade = Number(enrollment.payments_made || 0);
  const paymentsTotal = enrollment.payments_total == null ? null : Number(enrollment.payments_total);
  return Boolean(enrollment.billing_completed_at)
    || (paymentType !== 'subscription' && paymentsTotal != null && paymentsTotal > 0 && paymentsMade >= paymentsTotal);
}

function displayName(enrollment: any): string {
  const first = String(enrollment?.first_name || '').trim();
  const last = String(enrollment?.last_name || '').trim();
  const full = [first, last].filter(Boolean).join(' ').trim();
  return full || enrollment?.digital_signature || enrollment?.email || String(enrollment?.contact_id || '').slice(0, 12) || 'Unknown client';
}

function isApprovedRecurring(tx: SubscriptionTransaction): boolean {
  const pendingSettlement = tx.status === 'pending'
    && String(tx.providerStatus || '').toLowerCase() === 'pendingsettlement';
  return tx.amount > 0 && tx.success && (tx.status === 'settled' || pendingSettlement);
}

function isFailedRecurring(tx: SubscriptionTransaction): boolean {
  return tx.amount > 0 && (!tx.success || tx.status === 'failed');
}

function sortTransactions(transactions: SubscriptionTransaction[]): SubscriptionTransaction[] {
  return [...transactions].sort((a, b) => String(a.occurredAt || '').localeCompare(String(b.occurredAt || '')));
}

function issueForDiagnostic(row: {
  enrollment: any;
  lastPayment: any | null;
  lastLog: any | null;
}): { issueCode: string; issueLabel: string } {
  const { enrollment, lastPayment, lastLog } = row;
  if (!enrollment.processor_subscription_id) {
    return { issueCode: 'missing_subscription_id', issueLabel: 'Missing NMI subscription ID' };
  }
  if (isBillingComplete(enrollment)) {
    return { issueCode: 'billing_complete', issueLabel: 'Billing complete' };
  }

  const action = String(lastLog?.action || '').toLowerCase();
  const verification = String(lastLog?.verification_status || '').toLowerCase();
  if (action.includes('unknown_subscription')) return { issueCode: 'unmatched_subscription', issueLabel: 'NMI post did not match an enrollment' };
  if (action.includes('verification') || verification === 'failed' || verification === 'error') return { issueCode: 'verification_failed', issueLabel: 'NMI verification failed' };
  if (action.includes('payment_event_missing')) return { issueCode: 'payment_record_failed', issueLabel: 'Payment record failed' };
  if (action.includes('processed_success') || action.includes('history_imported_success') || action.includes('duplicate_transaction')) {
    return { issueCode: 'imported_successfully', issueLabel: 'Imported successfully' };
  }

  const nextBilling = String(enrollment.next_billing_date || '').slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (nextBilling && nextBilling < today && !lastPayment) {
    return { issueCode: 'no_post_received', issueLabel: 'No NMI post/payment recorded' };
  }
  if (nextBilling && nextBilling < today) {
    return { issueCode: 'overdue_tracking', issueLabel: 'Payment tracking needs review' };
  }
  if (!lastLog) return { issueCode: 'no_post_received', issueLabel: 'No NMI post received yet' };
  return { issueCode: 'ok', issueLabel: 'No current issue' };
}

export const nmiRecurringSyncService = {
  async syncEnrollment(locationId: string, enrollmentId: string): Promise<NmiSyncResult> {
    const supabase = getSupabase();
    const { data: enrollment, error } = await supabase
      .from('enrollments')
      .select('id, merchant_id, location_id, contact_id, offer_id, program_name_snapshot, payments_made, payments_total, payment_type, processor_subscription_id, processor_config_id, processor_type, billing_completed_at, enrolled_at, created_at')
      .eq('location_id', locationId)
      .eq('id', enrollmentId)
      .single();

    if (error || !enrollment) throw new Error('Enrollment not found');
    const subscriptionId = String(enrollment.processor_subscription_id || '').trim();
    if (!subscriptionId) throw new Error('Enrollment has no NMI subscription ID');
    if (String(enrollment.processor_type || '').toLowerCase() !== 'nmi') throw new Error('Enrollment is not using NMI');
    if (!enrollment.processor_config_id) throw new Error('Enrollment has no immutable NMI processor configuration binding');

    let offerName = '';
    let installmentFrequency = 'monthly';
    if (enrollment.offer_id) {
      const { data: offer } = await supabase
        .from('offers_mirror')
        .select('offer_name, installment_frequency')
        .eq('id', enrollment.offer_id)
        .single();
      offerName = offer?.offer_name || '';
      installmentFrequency = offer?.installment_frequency || 'monthly';
    }

    const { config } = await resolveProcessor(enrollment.merchant_id, locationId, {
      processor_override: 'nmi',
      processor_config_id: enrollment.processor_config_id,
      nmi_processor_id: null,
    });
    const processor = createProcessorClient(config);
    if (!processor.listSubscriptionTransactions) {
      throw new Error('NMI subscription history lookup is unavailable');
    }

    const transactions = sortTransactions(await processor.listSubscriptionTransactions(subscriptionId, {
      startDate: enrollment.enrolled_at || enrollment.created_at || undefined,
      limit: 100,
    }));

    const transactionIds = transactions.map(tx => tx.transactionId).filter(Boolean);
    let existingIds = new Map<string, string>();
    if (transactionIds.length > 0) {
      const { data: existing } = await supabase
        .from('payment_events')
        .select('id, processor_transaction_id')
        .eq('location_id', locationId)
        .eq('processor', 'nmi')
        .eq('processor_config_id', config.id)
        .in('processor_transaction_id', transactionIds);
      existingIds = new Map((existing || []).map((row: any) => [row.processor_transaction_id, row.id]));
    }

    const result: NmiSyncResult = {
      enrollmentId: enrollment.id,
      subscriptionId,
      checked: transactions.length,
      imported: 0,
      failedRecorded: 0,
      duplicates: 0,
      noNewTransactions: transactions.length === 0,
      paymentEventIds: [],
      errors: [],
    };

    const workingEnrollment = { ...enrollment };
    for (let transactionIndex = 0; transactionIndex < transactions.length; transactionIndex += 1) {
      const tx = transactions[transactionIndex];
      if (existingIds.has(tx.transactionId)) {
        result.duplicates += 1;
        await nmiDiagnosticLogService.create({
          merchant_id: enrollment.merchant_id,
          location_id: locationId,
          enrollment_id: enrollment.id,
          processor_subscription_id: subscriptionId,
          transaction_id: tx.transactionId,
          amount: tx.amount / 100,
          response_code: tx.success ? '1' : '2',
          response_text: tx.responseText || null,
          matched: true,
          duplicate: true,
          verification_status: 'skipped',
          action: 'history_duplicate_transaction',
          payment_event_id: existingIds.get(tx.transactionId) || null,
          raw_keys: ['nmi_query_subscription_id'],
        });
        continue;
      }

      if (isApprovedRecurring(tx)) {
        try {
          const payment = await handleRecurringPaymentSuccess({
            enrollment: workingEnrollment,
            processorType: 'nmi',
            transactionId: tx.transactionId,
            amountCents: tx.amount,
            offerName,
            installmentFrequency,
            source: 'nmi_history_sync',
            processorConfigId: config.id,
            rawPayload: {
              nmi_transaction_id: tx.transactionId,
              nmi_subscription_id: subscriptionId,
              nmi_processor_id: config.nmi_processor_id || null,
              nmi_processor_config_id: config.id,
              nmi_provider_status: tx.status,
              nmi_occurred_at: tx.occurredAt || null,
            },
          });
          workingEnrollment.payments_made = payment.newPaymentsMade;
          result.imported += 1;
          if (payment.paymentEventId) result.paymentEventIds.push(payment.paymentEventId);
          if (payment.paymentEventId) existingIds.set(tx.transactionId, payment.paymentEventId);
          await nmiDiagnosticLogService.create({
            merchant_id: enrollment.merchant_id,
            location_id: locationId,
            enrollment_id: enrollment.id,
            processor_subscription_id: subscriptionId,
            transaction_id: tx.transactionId,
            amount: tx.amount / 100,
            response_code: '1',
            response_text: tx.responseText || null,
            matched: true,
            duplicate: false,
            verification_status: 'verified',
            action: payment.paymentEventId ? 'history_imported_success' : 'history_imported_success_payment_event_missing',
            error_message: payment.paymentEventId ? null : 'Recurring payment handler did not return a payment_event id',
            payment_event_id: payment.paymentEventId,
            raw_keys: ['nmi_query_subscription_id'],
          });
        } catch (err: any) {
          result.errors.push(`${tx.transactionId}: ${err.message}`);
          await nmiDiagnosticLogService.create({
            merchant_id: enrollment.merchant_id,
            location_id: locationId,
            enrollment_id: enrollment.id,
            processor_subscription_id: subscriptionId,
            transaction_id: tx.transactionId,
            amount: tx.amount / 100,
            response_code: '1',
            response_text: tx.responseText || null,
            matched: true,
            duplicate: false,
            verification_status: 'error',
            action: 'history_import_error',
            error_message: err.message || 'NMI history import failed',
            raw_keys: ['nmi_query_subscription_id'],
          });
        }
        continue;
      }

      if (isFailedRecurring(tx)) {
        try {
          const supersededByLaterApproval = transactions
            .slice(transactionIndex + 1)
            .some(isApprovedRecurring);
          const failed = await handleRecurringPaymentFailure({
            enrollment: workingEnrollment,
            processorType: 'nmi',
            transactionId: tx.transactionId,
            amountCents: tx.amount,
            errorMessage: tx.responseText || 'NMI recurring payment failed',
            source: 'nmi_history_sync',
            processorConfigId: config.id,
            suppressDunning: supersededByLaterApproval,
            rawPayload: {
              nmi_transaction_id: tx.transactionId,
              nmi_subscription_id: subscriptionId,
              nmi_processor_id: config.nmi_processor_id || null,
              nmi_processor_config_id: config.id,
              nmi_provider_status: tx.status,
              nmi_occurred_at: tx.occurredAt || null,
              superseded_by_later_approval: supersededByLaterApproval,
            },
          });
          result.failedRecorded += 1;
          if (failed.paymentEventId) result.paymentEventIds.push(failed.paymentEventId);
          if (failed.paymentEventId) existingIds.set(tx.transactionId, failed.paymentEventId);
          await nmiDiagnosticLogService.create({
            merchant_id: enrollment.merchant_id,
            location_id: locationId,
            enrollment_id: enrollment.id,
            processor_subscription_id: subscriptionId,
            transaction_id: tx.transactionId,
            amount: tx.amount / 100,
            response_code: '2',
            response_text: tx.responseText || null,
            matched: true,
            duplicate: false,
            verification_status: 'failed',
            action: failed.paymentEventId ? 'history_imported_failure' : 'history_imported_failure_payment_event_missing',
            error_message: failed.paymentEventId ? null : 'Failed payment handler did not return a payment_event id',
            payment_event_id: failed.paymentEventId,
            raw_keys: ['nmi_query_subscription_id'],
          });
        } catch (err: any) {
          result.errors.push(`${tx.transactionId}: ${err.message}`);
        }
      }
    }

    if (transactions.length === 0) {
      await nmiDiagnosticLogService.create({
        merchant_id: enrollment.merchant_id,
        location_id: locationId,
        enrollment_id: enrollment.id,
        processor_subscription_id: subscriptionId,
        matched: true,
        duplicate: false,
        verification_status: 'skipped',
        action: 'history_no_transactions_found',
        error_message: 'NMI Query API returned no transactions for this subscription',
        raw_keys: ['nmi_query_subscription_id'],
      });
    }

    logger.info(result, 'NMI recurring history sync complete');
    return result;
  },

  async syncDueEnrollments(locationId?: string): Promise<{ checked: number; results: NmiSyncResult[]; errors: string[] }> {
    const supabase = getSupabase();
    const today = new Date().toISOString().slice(0, 10);
    let query: any = supabase
      .from('enrollments')
      .select('id, location_id')
      .in('status', ['enrolled', 'active', 'paused'])
      .in('payment_type', ['installment', 'installments', 'subscription'])
      .eq('processor_type', 'nmi')
      .not('processor_subscription_id', 'is', null)
      .lte('next_billing_date', today)
      .is('billing_completed_at', null)
      .limit(100);
    if (locationId) query = query.eq('location_id', locationId);

    const { data, error } = await query;
    if (error) throw error;

    const results: NmiSyncResult[] = [];
    const errors: string[] = [];
    for (const enrollment of data || []) {
      try {
        results.push(await this.syncEnrollment(enrollment.location_id, enrollment.id));
      } catch (err: any) {
        errors.push(`${enrollment.id}: ${err.message}`);
      }
    }

    return { checked: (data || []).length, results, errors };
  },

  async diagnostics(locationId: string): Promise<{ rows: NmiDiagnosticRow[] }> {
    const supabase = getSupabase();
    const { data: enrollments, error } = await supabase
      .from('enrollments')
      .select('id, location_id, contact_id, email, first_name, last_name, digital_signature, offer_id, status, payment_type, processor_type, processor_subscription_id, payments_made, payments_total, next_billing_date, billing_completed_at')
      .eq('location_id', locationId)
      .eq('processor_type', 'nmi')
      .in('payment_type', ['installment', 'installments', 'subscription'])
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw error;

    const rows = enrollments || [];
    const enrollmentIds = rows.map((row: any) => row.id);
    const offerIds = [...new Set(rows.map((row: any) => row.offer_id).filter(Boolean))];
    const subscriptionIds = [...new Set(rows.map((row: any) => row.processor_subscription_id).filter(Boolean))];

    const [{ data: offers }, { data: payments }, { data: logs }] = await Promise.all([
      offerIds.length
        ? supabase.from('offers_mirror').select('id, offer_name').in('id', offerIds)
        : Promise.resolve({ data: [] }),
      enrollmentIds.length
        ? supabase.from('payment_events').select('id, enrollment_id, created_at, amount, processor_transaction_id').eq('location_id', locationId).in('enrollment_id', enrollmentIds).order('created_at', { ascending: false })
        : Promise.resolve({ data: [] }),
      subscriptionIds.length
        // #18: scope by location_id — processor_subscription_id is an NMI-gateway sequential id and
        // can collide across merchants on shared/different gateways (cross-tenant metadata leak).
        ? supabase.from('nmi_silent_post_logs').select('id, enrollment_id, processor_subscription_id, transaction_id, amount, action, verification_status, created_at').eq('location_id', locationId).in('processor_subscription_id', subscriptionIds).order('created_at', { ascending: false })
        : Promise.resolve({ data: [] }),
    ]);

    const offerMap = new Map((offers || []).map((offer: any) => [offer.id, offer]));
    const paymentsByEnrollment = new Map<string, any[]>();
    for (const payment of payments || []) {
      const list = paymentsByEnrollment.get(payment.enrollment_id) || [];
      list.push(payment);
      paymentsByEnrollment.set(payment.enrollment_id, list);
    }
    const logsBySubscription = new Map<string, any[]>();
    for (const log of logs || []) {
      const list = logsBySubscription.get(log.processor_subscription_id) || [];
      list.push(log);
      logsBySubscription.set(log.processor_subscription_id, list);
    }

    return {
      rows: rows.map((enrollment: any): NmiDiagnosticRow => {
        const lastPayment = (paymentsByEnrollment.get(enrollment.id) || [])[0] || null;
        const lastLog = (logsBySubscription.get(enrollment.processor_subscription_id) || [])[0] || null;
        const issue = issueForDiagnostic({ enrollment, lastPayment, lastLog });
        return {
          enrollmentId: enrollment.id,
          contactId: enrollment.contact_id,
          customerName: displayName(enrollment),
          customerEmail: enrollment.email || '',
          programName: offerMap.get(enrollment.offer_id)?.offer_name || 'Unknown Program',
          paymentType: enrollment.payment_type || '',
          status: enrollment.status || '',
          subscriptionId: enrollment.processor_subscription_id || null,
          nextBillingDate: enrollment.next_billing_date || null,
          paymentsMade: Number(enrollment.payments_made || 0),
          paymentsTotal: enrollment.payments_total == null ? null : Number(enrollment.payments_total),
          lastScaleSafePaymentDate: lastPayment?.created_at || null,
          lastScaleSafePaymentAmount: lastPayment?.amount == null ? null : Number(lastPayment.amount),
          lastScaleSafeTransactionId: lastPayment?.processor_transaction_id || null,
          lastNmiPostDate: lastLog?.created_at || null,
          lastNmiPostAction: lastLog?.action || null,
          lastNmiPostTransactionId: lastLog?.transaction_id || null,
          issueCode: issue.issueCode,
          issueLabel: issue.issueLabel,
        };
      }),
    };
  },
};
