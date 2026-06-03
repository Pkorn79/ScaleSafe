import { VALID_TRIGGER_KEYS, isValidTriggerKey, normalizeTriggerKey } from '../../src/constants/trigger-keys';

describe('Trigger Keys', () => {
  test('has 20 trigger keys', () => {
    expect(VALID_TRIGGER_KEYS).toHaveLength(20);
  });

  test('enrollment_complete is valid (no ss_ prefix)', () => {
    expect(isValidTriggerKey('enrollment_complete')).toBe(true);
  });

  test('ss_payment_received is valid', () => {
    expect(isValidTriggerKey('ss_payment_received')).toBe(true);
  });

  test('shared app event trigger is valid', () => {
    expect(isValidTriggerKey('ss_app_event')).toBe(true);
  });

  test('retired upcoming payment reminder trigger key is invalid', () => {
    expect(isValidTriggerKey('ss_upcoming_payment_reminder')).toBe(false);
  });

  test('normalizes Marketplace trigger display labels', () => {
    expect(normalizeTriggerKey('Chargeback Detected')).toBe('ss_chargeback_detected');
    expect(normalizeTriggerKey('Enrollment Complete')).toBe('enrollment_complete');
    expect(normalizeTriggerKey('Payment Failed')).toBe('ss_payment_failed');
    expect(normalizeTriggerKey('ScaleSafe App Event')).toBe('ss_app_event');
  });

  test('normalizes all known Marketplace trigger labels', () => {
    const labels: Record<string, string> = {
      'Enrollment Complete': 'enrollment_complete',
      'Cancellation Requested': 'ss_cancellation_requested',
      'Session Logged': 'ss_session_logged',
      'Session No-Show': 'ss_session_noshow',
      'Module Completed': 'ss_module_completed',
      'Program Completed': 'ss_program_completed',
      'Milestone Reached': 'ss_milestone_reached',
      'Milestone Signed Off': 'ss_milestone_signedoff',
      'Payment Received': 'ss_payment_received',
      'Payment Failed': 'ss_payment_failed',
      'Refund Processed': 'ss_refund_processed',
      'Chargeback Detected': 'ss_chargeback_detected',
      'Defense Ready': 'ss_defense_ready',
      'Evidence Milestone': 'ss_evidence_milestone',
      'Chargeback Ratio Warning': 'ss_chargeback_ratio_warning',
      'Chargeback Ratio Critical': 'ss_chargeback_ratio_critical',
      'Send Enrollment Link': 'ss_send_enrollment_link',
      'Subscription Paused': 'ss_subscription_paused',
      'Subscription Resumed': 'ss_subscription_resumed',
      'ScaleSafe App Event': 'ss_app_event',
    };

    for (const [label, key] of Object.entries(labels)) {
      expect(normalizeTriggerKey(label)).toBe(key);
    }
  });

  test('unknown key is invalid', () => {
    expect(isValidTriggerKey('bogus_trigger')).toBe(false);
  });

  test('all keys except enrollment_complete start with ss_', () => {
    const nonPrefixed = VALID_TRIGGER_KEYS.filter((k) => !k.startsWith('ss_'));
    expect(nonPrefixed).toEqual(['enrollment_complete']);
  });
});
