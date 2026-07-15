import { resolveInternalOfferName, resolveProgramName } from '../../src/utils/program-name';

describe('program name contract', () => {
  it('prefers the frozen enrollment name over a renamed offer', () => {
    expect(resolveProgramName(
      { program_name_snapshot: 'Original Client Program' },
      { offer_name: 'Renamed Program' },
    )).toBe('Original Client Program');
  });

  it('falls back to the current public offer name for legacy enrollments', () => {
    expect(resolveProgramName(
      { program_name_snapshot: null },
      { offer_name: 'Client Program' },
    )).toBe('Client Program');
  });

  it('uses the merchant-only name without replacing the public name', () => {
    const offer = {
      internal_name: 'CERT 2026-07-15 Stripe Plan',
      offer_name: 'Executive Coaching Program',
    };
    expect(resolveInternalOfferName(offer)).toBe('CERT 2026-07-15 Stripe Plan');
    expect(resolveProgramName(null, offer)).toBe('Executive Coaching Program');
  });
});
