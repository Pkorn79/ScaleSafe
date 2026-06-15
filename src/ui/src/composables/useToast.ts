import { ref } from 'vue';

/**
 * App-wide toast notifications.
 *
 * Module-level singleton (same pattern as `ssoSession` in useApi.ts) so any
 * component or composable can push a toast without prop-drilling or a store.
 * Rendered once by <ToastContainer /> mounted in App.vue.
 */

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: number;
  type: ToastType;
  title?: string;
  message: string;
  /** ms before auto-dismiss; 0 = sticky (manual dismiss only) */
  timeout: number;
}

export interface ToastOptions {
  title?: string;
  timeout?: number;
}

const toasts = ref<Toast[]>([]);
let seq = 0;

// Errors and warnings linger longer than confirmations; errors are the most
// important thing a merchant must not miss on a money/defense screen.
const DEFAULT_TIMEOUTS: Record<ToastType, number> = {
  success: 4000,
  info: 5000,
  warning: 7000,
  error: 8000,
};

function dismiss(id: number): void {
  const i = toasts.value.findIndex((t) => t.id === id);
  if (i !== -1) toasts.value.splice(i, 1);
}

function push(type: ToastType, message: string, opts: ToastOptions = {}): number {
  const id = ++seq;
  const timeout = opts.timeout ?? DEFAULT_TIMEOUTS[type];
  toasts.value.push({
    id,
    type,
    message: message || 'Something went wrong',
    title: opts.title,
    timeout,
  });
  if (timeout > 0) {
    setTimeout(() => dismiss(id), timeout);
  }
  return id;
}

export const toast = {
  success: (message: string, opts?: ToastOptions) => push('success', message, opts),
  error: (message: string, opts?: ToastOptions) => push('error', message, opts),
  warning: (message: string, opts?: ToastOptions) => push('warning', message, opts),
  info: (message: string, opts?: ToastOptions) => push('info', message, opts),
  dismiss,
};

export function useToast() {
  return { toasts, toast, dismiss };
}
