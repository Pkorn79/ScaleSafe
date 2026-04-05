import { config } from '../config';

const BRAND_PATHS: Record<string, string> = {
  visa: '/assets/cards/visa.svg',
  mastercard: '/assets/cards/mastercard.svg',
  amex: '/assets/cards/amex.svg',
  discover: '/assets/cards/discover.svg',
};

export function getCardBrandImageUrl(brand: string): string {
  const path = BRAND_PATHS[brand.toLowerCase()] || BRAND_PATHS.visa;
  return `${config.appUrl}${path}`;
}

export function getCardBrandTitle(brand: string): string {
  const titles: Record<string, string> = {
    visa: 'Visa',
    mastercard: 'Mastercard',
    amex: 'American Express',
    discover: 'Discover',
  };
  return titles[brand.toLowerCase()] || brand.charAt(0).toUpperCase() + brand.slice(1);
}
