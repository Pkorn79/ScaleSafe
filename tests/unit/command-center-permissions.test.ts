jest.mock('../../src/config', () => ({
  config: {
    operator: {
      sessionIdleMinutes: 30,
    },
  },
}));

jest.mock('../../src/repositories/operator.repository', () => ({
  operatorRepository: {},
  isOperatorRole: jest.fn(),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { warn: jest.fn() },
}));

jest.mock('../../src/utils/operator-security', () => ({
  hashOperatorValue: jest.fn(),
  operatorIpHash: jest.fn(),
  operatorUserAgent: jest.fn(),
}));

import { operatorAuthorizationService } from '../../src/services/operator-authorization.service';

test('Phase 2 permissions are limited to platform roles', () => {
  expect(operatorAuthorizationService.permissionsForRole('platform_owner').has('platform.health.read')).toBe(true);
  expect(operatorAuthorizationService.permissionsForRole('platform_owner').has('platform.merchants.read')).toBe(true);
  expect(operatorAuthorizationService.permissionsForRole('platform_owner').has('platform.resellers.read')).toBe(true);
  expect(operatorAuthorizationService.permissionsForRole('platform_owner').has('platform.incidents.manage')).toBe(true);
  expect(operatorAuthorizationService.permissionsForRole('platform_ops').has('platform.incidents.manage')).toBe(true);
  expect(operatorAuthorizationService.permissionsForRole('platform_ops').has('platform.merchants.read')).toBe(true);
  expect(operatorAuthorizationService.permissionsForRole('platform_ops').has('platform.resellers.read')).toBe(false);
  expect(operatorAuthorizationService.permissionsForRole('platform_support').has('platform.health.read')).toBe(true);
  expect(operatorAuthorizationService.permissionsForRole('platform_support').has('platform.incidents.manage')).toBe(false);
  expect(operatorAuthorizationService.permissionsForRole('security_auditor').has('platform.health.read')).toBe(true);
  expect(operatorAuthorizationService.permissionsForRole('security_auditor').has('platform.incidents.manage')).toBe(false);

  for (const role of ['reseller_owner', 'reseller_operator', 'reseller_viewer'] as const) {
    expect(operatorAuthorizationService.permissionsForRole(role).has('platform.health.read')).toBe(false);
    expect(operatorAuthorizationService.permissionsForRole(role).has('platform.merchants.read')).toBe(false);
    expect(operatorAuthorizationService.permissionsForRole(role).has('platform.resellers.read')).toBe(false);
    expect(operatorAuthorizationService.permissionsForRole(role).has('platform.incidents.manage')).toBe(false);
  }
});
