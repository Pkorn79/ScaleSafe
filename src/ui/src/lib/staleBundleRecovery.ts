const RELOAD_KEY = 'ss_stale_bundle_reload_at';
const RELOAD_COOLDOWN_MS = 60_000;

interface PreloadRecoveryTarget {
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  location: { reload: () => void };
  sessionStorage: Pick<Storage, 'getItem' | 'setItem'>;
}

export function installStaleBundleRecovery(
  target: PreloadRecoveryTarget,
  now: () => number = Date.now,
): void {
  target.addEventListener('vite:preloadError', (event: Event) => {
    event.preventDefault();

    const currentTime = now();
    const lastReload = Number(target.sessionStorage.getItem(RELOAD_KEY) || 0);
    if (lastReload > 0 && currentTime - lastReload < RELOAD_COOLDOWN_MS) return;

    target.sessionStorage.setItem(RELOAD_KEY, String(currentTime));
    target.location.reload();
  });
}
