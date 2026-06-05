import { config } from '../config';
import { createPublicActionToken } from './public-action-token';

export function buildPulseCheckUrl(input: {
  locationId: string;
  contactId: string;
  enrollmentId: string;
}): string {
  const token = createPublicActionToken({
    action: 'pulse_checkin',
    locationId: input.locationId,
    contactId: input.contactId,
    enrollmentId: input.enrollmentId,
  });

  const base = config.appUrl.replace(/\/+$/, '');
  return `${base}/pulse-check?actionToken=${encodeURIComponent(token)}`;
}
