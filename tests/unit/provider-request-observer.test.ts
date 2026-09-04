import {
  classifyProviderHost,
  observeProviderHost,
  setProviderRequestObserver,
} from '../../src/services/provider-request-observer';

describe('provider request observer', () => {
  afterEach(() => setProviderRequestObserver(null));

  it.each([
    ['services.leadconnectorhq.com', 'ghl'],
    ['https://api.stripe.com', 'stripe'],
    ['secure.nmi.com:443', 'nmi'],
    ['sandbox-api.whop.com', 'whop'],
    ['api.zoom.us', 'zoom'],
    ['api.anthropic.com', 'anthropic'],
  ])('classifies %s as %s', (host, provider) => {
    expect(classifyProviderHost(host)).toBe(provider);
  });

  it('does not classify Supabase or arbitrary destinations as provider egress', () => {
    expect(classifyProviderHost('example.supabase.co')).toBeNull();
    expect(classifyProviderHost('example.com')).toBeNull();
  });

  it('reports only allowlisted provider hosts', () => {
    const observer = jest.fn();
    setProviderRequestObserver(observer);

    observeProviderHost('api.stripe.com');
    observeProviderHost('example.com');

    expect(observer).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenCalledWith('stripe');
  });
});
