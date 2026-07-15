export interface OfferNameFields {
  internal_name?: string | null;
  offer_name?: string | null;
  offerInternalName?: string | null;
  offerName?: string | null;
}

export function internalOfferName(offer: OfferNameFields | null | undefined): string {
  return offer?.internal_name?.trim()
    || offer?.offerInternalName?.trim()
    || offer?.offer_name?.trim()
    || offer?.offerName?.trim()
    || 'Offer';
}

export function customerProgramName(offer: OfferNameFields | null | undefined): string {
  return offer?.offer_name?.trim() || offer?.offerName?.trim() || 'Program';
}

export function merchantOfferLabel(offer: OfferNameFields | null | undefined): string {
  const internal = internalOfferName(offer);
  const customer = customerProgramName(offer);
  return internal === customer ? internal : `${internal} / Client sees: ${customer}`;
}
