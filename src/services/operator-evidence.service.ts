import axios from 'axios';
import { config } from '../config';

export const EVIDENCE_ORIGIN = 'https://scalesafe-client-evidence-production.up.railway.app';
const METRICS = ['customers', 'purchases', 'open_disputes', 'evidence_records', 'capture_issues', 'queued_jobs'] as const;
type Metrics = Record<typeof METRICS[number], number>;
export interface EvidenceOverview {
  product: 'scalesafe-client-evidence';
  contractVersion: 'command-center-evidence-v1';
  generatedAt: string;
  summary: Metrics & { merchants: number; active_merchants: number };
  merchants: Array<Metrics & { location_id: string; active: boolean; beta_enabled: boolean; installed_at: string; last_capture_at: string | null }>;
  pagination: { limit: number; offset: number; total: number };
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid metric');
  return value;
}
function metrics(value: any): Metrics {
  return Object.fromEntries(METRICS.map((key) => [key, count(value?.[key])])) as Metrics;
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) throw new Error('Invalid timestamp');
  return new Date(value).toISOString();
}

// Explicit projection is intentional: even a future producer must not leak
// customer records, credentials, arbitrary URLs or document text into this UI.
export function projectEvidenceOverview(data: any, limit: number, offset: number): EvidenceOverview {
  if (data?.product !== 'scalesafe-client-evidence' || data.contractVersion !== 'command-center-evidence-v1') throw new Error('Wrong product contract');
  const generatedAt = timestamp(data.generatedAt);
  if (Date.parse(generatedAt) > Date.now() + 60000) throw new Error('Invalid report clock');
  const summary = { ...metrics(data.summary), merchants: count(data.summary?.merchants), active_merchants: count(data.summary?.active_merchants) };
  if (summary.active_merchants > summary.merchants || data.pagination?.limit !== limit || data.pagination?.offset !== offset
    || data.pagination?.total !== summary.merchants || !Array.isArray(data.merchants)
    || data.merchants.length !== Math.min(limit, Math.max(0, summary.merchants - offset))) throw new Error('Invalid page');
  const ids = new Set<string>();
  const merchants = data.merchants.map((row: any) => {
    if (typeof row.location_id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(row.location_id)
      || ids.has(row.location_id) || typeof row.active !== 'boolean' || typeof row.beta_enabled !== 'boolean') throw new Error('Invalid merchant');
    ids.add(row.location_id);
    return { ...metrics(row), location_id: row.location_id, active: row.active, beta_enabled: row.beta_enabled,
      installed_at: timestamp(row.installed_at), last_capture_at: row.last_capture_at === null ? null : timestamp(row.last_capture_at) };
  });
  return { product: 'scalesafe-client-evidence', contractVersion: 'command-center-evidence-v1', generatedAt, summary, merchants,
    pagination: { limit, offset, total: summary.merchants } };
}

export const operatorEvidenceService = {
  async overview(limit: number, offset: number) {
    const token = config.operator.evidenceReadToken;
    if (!token) return { connection: 'not_configured' as const };
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) return { connection: 'unavailable' as const };
    try {
      const response = await axios.get(EVIDENCE_ORIGIN + '/internal/command-center/overview', {
        params: { limit, offset }, headers: { Authorization: 'Bearer ' + token },
        timeout: 6000, maxRedirects: 0, maxContentLength: 262144, proxy: false,
      });
      return { connection: 'connected' as const, ...projectEvidenceOverview(response.data, limit, offset) };
    } catch {
      // Axios errors contain request headers. Do not pass them to logging or the browser.
      return { connection: 'unavailable' as const };
    }
  },
};
