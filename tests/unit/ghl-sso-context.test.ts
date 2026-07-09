import { extractGhlSsoContext } from '../../src/utils/ghl-sso-context';

describe('extractGhlSsoContext', () => {
  it('extracts a string activeLocation', () => {
    const context = extractGhlSsoContext({
      activeLocation: 'loc_123',
      companyId: 'comp_123',
      userId: 'user_123',
      email: 'owner@example.com',
      role: 'admin',
      userName: 'Owner',
    });

    expect(context).toMatchObject({
      locationId: 'loc_123',
      companyId: 'comp_123',
      userId: 'user_123',
      email: 'owner@example.com',
      role: 'admin',
      userName: 'Owner',
    });
  });

  it('extracts nested activeLocation objects from GHL SSO payloads', () => {
    const context = extractGhlSsoContext({
      activeLocation: { id: 'loc_nested', name: 'WholePay App Test' },
      company: { id: 'comp_nested' },
      user_id: 'user_nested',
    });

    expect(context.locationId).toBe('loc_nested');
    expect(context.companyId).toBe('comp_nested');
    expect(context.userId).toBe('user_nested');
  });

  it('extracts alternate nested location keys', () => {
    expect(extractGhlSsoContext({ selectedLocation: { _id: 'loc_selected' } }).locationId)
      .toBe('loc_selected');
    expect(extractGhlSsoContext({ location: { locationId: 'loc_location' } }).locationId)
      .toBe('loc_location');
  });
});
