/**
 * Defense service tests.
 * Tests reason code mapping, prompt building, and compilation flow.
 */

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: jest.fn().mockReturnValue({ insert: jest.fn().mockReturnValue({ error: null }) }) }),
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn().mockResolvedValue({
    get: jest.fn().mockResolvedValue({ data: { contact: { firstName: 'John', lastName: 'Doe', email: 'john@test.com' } } }),
    put: jest.fn().mockResolvedValue({ data: {} }),
  }),
}));

jest.mock('../../src/clients/anthropic.client', () => ({
  callClaude: jest.fn().mockResolvedValue({
    text: 'Defense letter content here',
    inputTokens: 1000,
    outputTokens: 2000,
  }),
}));

jest.mock('../../src/repositories/defense.repository', () => ({
  defenseRepository: {
    create: jest.fn().mockResolvedValue({ id: 'def_1', location_id: 'loc_1', contact_id: 'c_1' }),
    getById: jest.fn().mockResolvedValue({ id: 'def_1', status: 'complete', dispute_amount: 5000, location_id: 'loc_1', contact_id: 'c_1' }),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    getReasonCodeStrategy: jest.fn().mockResolvedValue(null),
    getDefenseTemplate: jest.fn().mockResolvedValue(null),
    recordOutcome: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../src/repositories/evidence.repository', () => ({
  evidenceRepository: {
    getFullSnapshot: jest.fn().mockResolvedValue([
      { evidence_type: 'consent', event_date: '2026-01-15', summary: 'T&C accepted' },
      { evidence_type: 'session_delivery', event_date: '2026-02-01', summary: 'Session 1 delivered' },
      { evidence_type: 'payment_confirmation', event_date: '2026-02-15', summary: 'Payment received $500' },
    ]),
    getLastEvidenceDate: jest.fn().mockResolvedValue('2026-03-20'),
    getCounts: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    getByLocationId: jest.fn().mockResolvedValue({
      location_id: 'loc_1',
      business_name: 'Test Business',
      config: {},
      trigger_ids: {},
    }),
  },
}));

jest.mock('../../src/services/payment.service', () => ({
  paymentService: {
    getUndisputedPayments: jest.fn().mockResolvedValue([
      { amount: 500, payment_date: '2026-01-15' },
      { amount: 500, payment_date: '2026-02-15' },
    ]),
  },
}));

jest.mock('../../src/services/notification.service', () => ({
  notificationService: {
    fireChargebackDetected: jest.fn(),
    fireDefenseReady: jest.fn(),
  },
}));

import { defenseService } from '../../src/services/defense.service';
import { defenseRepository } from '../../src/repositories/defense.repository';
import { callClaude } from '../../src/clients/anthropic.client';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Defense Service - Reason Code Mapping', () => {
  test('Visa 10.4 maps to fraud category', async () => {
    await defenseService.compileDefense({
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '10.4', disputeAmount: 5000,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
    });

    expect(defenseRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ reason_category: 'fraud' }),
    );
  });

  test('Visa 13.1 maps to services_not_provided', async () => {
    await defenseService.compileDefense({
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '13.1', disputeAmount: 3000,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
    });

    expect(defenseRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ reason_category: 'services_not_provided' }),
    );
  });

  test('Visa 13.3 maps to not_as_described', async () => {
    await defenseService.compileDefense({
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '13.3', disputeAmount: 7500,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
    });

    expect(defenseRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ reason_category: 'not_as_described' }),
    );
  });

  test('MC 4837 maps to fraud', async () => {
    await defenseService.compileDefense({
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '4837', disputeAmount: 5000,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
    });

    expect(defenseRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ reason_category: 'fraud' }),
    );
  });

  test('Unknown reason code defaults to services_not_provided', async () => {
    await defenseService.compileDefense({
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '99.99', disputeAmount: 5000,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
    });

    expect(defenseRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ reason_category: 'services_not_provided' }),
    );
  });
});

describe('Defense Service - Prompt Building', () => {
  test('system prompt includes category-specific strategy', () => {
    const prompt = defenseService.buildSystemPrompt('fraud', null, null);
    expect(prompt).toContain('fraud');
    expect(prompt).toContain('IP');
    expect(prompt).toContain('device fingerprint');
  });

  test('system prompt includes Prior Undisputed Transactions instruction', () => {
    const prompt = defenseService.buildSystemPrompt('services_not_provided', null, null);
    expect(prompt).toContain('Prior Undisputed Transactions');
  });

  test('user message includes evidence timeline', () => {
    const msg = defenseService.buildUserMessage(
      { locationId: 'loc_1', contactId: 'c_1', reasonCode: '13.1', disputeAmount: 5000, disputeDate: '2026-03-20', deadline: '2026-04-10' },
      { firstName: 'John', lastName: 'Doe', email: 'john@test.com' },
      { business_name: 'Test Biz' },
      [{ evidence_type: 'consent', event_date: '2026-01-15', summary: 'T&C accepted' }],
      [{ amount: 500, payment_date: '2026-01-15' }],
      'services_not_provided',
    );

    expect(msg).toContain('13.1');
    expect(msg).toContain('$5000');
    expect(msg).toContain('John');
    expect(msg).toContain('EVIDENCE TIMELINE');
    expect(msg).toContain('PRIOR UNDISPUTED TRANSACTIONS');
    expect(msg).toContain('$500');
  });
});

describe('Defense Service - Compilation Flow', () => {
  test('compileDefense returns defenseId immediately', async () => {
    const id = await defenseService.compileDefense({
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '13.1', disputeAmount: 5000,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
    });

    expect(id).toBe('def_1');
  });

  test('runCompilation calls Claude API', async () => {
    await defenseService.runCompilation('def_1', {
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '13.1', disputeAmount: 5000,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
    }, 'services_not_provided');

    expect(callClaude).toHaveBeenCalledTimes(1);
    expect(defenseRepository.updateStatus).toHaveBeenCalledWith(
      'def_1', 'complete',
      expect.objectContaining({ defense_letter_text: 'Defense letter content here' }),
    );
  });
});
