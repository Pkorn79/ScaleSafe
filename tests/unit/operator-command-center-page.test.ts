import {
  operatorAuthJs,
  operatorHomeHtml,
} from '../../src/operator-auth-page';

describe('operator Command Center page', () => {
  it('renders the health surfaces and incident controls', () => {
    const html = operatorHomeHtml();

    expect(html).toContain('id="health-summary"');
    expect(html).toContain('id="incident-rows"');
    expect(html).toContain('id="merchant-rows"');
    expect(html).toContain('id="check-rows"');
    expect(html).toContain('id="suppress-dialog"');
    expect(html).toContain('id="more-incidents"');
    expect(html).toContain('id="more-merchants"');
    expect(html).toContain('id="more-checks"');
  });

  it('renders server data through textContent and restricts mutation controls by role', () => {
    expect(operatorAuthJs).toContain('node.textContent = String(text)');
    expect(operatorAuthJs).toContain(
      "session.role === 'platform_owner' || session.role === 'platform_ops'",
    );
    expect(operatorAuthJs).not.toContain('.innerHTML');
    expect(operatorAuthJs).not.toContain('insertAdjacentHTML');
    expect(operatorAuthJs).toContain('healthCursors');
    expect(operatorAuthJs).toContain('appendUnique');
  });

  it('sends incident mutations with the host-only CSRF cookie', () => {
    expect(operatorAuthJs).toContain("cookie('__Host-scalesafe_ops_csrf')");
    expect(operatorAuthJs).toContain('/acknowledge');
    expect(operatorAuthJs).toContain('/suppress');
  });
});
