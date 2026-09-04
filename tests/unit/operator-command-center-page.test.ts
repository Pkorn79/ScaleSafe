import {
  operatorCommandCenterCss,
  operatorCommandCenterHtml,
  operatorCommandCenterJs,
} from '../../src/operator-command-center-page';

describe('operator Command Center page', () => {
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

  it('contains wide data tables without overflowing the mobile page', () => {
    expect(operatorCommandCenterCss).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(operatorCommandCenterCss).toContain('.table-wrap { width: 100%; overflow-x: auto; }');
    expect(operatorCommandCenterCss).toContain('.sidebar.menu-open nav');
    expect(operatorCommandCenterJs).toContain("classList.toggle('menu-open')");
    expect(operatorCommandCenterJs).toContain('window.scrollTo(0, 0)');
  });
});
