function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

export function resolveWorkflowTermsUrl(offer: any, merchant: any): string {
  return firstText(
    offer?.tc_url,
    merchant?.config?.tc_document_url,
    merchant?.tc_document_url,
  );
}

export function resolveWorkflowRefundPolicy(offer: any): string {
  return firstText(
    offer?.refund_window_text,
    offer?.refund_policy,
    offer?.refund_terms,
  );
}
