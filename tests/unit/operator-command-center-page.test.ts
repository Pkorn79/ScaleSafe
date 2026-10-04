import {
  operatorCommandCenterCss,
  operatorCommandCenterHtml,
  operatorCommandCenterJs,
} from '../../src/operator-command-center-page';
import { Script } from 'vm';

describe('operator Command Center page', () => {
  it('ships syntactically valid browser JavaScript', () => {
    expect(() => new Script(operatorCommandCenterJs)).not.toThrow();
  });

  it('renders every Phase 4 read-only operations view', () => {
    const html = operatorCommandCenterHtml();

    for (const view of [
      'overview', 'merchants', 'incidents', 'money', 'fulfillment',
      'recovery', 'resellers', 'audit', 'runbooks',
    ]) {
      expect(html).toContain(`data-panel="${view}"`);
    }
    expect(html).toContain('id="merchant-dialog"');
    expect(html).toContain('id="suppress-dialog"');
    expect(html).toContain('id="freshness"');
    expect(html).toContain('id="mobile-menu"');
  });

  it('renders server data only through safe DOM text APIs', () => {
    expect(operatorCommandCenterJs).toContain('node.textContent = String(text)');
    expect(operatorCommandCenterJs).not.toContain('.innerHTML');
    expect(operatorCommandCenterJs).not.toContain('insertAdjacentHTML');
    expect(operatorCommandCenterJs).not.toContain('document.write');
  });

  it('keeps HighLevel identity and location visible in lists, details, search and approval confirmation', () => {
    expect(operatorCommandCenterHtml()).toContain('HighLevel name, business name or location ID');
    expect(operatorCommandCenterJs).toContain('appendLocationIdentity(merchant, item)');
    expect(operatorCommandCenterJs).toContain("'Location ID: '");
    expect(operatorCommandCenterJs).toContain("'Merchant business name'");
    expect(operatorCommandCenterJs).toContain("'Stale name; last verified '");
    expect(operatorCommandCenterJs).toContain("'Refresh HighLevel name'");
    expect(operatorCommandCenterJs).toContain("product === 'enrollments' ? locationTitle(item) : item.businessName || item.locationId");
    expect(operatorCommandCenterJs).not.toContain('merchant.business_name || merchant.businessName || locationId');
    expect(operatorCommandCenterJs).not.toContain('item.merchant_name || item.location_id');
    expect(operatorCommandCenterJs).toContain("'/internal/operator/api/access/enrollments/'");
    expect(operatorCommandCenterJs).not.toContain("'/internal/operator/api/access/evidence/' + encodeURIComponent(item.locationId) + '/refresh-identity'");
  });

  it('keeps business operations read-only while protecting incident state changes with CSRF', () => {
    expect(operatorCommandCenterJs).toContain("cookie('__Host-scalesafe_ops_csrf')");
    expect(operatorCommandCenterJs).toContain('/acknowledge');
    expect(operatorCommandCenterJs).toContain('/suppress');
    expect(operatorCommandCenterJs).not.toContain('/api/payments/charge');
    expect(operatorCommandCenterJs).not.toContain('/api/refunds');
    expect(operatorCommandCenterJs).not.toContain('/api/payments/void');
    expect(operatorCommandCenterJs).not.toContain('cancelSubscription');
  });

  it('distinguishes stale data, unknown provider outcomes, and exhausted retries', () => {
    expect(operatorCommandCenterJs).toContain('Freshness unknown');
    expect(operatorCommandCenterJs).toContain('No trustworthy current result is available');
    expect(operatorCommandCenterJs).toContain('Automatic retry budget is exhausted');
    expect(operatorCommandCenterJs).toContain('provider outcome is not yet proven');
  });

  it('keeps owner access usable while health monitoring remains disabled', () => {
    expect(operatorCommandCenterJs).toContain("session = await get('/internal/operator/api/session')");
    expect(operatorCommandCenterJs).toContain('await refreshHealthAvailability()');
    expect(operatorCommandCenterJs).toContain('Owner access is active. Health monitoring and incident automation remain disabled pending acceptance.');
    expect(operatorCommandCenterJs).toContain("if (error.status !== 404) throw error");
    expect(operatorCommandCenterJs).not.toContain("Promise.all([get('/internal/operator/api/session')");
  });

  it('contains wide data tables without overflowing the mobile page', () => {
    expect(operatorCommandCenterCss).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(operatorCommandCenterCss).toContain('.table-wrap { width: 100%; overflow-x: auto; }');
    expect(operatorCommandCenterCss).toContain('.sidebar.menu-open nav');
    expect(operatorCommandCenterJs).toContain("classList.toggle('menu-open')");
    expect(operatorCommandCenterJs).toContain('window.scrollTo(0, 0)');
  });
});
