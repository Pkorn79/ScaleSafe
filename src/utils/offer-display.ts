export function formatMoney(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const amount = Number(value);
  return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : String(value);
}

export function getPaidInFullDisplayPrice(offer: {
  price?: number | string | null;
  pif_price?: number | string | null;
  pif_discount_enabled?: boolean | null;
}): unknown {
  const discounted = Number(offer.pif_price);
  if (
    offer.pif_discount_enabled === true
    && offer.pif_price !== null
    && offer.pif_price !== undefined
    && offer.pif_price !== ''
    && Number.isFinite(discounted)
    && discounted >= 0
  ) {
    return offer.pif_price;
  }
  return offer.price;
}

export function getSelectedPlanReceiptPrice(
  offer: {
    price?: number | string | null;
    pif_price?: number | string | null;
    pif_discount_enabled?: boolean | null;
  },
  selectedPaymentType?: unknown,
): unknown {
  const type = String(selectedPaymentType || '').toLowerCase();
  if (['pif', 'one_time', 'paid_in_full'].includes(type)) {
    return getPaidInFullDisplayPrice(offer);
  }
  return offer.price;
}
