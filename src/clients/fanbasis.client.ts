import axios, { AxiosInstance } from 'axios';

/**
 * FanBasis API client (Phase F1 = shell). FanBasis is a Merchant-of-Record checkout provider
 * (Model B), NOT a ProcessorInterface rail — it is intentionally separate from NMI/Stripe.
 *
 * Endpoint shapes below are drawn from the public docs + an INDEPENDENT third-party SDK
 * (subtain-haider/laravel-payments). Treat them as HINTS, not a binding contract, until proven in
 * the FanBasis sandbox — see the sandbox gate in docs/FANBASIS_INTEGRATION_BUILD_PLAN.md /
 * the approved plan. Phase F2/F3 implement checkout, webhooks, refunds, and reconciliation.
 */

const FANBASIS_BASE: Record<FanbasisEnvironment, string> = {
  production: 'https://www.fanbasis.com/public-api',
  sandbox: 'https://qa.dev-fan-basis.com/public-api',
};

export type FanbasisEnvironment = 'production' | 'sandbox';

export interface FanbasisClientOptions {
  apiKey: string;
  environment?: FanbasisEnvironment;
}

export interface FanbasisTestResult {
  ok: boolean;
  status: number;
  message?: string;
}

export class FanbasisClient {
  private readonly http: AxiosInstance;
  readonly environment: FanbasisEnvironment;

  constructor(opts: FanbasisClientOptions) {
    this.environment = opts.environment || 'sandbox';
    this.http = axios.create({
      baseURL: FANBASIS_BASE[this.environment],
      headers: { 'x-api-key': opts.apiKey, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
  }

  /**
   * Lightweight credential check used by the Settings "Test connection" button.
   *
   * ⚠️ The canonical auth-check endpoint is UNCONFIRMED (sandbox gate item). The path below is a
   * best-effort placeholder; until it is confirmed against the FanBasis sandbox with a real test
   * key, a result here is indicative only and may be a false negative. Update the path once known.
   */
  async testConnection(): Promise<FanbasisTestResult> {
    try {
      // TODO(sandbox-gate): confirm the canonical lightweight authenticated endpoint.
      const res = await this.http.get('/checkout-sessions', { params: { limit: 1 } });
      return { ok: true, status: res.status };
    } catch (err: any) {
      const status = err?.response?.status ?? 0;
      const message = err?.response?.data?.message || err?.message || 'FanBasis connection failed';
      return { ok: false, status, message };
    }
  }

  // ── Surface implemented in later phases (shells; gated on the sandbox proof) ───────────────
  // F2: checkout. F3: refunds + reconciliation. Kept as explicit shells so the shape is visible
  // but no unverified behavior ships in F1.
  async createCheckoutSession(_input: unknown): Promise<never> {
    throw new Error('FanbasisClient.createCheckoutSession is implemented in Phase F2');
  }
  async createEmbeddedSession(_input: unknown): Promise<never> {
    throw new Error('FanbasisClient.createEmbeddedSession is implemented in Phase F2');
  }
  async getTransactions(_input: unknown): Promise<never> {
    throw new Error('FanbasisClient.getTransactions is implemented in Phase F3');
  }
  async getSubscription(_input: unknown): Promise<never> {
    throw new Error('FanbasisClient.getSubscription is implemented in Phase F2/F3');
  }
  async refundTransaction(_input: unknown): Promise<never> {
    throw new Error('FanbasisClient.refundTransaction is implemented in Phase F3');
  }
  async cancelSubscription(_input: unknown): Promise<never> {
    throw new Error('FanbasisClient.cancelSubscription is implemented in a later phase');
  }
}

export function makeFanbasisClient(opts: FanbasisClientOptions): FanbasisClient {
  return new FanbasisClient(opts);
}
