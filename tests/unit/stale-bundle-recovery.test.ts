import { installStaleBundleRecovery } from '../../src/ui/src/lib/staleBundleRecovery';

describe('stale bundle recovery', () => {
  it('reloads once when a deployed chunk is no longer available', () => {
    const listeners: Array<(event: Event) => void> = [];
    const values = new Map<string, string>();
    const reload = jest.fn();
    const target = {
      addEventListener: (_type: string, callback: (event: Event) => void) => { listeners.push(callback); },
      location: { reload },
      sessionStorage: {
        getItem: (key: string) => values.get(key) || null,
        setItem: (key: string, value: string) => { values.set(key, value); },
      },
    };
    const preventDefault = jest.fn();

    installStaleBundleRecovery(target, () => 100_000);
    expect(listeners).toHaveLength(1);
    listeners[0]({ preventDefault } as unknown as Event);
    listeners[0]({ preventDefault } as unknown as Event);

    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
