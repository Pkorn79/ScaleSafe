import { Request } from 'express';

const mockGenerateLink = jest.fn();
const mockAuditRequest = jest.fn();
const mockRepository = {
  findActiveOrganization: jest.fn(),
  createInvitation: jest.fn(),
  createResellerOrganization: jest.fn(),
  transferAssignment: jest.fn(),
  createSupportGrant: jest.fn(),
  approveSupportGrant: jest.fn(),
  revokeSupportGrant: jest.fn(),
};

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({
    auth: {
      admin: {
        generateLink: (...args: any[]) => mockGenerateLink(...args),
      },
    },
  }),
}));

jest.mock('../../src/repositories/operator.repository', () => ({
  isOperatorRole: (role: string) => [
    'platform_owner', 'platform_ops', 'platform_support', 'security_auditor',
    'reseller_owner', 'reseller_operator', 'reseller_viewer',
  ].includes(role),
  operatorRepository: mockRepository,
}));

jest.mock('../../src/services/operator-authorization.service', () => ({
  operatorAuthorizationService: {
    auditRequest: (...args: any[]) => mockAuditRequest(...args),
  },
}));

import { operatorAdminService } from '../../src/services/operator-admin.service';

const OWNER_CONTEXT = {
  operatorUserId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  organizationId: '00000000-0000-4000-8000-000000000001',
  organizationType: 'platform',
  membershipId: '33333333-3333-4333-8333-333333333333',
  role: 'platform_owner',
  permissions: new Set([
    'operator.organizations.manage',
    'operator.invitations.manage',
    'operator.assignments.manage',
    'operator.support_grants.manage',
  ]),
  locationAccess: { mode: 'all', locationIds: new Set() },
  authAssurance: 'aal2',
  csrfTokenHash: 'a'.repeat(64),
  sessionTokenHash: 'b'.repeat(64),
};

const requestStub = {
  operatorContext: OWNER_CONTEXT,
  operatorRequestId: 'request-1',
  ip: '203.0.113.10',
  socket: { remoteAddress: '203.0.113.10' },
  headers: { 'user-agent': 'operator-test' },
} as unknown as Request;

beforeEach(() => {
  jest.clearAllMocks();
  mockAuditRequest.mockResolvedValue('audit-1');
  mockRepository.findActiveOrganization.mockResolvedValue({
    id: '44444444-4444-4444-8444-444444444444',
    organization_type: 'reseller',
    status: 'active',
  });
  mockRepository.createInvitation.mockResolvedValue({ id: 'invite-1' });
  mockRepository.createResellerOrganization.mockResolvedValue({
    id: '44444444-4444-4444-8444-444444444444',
    organization_type: 'reseller',
    name: 'Partner One',
    status: 'active',
  });
  mockRepository.transferAssignment.mockResolvedValue({
    id: '55555555-5555-4555-8555-555555555555',
    location_id: 'loc-a',
    reseller_organization_id: '44444444-4444-4444-8444-444444444444',
  });
  mockRepository.createSupportGrant.mockResolvedValue({ id: 'grant-1', status: 'pending' });
  mockGenerateLink.mockResolvedValue({
    data: {
      user: { id: 'auth-user-2' },
      properties: {
        action_link: 'https://supabase.example/auth/v1/verify?token=supabase-secret',
        hashed_token: 'supabase-hashed-token',
      },
    },
    error: null,
  });
});

describe('operator admin service audit boundary', () => {
  it('blocks reseller creation when the audit-intent write fails', async () => {
    mockAuditRequest.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(operatorAdminService.createResellerOrganization(requestStub, {
      name: 'Partner One',
    })).rejects.toThrow('audit unavailable');
    expect(mockRepository.createResellerOrganization).not.toHaveBeenCalled();
  });

  it('passes a correlation ID into the atomic organization RPC after intent succeeds', async () => {
    const result = await operatorAdminService.createResellerOrganization(requestStub, { name: 'Partner One' });
    expect(result.name).toBe('Partner One');
    expect(mockRepository.createResellerOrganization).toHaveBeenCalledWith(expect.objectContaining({
      actorOperatorUserId: OWNER_CONTEXT.operatorUserId,
      correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }));
    expect(mockAuditRequest.mock.invocationCallOrder[0]).toBeLessThan(
      mockRepository.createResellerOrganization.mock.invocationCallOrder[0],
    );
  });

  it('returns a conflict instead of an internal error for a duplicate reseller reference', async () => {
    mockRepository.createResellerOrganization.mockRejectedValueOnce(
      new Error('duplicate key value violates unique constraint "operator_organizations_external_reference_key"'),
    );

    await expect(operatorAdminService.createResellerOrganization(requestStub, {
      name: 'Partner One',
      externalReference: 'partner-one',
    })).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(mockAuditRequest).toHaveBeenCalledWith(
      requestStub,
      expect.objectContaining({
        action: 'operator.organization.create',
        result: 'failed',
        metadata: { error_class: 'database_rejected' },
      }),
    );
  });

  it('blocks assignment transfer when the audit-intent write fails', async () => {
    mockAuditRequest.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(operatorAdminService.transferAssignment(requestStub, {
      locationId: 'loc-a',
      resellerOrganizationId: '44444444-4444-4444-8444-444444444444',
      reason: 'New reseller relationship',
    })).rejects.toThrow('audit unavailable');
    expect(mockRepository.transferAssignment).not.toHaveBeenCalled();
  });

  it('returns only a single-use verification link, never a Supabase session or action link', async () => {
    const result = await operatorAdminService.createInvitation(requestStub, {
      email: 'partner@example.com',
      displayName: 'Partner User',
      organizationId: '44444444-4444-4444-8444-444444444444',
      role: 'reseller_operator',
    });
    expect(result.inviteUrl).toBe('https://ops.scalesafe.app/internal/operator/invite#invite=supabase-hashed-token');
    expect(result.inviteUrl).not.toContain('supabase-secret');
    expect(result.inviteUrl).not.toContain('partner@example.com');
    expect(result).not.toHaveProperty('access_token');
    expect(result).not.toHaveProperty('refresh_token');
    expect(mockRepository.createInvitation).toHaveBeenCalledWith(expect.objectContaining({
      auth_user_id: 'auth-user-2',
      status: 'pending',
      invite_token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    expect(mockGenerateLink).toHaveBeenCalledWith(expect.objectContaining({
      type: 'invite',
      email: 'partner@example.com',
      options: expect.objectContaining({
        redirectTo: 'https://ops.scalesafe.app/internal/operator/invite',
      }),
    }));
  });

  it('rejects a cross-organization reseller invitation before creating an auth identity', async () => {
    const resellerRequest = {
      ...requestStub,
      operatorContext: {
        ...OWNER_CONTEXT,
        organizationId: '77777777-7777-4777-8777-777777777777',
        organizationType: 'reseller',
        role: 'reseller_owner',
      },
    } as unknown as Request;

    await expect(operatorAdminService.createInvitation(resellerRequest, {
      email: 'partner@example.com',
      displayName: 'Partner User',
      organizationId: '44444444-4444-4444-8444-444444444444',
      role: 'reseller_operator',
    })).rejects.toMatchObject({ statusCode: 403 });
    expect(mockRepository.findActiveOrganization).not.toHaveBeenCalled();
    expect(mockGenerateLink).not.toHaveBeenCalled();
  });

  it('rejects a role that does not match the target organization before creating an auth identity', async () => {
    await expect(operatorAdminService.createInvitation(requestStub, {
      email: 'partner@example.com',
      displayName: 'Partner User',
      organizationId: '44444444-4444-4444-8444-444444444444',
      role: 'platform_ops',
    })).rejects.toMatchObject({ statusCode: 403 });
    expect(mockGenerateLink).not.toHaveBeenCalled();
  });

  it('creates support access as pending so a different owner must approve it', async () => {
    const grant = await operatorAdminService.requestSupportGrant(requestStub, {
      granteeOperatorUserId: '66666666-6666-4666-8666-666666666666',
      locationId: 'loc-a',
      reason: 'Investigate merchant installation',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    expect(grant.status).toBe('pending');
    expect(mockRepository.createSupportGrant).toHaveBeenCalledWith(expect.objectContaining({
      requestedByOperatorUserId: OWNER_CONTEXT.operatorUserId,
      correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }));
  });
});
