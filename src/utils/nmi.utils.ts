import { XMLParser } from 'fast-xml-parser';

/**
 * Parse NMI URL-encoded response into key-value object.
 * NMI returns: response=1&responsetext=SUCCESS&transactionid=12345&...
 */
export function parseNmiResponse(responseBody: string): Record<string, string> {
  const params = new URLSearchParams(responseBody.trim());
  const result: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}

/**
 * Parsed transaction from NMI Query API XML.
 */
export interface NmiQueryTransaction {
  transactionId: string;
  condition: string; // 'pending', 'pendingsettlement', 'complete', 'failed', 'canceled', 'unknown'
  amount: string;
  action: string; // 'sale', 'auth', 'capture', 'void', 'refund', 'credit'
  date: string;
  responseText: string;
  cc_number?: string; // masked, e.g. "4xxxxxxxxxxx1111"
  cc_exp?: string; // "MMYY"
  cc_type?: string; // "visa", "mastercard", etc.
}

/**
 * Parsed customer vault record from NMI Query API XML.
 */
export interface NmiVaultRecord {
  customerVaultId: string;
  firstName: string;
  lastName: string;
  email: string;
  ccNumber: string; // masked
  ccExp: string; // "MMYY"
  ccType: string;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  isArray: (tagName) => tagName === 'transaction' || tagName === 'billing',
});

/**
 * Parse NMI Query API XML for transaction details.
 */
export function parseNmiQueryTransactions(xml: string): NmiQueryTransaction[] {
  const parsed = xmlParser.parse(xml);
  const root = parsed?.nm_response;
  if (!root || !root.transaction) return [];

  const transactions = Array.isArray(root.transaction) ? root.transaction : [root.transaction];

  return transactions.map((tx: any) => {
    const actions = tx.action
      ? (Array.isArray(tx.action) ? tx.action : [tx.action])
      : [];
    const primaryAction = actions.find((action: any) => String(action?.action_type || '').toLowerCase() === 'sale')
      || actions.find((action: any) => Number(action?.success) === 1 && Number(action?.amount) > 0)
      || actions.find((action: any) => Number(action?.amount) > 0)
      || actions[0]
      || {};

    return {
      transactionId: String(tx.transaction_id || ''),
      condition: String(tx.condition || 'unknown'),
      amount: String(primaryAction.amount || '0.00'),
      action: String(primaryAction.action_type || ''),
      date: String(primaryAction.date || ''),
      responseText: String(primaryAction.response_text || ''),
      cc_number: tx.cc_number ? String(tx.cc_number) : undefined,
      cc_exp: tx.cc_exp ? String(tx.cc_exp) : undefined,
      cc_type: tx.cc_type ? String(tx.cc_type) : undefined,
    };
  });
}

/**
 * Parse NMI Query API XML for customer vault records.
 */
export function parseNmiVaultRecords(xml: string): NmiVaultRecord[] {
  const parsed = xmlParser.parse(xml);
  const root = parsed?.nm_response;
  if (!root || !root.customer_vault) return [];

  const vault = root.customer_vault;
  const customers = Array.isArray(vault.customer) ? vault.customer : [vault.customer];

  return customers.flatMap((customer: any) => {
    const billings = customer.billing
      ? (Array.isArray(customer.billing) ? customer.billing : [customer.billing])
      : [];

    return billings.map((b: any) => ({
      customerVaultId: String(customer['@_id'] || b['@_id'] || ''),
      firstName: String(b.first_name || ''),
      lastName: String(b.last_name || ''),
      email: String(b.email || ''),
      ccNumber: String(b.cc_number || ''),
      ccExp: String(b.cc_exp || ''),
      ccType: String(b.cc_type || ''),
    }));
  });
}

/**
 * Convert cents (integer) to NMI dollar string.
 * 1050 → "10.50", 100 → "1.00", 50 → "0.50"
 */
export function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Format date as YYYYMMDD for NMI recurring API.
 */
export function formatNmiDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * Extract last 4 digits from a masked card number.
 * "4xxxxxxxxxxx1111" → "1111"
 */
export function extractLastFour(maskedNumber: string): string {
  return maskedNumber.replace(/[^0-9]/g, '').slice(-4);
}

/**
 * Parse NMI cc_exp "MMYY" into month and year.
 */
export function parseNmiExpiry(ccExp: string): { month: number; year: number } {
  const mm = parseInt(ccExp.substring(0, 2), 10);
  const yy = parseInt(ccExp.substring(2, 4), 10);
  return { month: mm, year: 2000 + yy };
}
