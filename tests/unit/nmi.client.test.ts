import axios from 'axios';
import { NmiClient } from '../../src/clients/nmi.client';
import {
  parseNmiResponse,
  centsToDollars,
  formatNmiDate,
  extractLastFour,
  parseNmiExpiry,
  parseNmiQueryTransactions,
  parseNmiVaultRecords,
} from '../../src/utils/nmi.utils';
import { ProcessorError } from '../../src/errors/processor.error';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Suppress logger output in tests
jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const TEST_CONFIG = {
  securityKey: 'test-security-key-do-not-use',
  tokenizationKey: 'test-tokenization-key',
  processorId: undefined,
};

const NMI_TEST_TOKEN = '00000000-000000-000000-000000000000';

// ─── Utility function tests ────────────────────────────────

describe('NMI Utilities', () => {
  describe('parseNmiResponse', () => {
    it('parses a successful sale response', () => {
      const raw = 'response=1&responsetext=SUCCESS&authcode=123456&transactionid=12345678&avsresponse=Y&cvvresponse=M&orderid=&type=sale&response_code=100';
      const result = parseNmiResponse(raw);

      expect(result.response).toBe('1');
      expect(result.responsetext).toBe('SUCCESS');
      expect(result.transactionid).toBe('12345678');
      expect(result.authcode).toBe('123456');
      expect(result.avsresponse).toBe('Y');
      expect(result.cvvresponse).toBe('M');
      expect(result.response_code).toBe('100');
    });

    it('parses a declined response', () => {
      const raw = 'response=2&responsetext=DECLINE&transactionid=99999&response_code=200';
      const result = parseNmiResponse(raw);

      expect(result.response).toBe('2');
      expect(result.responsetext).toBe('DECLINE');
      expect(result.response_code).toBe('200');
    });

    it('handles empty values', () => {
      const raw = 'response=1&orderid=&transactionid=111';
      const result = parseNmiResponse(raw);

      expect(result.orderid).toBe('');
      expect(result.transactionid).toBe('111');
    });

    it('parses vault add response', () => {
      const raw = 'response=1&responsetext=Customer Added&customer_vault_id=ABC123';
      const result = parseNmiResponse(raw);

      expect(result.customer_vault_id).toBe('ABC123');
    });

    it('adds normalized keys for gateway response aliases', () => {
      const raw = 'response=1&subscription-id=SUB-DASH&recurring_subscription_id=SUB_UNDERSCORE';
      const result = parseNmiResponse(raw);

      expect(result['subscription-id']).toBe('SUB-DASH');
      expect(result.subscriptionid).toBe('SUB-DASH');
      expect(result.recurringsubscriptionid).toBe('SUB_UNDERSCORE');
    });
  });

  describe('centsToDollars', () => {
    it.each([
      [0, '0.00'],
      [1, '0.01'],
      [50, '0.50'],
      [100, '1.00'],
      [1050, '10.50'],
      [999999, '9999.99'],
    ])('converts %i cents to "%s"', (cents, expected) => {
      expect(centsToDollars(cents)).toBe(expected);
    });
  });

  describe('formatNmiDate', () => {
    it('formats a date as YYYYMMDD', () => {
      const date = new Date(2026, 9, 1); // Oct 1 2026
      expect(formatNmiDate(date)).toBe('20261001');
    });

    it('pads single-digit month and day', () => {
      const date = new Date(2026, 0, 5); // Jan 5 2026
      expect(formatNmiDate(date)).toBe('20260105');
    });
  });

  describe('extractLastFour', () => {
    it('extracts last 4 from masked number', () => {
      expect(extractLastFour('4xxxxxxxxxxx1111')).toBe('1111');
    });

    it('handles plain numbers', () => {
      expect(extractLastFour('4111111111111111')).toBe('1111');
    });
  });

  describe('parseNmiExpiry', () => {
    it('parses MMYY format', () => {
      expect(parseNmiExpiry('1025')).toEqual({ month: 10, year: 2025 });
    });

    it('parses single-digit month', () => {
      expect(parseNmiExpiry('0128')).toEqual({ month: 1, year: 2028 });
    });
  });
});

// ─── NMI Query XML parsing ─────────────────────────────────

describe('NMI XML Parsing', () => {
  describe('parseNmiQueryTransactions', () => {
    it('parses a transaction query response', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <nm_response>
          <transaction>
            <transaction_id>12345678</transaction_id>
            <condition>complete</condition>
            <action>
              <amount>10.50</amount>
              <action_type>sale</action_type>
              <date>20261001</date>
              <response_text>SUCCESS</response_text>
            </action>
            <cc_number>4xxxxxxxxxxx1111</cc_number>
            <cc_exp>1025</cc_exp>
            <cc_type>visa</cc_type>
          </transaction>
        </nm_response>`;

      const result = parseNmiQueryTransactions(xml);
      expect(result).toHaveLength(1);
      expect(result[0].transactionId).toBe('12345678');
      expect(result[0].condition).toBe('complete');
      expect(parseFloat(result[0].amount)).toBeCloseTo(10.50);
      expect(result[0].action).toBe('sale');
    });

    it('uses the sale action amount when NMI returns multiple actions', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <nm_response>
          <transaction>
            <transaction_id>12054526789</transaction_id>
            <condition>complete</condition>
            <source>recurring</source>
            <action>
              <amount>0.50</amount>
              <action_type>sale</action_type>
              <date>20260512235438</date>
              <success>1</success>
              <response_text>SUCCESS</response_text>
            </action>
            <action>
              <amount>0.50</amount>
              <action_type>settle</action_type>
              <date>20260513010000</date>
              <success>1</success>
              <response_text>ACCEPTED</response_text>
            </action>
          </transaction>
        </nm_response>`;

      const result = parseNmiQueryTransactions(xml);
      expect(result).toHaveLength(1);
      expect(result[0].transactionId).toBe('12054526789');
      expect(parseFloat(result[0].amount)).toBeCloseTo(0.50);
      expect(result[0].action).toBe('sale');
      expect(result[0].responseText).toBe('SUCCESS');
      expect(result[0].success).toBe(true);
      expect(result[0].source).toBe('recurring');
    });

    it('returns empty array for no transactions', () => {
      const xml = '<nm_response></nm_response>';
      expect(parseNmiQueryTransactions(xml)).toEqual([]);
    });
  });

  describe('parseNmiVaultRecords', () => {
    it('parses a vault query response', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <nm_response>
          <customer_vault>
            <customer id="VAULT123">
              <billing id="VAULT123">
                <first_name>Jane</first_name>
                <last_name>Smith</last_name>
                <email>jane@example.com</email>
                <cc_number>4xxxxxxxxxxx1111</cc_number>
                <cc_exp>1025</cc_exp>
                <cc_type>visa</cc_type>
              </billing>
            </customer>
          </customer_vault>
        </nm_response>`;

      const result = parseNmiVaultRecords(xml);
      expect(result).toHaveLength(1);
      expect(result[0].firstName).toBe('Jane');
      expect(result[0].ccNumber).toBe('4xxxxxxxxxxx1111');
      expect(result[0].ccType).toBe('visa');
    });
  });
});

// ─── NmiClient tests ───────────────────────────────────────

describe('NmiClient', () => {
  let client: NmiClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new NmiClient(TEST_CONFIG);
  });

  describe('charge', () => {
    it('sends correct parameters for a sale', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: 'response=1&responsetext=SUCCESS&transactionid=TXN001&avsresponse=Y&cvvresponse=M&response_code=100',
      });

      const result = await client.charge({
        amount: 1050,
        currency: 'usd',
        paymentToken: NMI_TEST_TOKEN,
        description: 'Test charge',
        idempotencyKey: 'checkout-attempt-123',
        metadata: { first_name: 'Jane', last_name: 'Smith', email: 'jane@test.com' },
      });

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('TXN001');
      expect(result.status).toBe('approved');
      expect(result.avsResponse).toBe('Y');

      // Verify the POST body
      const postBody = mockedAxios.post.mock.calls[0][1] as string;
      const params = new URLSearchParams(postBody);
      expect(params.get('type')).toBe('sale');
      expect(params.get('amount')).toBe('10.50');
      expect(params.get('payment_token')).toBe(NMI_TEST_TOKEN);
      expect(params.get('orderid')).toBe('checkout-attempt-123');
      expect(params.get('first_name')).toBe('Jane');
      expect(params.get('email')).toBe('jane@test.com');
    });

    it('captures dashed customer vault id aliases from charge responses', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: 'response=1&responsetext=SUCCESS&transactionid=TXN004&customer-vault-id=VAULT-DASH&cc_number=5xxxxxxxxxxx4444&cc_exp=0431&cc_type=mastercard',
      });
      mockedAxios.post.mockRejectedValueOnce(new Error('query unavailable'));

      const result = await client.charge({
        amount: 103,
        currency: 'usd',
        paymentToken: NMI_TEST_TOKEN,
        shouldVault: true,
        customerEmail: 'client@example.com',
      });

      expect(result.success).toBe(true);
      expect(result.vaultedCustomerId).toBe('VAULT-DASH');
      expect(result.vaultedCardLastFour).toBe('4444');
      expect(result.vaultedCardBrand).toBe('mastercard');

      const postBody = mockedAxios.post.mock.calls[0][1] as string;
      const params = new URLSearchParams(postBody);
      expect(params.get('customer_vault')).toBe('add_customer');
    });

    it('returns declined result on response=2', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: 'response=2&responsetext=DECLINE&transactionid=TXN002&response_code=200',
      });

      const result = await client.charge({
        amount: 5000,
        currency: 'usd',
        paymentToken: NMI_TEST_TOKEN,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('declined');
      expect(result.errorMessage).toBe('DECLINE');
    });

    it('includes processor_id when configured', async () => {
      const midClient = new NmiClient({
        ...TEST_CONFIG,
        processorId: 'MID_HIGH_TICKET',
      });

      mockedAxios.post.mockResolvedValueOnce({
        data: 'response=1&responsetext=SUCCESS&transactionid=TXN003&response_code=100',
      });

      await midClient.charge({
        amount: 100000,
        currency: 'usd',
        paymentToken: NMI_TEST_TOKEN,
      });

      const postBody = mockedAxios.post.mock.calls[0][1] as string;
      const params = new URLSearchParams(postBody);
      expect(params.get('processor_id')).toBe('MID_HIGH_TICKET');
    });
  });

  describe('refund', () => {
    it('sends full refund when no amount specified', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: 'response=1&responsetext=SUCCESS&transactionid=REF001&response_code=100',
      });

      const result = await client.refund({ transactionId: 'TXN001' });

      expect(result.success).toBe(true);
      expect(result.status).toBe('refunded');

      const postBody = mockedAxios.post.mock.calls[0][1] as string;
      const params = new URLSearchParams(postBody);
      expect(params.get('type')).toBe('refund');
      expect(params.get('transactionid')).toBe('TXN001');
      expect(params.has('amount')).toBe(false);
    });

    it('sends partial refund with amount', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: 'response=1&responsetext=SUCCESS&transactionid=REF002&response_code=100',
      });

      await client.refund({ transactionId: 'TXN001', amount: 500 });

      const postBody = mockedAxios.post.mock.calls[0][1] as string;
      const params = new URLSearchParams(postBody);
      expect(params.get('amount')).toBe('5.00');
    });
  });

  describe('saveCard', () => {
    it('adds customer to vault and queries card details', async () => {
      // First call: vault add
      mockedAxios.post.mockResolvedValueOnce({
        data: 'response=1&responsetext=Customer Added&customer_vault_id=VAULT999',
      });

      // Second call: vault query for card details
      mockedAxios.post.mockResolvedValueOnce({
        data: `<?xml version="1.0" encoding="UTF-8"?>
          <nm_response>
            <customer_vault>
              <customer id="VAULT999">
                <billing id="VAULT999">
                  <first_name>Jane</first_name>
                  <last_name>Smith</last_name>
                  <email>jane@test.com</email>
                  <cc_number>4xxxxxxxxxxx1111</cc_number>
                  <cc_exp>1027</cc_exp>
                  <cc_type>visa</cc_type>
                </billing>
              </customer>
            </customer_vault>
          </nm_response>`,
      });

      const result = await client.saveCard({
        paymentToken: NMI_TEST_TOKEN,
        contactId: 'contact_123',
        customerEmail: 'jane@test.com',
        customerName: 'Jane Smith',
      });

      expect(result.success).toBe(true);
      expect(result.paymentMethodId).toBe('VAULT999');
      expect(result.cardLastFour).toBe('1111');
      expect(result.cardBrand).toBe('visa');
      expect(result.cardExpMonth).toBe(10);
      expect(result.cardExpYear).toBe(2027);

      // Verify vault add params
      const addBody = mockedAxios.post.mock.calls[0][1] as string;
      const addParams = new URLSearchParams(addBody);
      expect(addParams.get('customer_vault')).toBe('add_customer');
      expect(addParams.get('first_name')).toBe('Jane');
      expect(addParams.get('last_name')).toBe('Smith');
    });

    it('uses transact response card metadata when vault query fails', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: 'response=1&responsetext=Customer Added&customer_vault_id=VAULT999&cc_number=4xxxxxxxxxxx1111&cc_exp=1027&cc_type=visa',
      });

      mockedAxios.post.mockRejectedValueOnce(new Error('query unavailable'));

      const result = await client.saveCard({
        paymentToken: NMI_TEST_TOKEN,
        contactId: 'contact_123',
        customerEmail: 'jane@test.com',
      });

      expect(result.success).toBe(true);
      expect(result.paymentMethodId).toBe('VAULT999');
      expect(result.cardLastFour).toBe('1111');
      expect(result.cardBrand).toBe('visa');
      expect(result.cardExpMonth).toBe(10);
      expect(result.cardExpYear).toBe(2027);
    });

    it('accepts customer vault id aliases when saving a payment method', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: 'response=1&responsetext=Customer Added&customer-vault-id=VAULT-DASH&cc_number=5xxxxxxxxxxx4444&cc_exp=0431&cc_type=mastercard',
      });
      mockedAxios.post.mockRejectedValueOnce(new Error('query unavailable'));

      const result = await client.saveCard({
        paymentToken: NMI_TEST_TOKEN,
        contactId: 'contact_123',
        customerEmail: 'jane@test.com',
      });

      expect(result.success).toBe(true);
      expect(result.paymentMethodId).toBe('VAULT-DASH');
      expect(result.customerId).toBe('VAULT-DASH');
      expect(result.cardLastFour).toBe('4444');
      expect(result.cardBrand).toBe('mastercard');
    });
  });

  describe('error handling', () => {
    it('throws ProcessorError with isRetryable on network failure', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      try {
        await client.charge({ amount: 100, currency: 'usd', paymentToken: NMI_TEST_TOKEN });
        fail('Expected ProcessorError');
      } catch (err) {
        expect(err).toBeInstanceOf(ProcessorError);
        expect((err as ProcessorError).isRetryable).toBe(true);
        expect((err as ProcessorError).processor).toBe('nmi');
      }
    });

    it('throws ProcessorError on vault add failure', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: 'response=3&responsetext=Invalid payment token&response_code=300',
      });

      await expect(
        client.saveCard({
          paymentToken: 'invalid',
          contactId: 'c1',
          customerEmail: 'test@test.com',
        }),
      ).rejects.toThrow(ProcessorError);
    });
  });

  describe('createSubscription', () => {
    it('creates a monthly subscription', async () => {
      mockedAxios.post.mockResolvedValue({
        data: 'response=1&responsetext=Subscription Added&subscription_id=SUB001',
      });

      const result = await client.createSubscription({
        paymentMethodId: 'VAULT999',
        customerId: 'VAULT999',
        planAmount: 50000,
        interval: 'monthly',
        totalPayments: 12,
        description: 'Monthly Coaching',
        metadata: {
          enrollment_id: '11111111-1111-4111-8111-111111111111',
          contact_id: 'contact_1',
          offer_id: 'offer_1',
          location_id: 'loc_1',
          payment_type: 'installment',
        },
      });

      expect(result.success).toBe(true);
      expect(result.subscriptionId).toBe('SUB001');
      expect(result.status).toBe('active');

      const postBody = mockedAxios.post.mock.calls[0][1] as string;
      const params = new URLSearchParams(postBody);
      expect(params.get('recurring')).toBe('add_subscription');
      expect(params.get('plan_amount')).toBe('500.00');
      expect(params.get('plan_payments')).toBe('12');
      expect(params.get('month_frequency')).toBe('1');
      expect(params.get('customer_vault_id')).toBe('VAULT999');
      expect(params.get('order_id')).toBe('11111111-1111-4111-8111-111111111111');
      expect(params.get('merchant_defined_field_1')).toBe('11111111-1111-4111-8111-111111111111');
      expect(params.get('merchant_defined_field_2')).toBe('contact_1');
      expect(params.get('merchant_defined_field_3')).toBe('offer_1');
      expect(params.get('merchant_defined_field_4')).toBe('loc_1');
      expect(params.get('merchant_defined_field_5')).toBe('installment');
    });

    it('creates a weekly subscription', async () => {
      mockedAxios.post.mockImplementation(async (url: string) => {
        if (url.includes('transact.php')) {
          return { data: 'response=1&responsetext=Subscription Added&subscription_id=SUB002' };
        }
        return { data: '' };
      });

      await client.createSubscription({
        paymentMethodId: 'VAULT999',
        customerId: 'VAULT999',
        planAmount: 10000,
        interval: 'weekly',
        totalPayments: 4,
      });

      const postBody = mockedAxios.post.mock.calls[0][1] as string;
      const params = new URLSearchParams(postBody);
      expect(params.get('day_frequency')).toBe('7');
    });

    it('accepts NMI subscription id aliases', async () => {
      mockedAxios.post.mockResolvedValue({
        data: 'response=1&responsetext=Subscription Added&subscription-id=SUB-DASH',
      });

      const result = await client.createSubscription({
        paymentMethodId: 'VAULT999',
        customerId: 'VAULT999',
        planAmount: 10000,
        interval: 'weekly',
        totalPayments: 2,
      });

      expect(result.success).toBe(true);
      expect(result.subscriptionId).toBe('SUB-DASH');
    });

    it('fails loudly when NMI approves recurring setup without a subscription id', async () => {
      mockedAxios.post.mockResolvedValue({
        data: 'response=1&responsetext=Subscription Added',
      });

      const result = await client.createSubscription({
        paymentMethodId: 'VAULT999',
        customerId: 'VAULT999',
        planAmount: 10000,
        interval: 'weekly',
        totalPayments: 2,
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('did not return a subscription ID');
    });
  });

  describe('cancelSubscription', () => {
    it('cancels a subscription', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: 'response=1&responsetext=Subscription Deleted',
      });

      const result = await client.cancelSubscription('SUB001');
      expect(result.success).toBe(true);

      const postBody = mockedAxios.post.mock.calls[0][1] as string;
      const params = new URLSearchParams(postBody);
      expect(params.get('recurring')).toBe('delete_subscription');
      expect(params.get('subscription_id')).toBe('SUB001');
    });
  });

  describe('verifyTransaction', () => {
    it('returns settled status for complete transaction', async () => {
      mockedAxios.post.mockImplementation(async (url: string) => ({
        data: `<?xml version="1.0" encoding="UTF-8"?>
          <nm_response>
            <transaction>
              <transaction_id>TXN001</transaction_id>
              <condition>complete</condition>
              <action>
                <amount>10.50</amount>
                <action_type>sale</action_type>
                <date>20261001</date>
                <response_text>SUCCESS</response_text>
              </action>
            </transaction>
          </nm_response>`,
      }));

      const result = await client.verifyTransaction('TXN001');
      expect(result.success).toBe(true);
      expect(result.status).toBe('settled');
      expect(result.amount).toBe(1050);
    });
  });

  describe('listSubscriptionTransactions', () => {
    it('queries NMI subscription history and maps recurring transactions', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: `<?xml version="1.0" encoding="UTF-8"?>
          <nm_response>
            <transaction>
              <transaction_id>12061861902</transaction_id>
              <condition>complete</condition>
              <source>recurring</source>
              <action>
                <amount>0.33</amount>
                <action_type>sale</action_type>
                <date>20260514035531</date>
                <success>1</success>
                <response_text>APPROVAL 327580</response_text>
              </action>
            </transaction>
          </nm_response>`,
      });

      const result = await client.listSubscriptionTransactions('12060786864', {
        startDate: '2026-05-13T22:27:06.000Z',
        limit: 10,
      });

      expect(result).toEqual([{
        transactionId: '12061861902',
        status: 'settled',
        amount: 33,
        occurredAt: '20260514035531',
        responseText: 'APPROVAL 327580',
        success: true,
        source: 'recurring',
      }]);

      const postBody = mockedAxios.post.mock.calls[0][1] as string;
      const params = new URLSearchParams(postBody);
      expect(params.get('subscription_id')).toBe('12060786864');
      expect(params.get('source')).toBe('recurring');
      expect(params.get('result_limit')).toBe('10');
      expect(params.get('start_date')).toBe('20260513222706');
      expect(params.get('security_key')).toBe(TEST_CONFIG.securityKey);
    });
  });

  describe('testConnection', () => {
    it('returns success when key is valid', async () => {
      mockedAxios.post.mockImplementation(async () => ({
        data: '<?xml version="1.0" encoding="UTF-8"?><nm_response></nm_response>',
      }));

      const result = await client.testConnection();
      expect(result.success).toBe(true);
    });

    it('returns failure on network error', async () => {
      // testConnection catches the ProcessorError internally
      mockedAxios.post.mockImplementation(async () => {
        throw new Error('ECONNREFUSED');
      });

      const result = await client.testConnection();
      expect(result.success).toBe(false);
    });
  });

  describe('security', () => {
    it('never exposes security_key in error messages', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));

      try {
        await client.charge({ amount: 100, currency: 'usd', paymentToken: NMI_TEST_TOKEN });
      } catch (err: any) {
        expect(err.message).not.toContain(TEST_CONFIG.securityKey);
        expect(JSON.stringify(err)).not.toContain(TEST_CONFIG.securityKey);
      }
    });
  });
});
