import fs from 'fs';
import path from 'path';
import request from 'supertest';

const mockGetCredentialByKeyId = jest.fn();
const mockClaimRequest = jest.fn();
const mockGetSnapshotInputs = jest.fn();
const mockHasActiveSnapshotCredential = jest.fn();

jest.mock('../../src/repositories/guardian.repository', () => ({
  guardianRepository: {
    getCredentialByKeyId: (...args: any[]) => mockGetCredentialByKeyId(...args),
    claimRequest: (...args: any[]) => mockClaimRequest(...args),
    getSnapshotInputs: (...args: any[]) => mockGetSnapshotInputs(...args),
    hasActiveSnapshotCredential: (...args: any[]) =>
      mockHasActiveSnapshotCredential(...args),
  },
}));

import { createApp } from '../../src/app';
import { config } from '../../src/config';

const vectors = JSON.parse(fs.readFileSync(
  path.join(process.cwd(), 'protocol', 'guardian', 'v1', 'test-vectors.json'),
  'utf8',
));
const publicKey = Buffer.from(vectors.test_key.public_key_hex, 'hex');
const receiptId = '00000000-0000-4000-8000-000000009901';
const recordId = '00000000-0000-4000-8000-000000009902';

function claimEvaluator(vector: any, counters: {
  lastSequence: string;
  receiptDelta: number;
  domainMutationDelta: number;
}) {
  return async (input: any) => {
    const state = vector.database_state;
    const auth = input.authentication;
    const rateBucket = (state.rate_limit_buckets || []).find(
      (bucket: any) => bucket.endpoint_path === auth.exactPath,
    );
    const rateLimit = auth.exactPath.endsWith('/snapshot')
      ? 120
      : auth.exactPath.endsWith('/runs')
        ? 30
        : auth.exactPath.endsWith('/alert-deliveries')
          ? 120
        : 12;
    if (rateBucket && Number(rateBucket.request_count) >= rateLimit) {
      return rejected('RATE_LIMITED');
    }

    const sequence = BigInt(auth.sequence);
    const lastSequence = BigInt(state.last_sequence);
    if (sequence === lastSequence) {
      const receipt = (state.accepted_receipts || []).find(
        (candidate: any) =>
          candidate.sequence === auth.sequence
          && candidate.method === auth.method
          && candidate.path === auth.exactPath
          && candidate.body_sha256 === auth.bodySha256,
      );
      if (!receipt) return rejected('SEQUENCE_REUSE');
      return {
        decision: 'duplicate',
        receiptId: receipt.receipt_id,
        originalReceiptId: null,
        acceptedSequence: auth.sequence,
        acceptedObservationCount: Number(receipt.observation_count || 0),
        recordId: receipt.record_id || null,
        rejectionCode: null,
        serverTime: vectors.constants.verification_time_utc
          || '2026-07-25T17:00:00.000Z',
      };
    }
    if (sequence < lastSequence) return rejected('STALE_SEQUENCE');
    if (sequence !== lastSequence + BigInt(1)) return rejected('SEQUENCE_GAP');

    const logicalId = input.payload?.run_id
      || input.payload?.verification_id
      || input.payload?.delivery_id
      || null;
    const logicalRecord = logicalId
      ? (state.logical_records || []).find(
        (record: any) => record.logical_id === logicalId,
      )
      : null;
    if (logicalRecord && logicalRecord.body_sha256 !== auth.bodySha256) {
      return rejected('LOGICAL_ID_CONFLICT');
    }

    counters.lastSequence = auth.sequence;
    counters.receiptDelta += 1;
    if (logicalRecord) {
      return {
        decision: 'logical_duplicate',
        receiptId,
        originalReceiptId: logicalRecord.receipt_id,
        acceptedSequence: auth.sequence,
        acceptedObservationCount: Number(logicalRecord.observation_count || 0),
        recordId: logicalRecord.record_id || null,
        rejectionCode: null,
        serverTime: '2026-07-25T17:00:00.000Z',
      };
    }

    if (input.payload?.run_id) {
      counters.domainMutationDelta += input.payload.observation_count + 1;
    } else if (input.payload?.verification_id) {
      counters.domainMutationDelta += 1;
    } else if (input.payload?.delivery_id) {
      counters.domainMutationDelta += 1;
    }
    return {
      decision: 'accepted',
      receiptId,
      originalReceiptId: null,
      acceptedSequence: auth.sequence,
      acceptedObservationCount: Number(input.payload?.observation_count || 0),
      recordId: input.payload ? recordId : null,
      rejectionCode: null,
      serverTime: '2026-07-25T17:00:00.000Z',
    };
  };
}

function rejected(rejectionCode: string) {
  return {
    decision: 'rejected',
    receiptId: null,
    originalReceiptId: null,
    acceptedSequence: null,
    acceptedObservationCount: 0,
    recordId: null,
    rejectionCode,
    serverTime: '2026-07-25T17:00:00.000Z',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .spyOn(Date, 'now')
    .mockReturnValue(new Date('2026-07-25T17:00:00.000Z').getTime());
  (config.guardian as any).enabled = true;
  (config.guardian as any).host = 'guardian.scalesafe.app';
  (config.guardian as any).maxBodyBytes = 65_536;
  (config.guardian as any).timestampToleranceSeconds = 300;
  (config.guardian as any).snapshotTtlSeconds = 300;
  (config.guardian as any).buildSha =
    '67d9ea3f40d8882b0bbcd32163f0736261257597';
  (config.guardian as any).applicationVersion = '1.0.0';
  mockGetSnapshotInputs.mockResolvedValue({
    schemaVersion: 105,
    healthRows: [],
    openIncidents: { info: 0, warning: 0, urgent: 0, critical: 0 },
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Guardian route protocol vectors', () => {
  it.each(vectors.vectors as any[])('$name', async (vector: any) => {
    const state = vector.database_state;
    const counters = {
      lastSequence: state.last_sequence,
      receiptDelta: 0,
      domainMutationDelta: 0,
    };
    mockGetCredentialByKeyId.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000009900',
      keyId: state.key_id,
      instanceId: state.instance_id,
      publicKey,
      status: state.status,
      validFrom: state.valid_from,
      validUntil: state.valid_until,
    });
    mockClaimRequest.mockImplementation(claimEvaluator(vector, counters));

    const target = request(createApp());
    let operation = vector.request.method === 'GET'
      ? target.get(vector.request.request_path)
      : target.post(vector.request.request_path);
    operation = operation.set('Host', 'guardian.scalesafe.app');
    for (const [name, value] of Object.entries(vector.request.headers)) {
      operation = operation.set(name, String(value));
    }
    const rawBody = Buffer.from(vector.request.raw_body_base64url, 'base64url');
    if (vector.request.method === 'POST') {
      operation = operation.send(rawBody.toString('utf8'));
    }

    const response = await operation;
    expect(response.status).toBe(vector.expected.http_status);
    if (vector.expected.error_code) {
      expect(response.body.error_code).toBe(vector.expected.error_code);
    }
    if (vector.expected.status && vector.expected.status !== 'snapshot') {
      expect(response.body.status).toBe(vector.expected.status);
    }
    expect(counters.lastSequence).toBe(vector.expected.resulting_last_sequence);
    expect(counters.receiptDelta).toBe(vector.expected.receipt_delta);
    expect(counters.domainMutationDelta).toBe(
      vector.expected.domain_mutation_delta,
    );
  });
});

describe('Guardian fail-closed routing', () => {
  it('returns the generic internal 404 before parsing when disabled', async () => {
    (config.guardian as any).enabled = false;
    const response = await request(createApp())
      .post('/internal/guardian/v1/runs')
      .set('Host', 'guardian.scalesafe.app')
      .set('Content-Type', 'application/json')
      .send(Buffer.alloc(70_000, 97));

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'NOT_FOUND', message: 'Not found' });
    expect(mockGetCredentialByKeyId).not.toHaveBeenCalled();
  });

  it('does not expose Guardian routes on the operator or merchant host', async () => {
    for (const host of ['ops.scalesafe.app', 'dashboard.scalesafe.app']) {
      const response = await request(createApp())
        .get('/internal/guardian/v1/snapshot')
        .set('Host', host);
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'NOT_FOUND', message: 'Not found' });
    }
  });
});
