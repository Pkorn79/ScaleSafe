import { assertActiveGhlMerchantBinding, extractGhlSsoContext } from '../../src/utils/ghl-sso-context';

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

describe('assertActiveGhlMerchantBinding', () => {
  const merchant = {
    location_id: 'loc_1',
    company_id: 'comp_1',
    status: 'active',
    ghl_access_token_encrypted: 'access',
    ghl_refresh_token_encrypted: 'refresh',
    config: {
      ghl_token_scope: 'location',
      ghl_token_location_id: 'loc_1',
      ghl_token_company_id: 'comp_1',
    },
  };

  it('accepts an active install whose SSO and OAuth bindings agree', () => {
    expect(() => assertActiveGhlMerchantBinding(merchant, {
      locationId: 'loc_1', companyId: 'comp_1',
    })).not.toThrow();
  });

  it('rejects a company mismatch', () => {
    expect(() => assertActiveGhlMerchantBinding(merchant, {
      locationId: 'loc_1', companyId: 'comp_other',
    })).toThrow(/agency/i);
  });

  it('rejects an uninstalled merchant and a tokenless install stub', () => {
    expect(() => assertActiveGhlMerchantBinding({ ...merchant, status: 'uninstalled' }, {
      locationId: 'loc_1', companyId: 'comp_1',
    })).toThrow(/not actively installed/i);
    expect(() => assertActiveGhlMerchantBinding({
      ...merchant,
      ghl_access_token_encrypted: null,
      ghl_refresh_token_encrypted: null,
    }, {
      locationId: 'loc_1', companyId: 'comp_1',
    })).toThrow(/waiting for GoHighLevel authorization/i);
  });
});
