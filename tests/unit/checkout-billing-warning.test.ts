import fs from 'fs';
import path from 'path';
import vm from 'vm';
const source = fs.readFileSync(path.join(process.cwd(), 'src/routes/checkout.routes.ts'), 'utf8');

describe('checkout billing warning runtime branches', () => {
  it.each([true, false])('does not advance or redirect after setup failure (iframe=%s)', iframe => {
    const begin = source.indexOf('      // Success\n') >= 0 ? source.indexOf('      // Success\n') : source.indexOf('      // Success\r\n');
    const end = source.indexOf('    } catch(err)', begin);
    expect(begin).toBeGreaterThan(0); expect(end).toBeGreaterThan(begin);
    const nodes: Record<string, any> = {};
    const parentPost = jest.fn(); const timer = jest.fn();
    const clearAttempt = jest.fn();
    const window: any = { location: { href: 'unchanged' } };
    window.parent = iframe ? {} : window;
    vm.runInNewContext(`(function(){${source.slice(begin, end)}})()`, {
      data: { success: true, billingIssue: { code: 'processor_subscription_creation_failed' } },
      paymentAttemptScope: 'same-attempt', clearCheckoutPaymentAttempt: clearAttempt,
      el: (id: string) => nodes[id] ||= { style: {}, classList: { add: jest.fn() }, textContent: '' },
      window, ssCheckoutPostToParent: parentPost, setTimeout: timer,
    });
    expect(nodes['success-msg'].textContent).toContain('Automatic billing is not confirmed');
    expect(nodes['success-msg'].textContent).toContain('Do not pay again');
    expect(parentPost).not.toHaveBeenCalled(); expect(timer).not.toHaveBeenCalled();
    expect(clearAttempt).not.toHaveBeenCalled();
    expect(window.location.href).toBe('unchanged');
  });
  it('blocks provider-element success messaging and disables a repeat payment', () => {
    const begin = source.indexOf('      state.processing = false;', source.indexOf("requestThreeDSecure: false"));
    const end = source.indexOf("      } else if (data.threeDSecureUrl)", begin);
    expect(begin).toBeGreaterThan(0); expect(end).toBeGreaterThan(begin);
    const button = { disabled: false }; const post = jest.fn(); const showError = jest.fn();
    const state = { processing: true };
    vm.runInNewContext(`(function(){${source.slice(begin, end)} }})()`, {
      state, data: { success: true, billingIssue: {} }, setLoading: jest.fn(), el: () => button,
      showError, ssPostToParent: post,
    });
    expect(button.disabled).toBe(true); expect(state.processing).toBe(true);
    expect(post).not.toHaveBeenCalled(); expect(showError).toHaveBeenCalledWith(expect.stringContaining('Do not pay again'));
  });
});
