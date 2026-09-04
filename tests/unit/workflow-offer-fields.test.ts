import { resolveWorkflowRefundPolicy, resolveWorkflowTermsUrl } from '../../src/utils/workflow-offer-fields';

describe('workflow offer fields', () => {
  test('uses the exact offer refund policy and terms URL', () => {
    const offer = {
      refund_window_text: 'Full refund within 14 days.',
      tc_url: 'https://merchant.example/terms/offer-1',
    };
    const merchant = {
      config: { tc_document_url: 'https://merchant.example/default-terms' },
    };

    expect(resolveWorkflowRefundPolicy(offer)).toBe('Full refund within 14 days.');
    expect(resolveWorkflowTermsUrl(offer, merchant)).toBe('https://merchant.example/terms/offer-1');
  });

  test('falls back to merchant terms when the offer has no dedicated URL', () => {
    expect(resolveWorkflowTermsUrl({}, {
      config: { tc_document_url: 'https://merchant.example/default-terms' },
    })).toBe('https://merchant.example/default-terms');
  });
});
