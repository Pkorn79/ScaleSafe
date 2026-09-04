const mockHasActiveSnapshotCredential = jest.fn();

jest.mock('../../src/repositories/guardian.repository', () => ({
  guardianRepository: {
    hasActiveSnapshotCredential: (...args: any[]) =>
      mockHasActiveSnapshotCredential(...args),
  },
}));

import { config } from '../../src/config';
import { guardianReadinessService } from '../../src/services/guardian-readiness.service';

beforeEach(() => {
  jest.clearAllMocks();
  (config.guardian as any).enabled = false;
});
test('does not read Guardian schema state while the feature is disabled', async () => {
  await expect(guardianReadinessService.assertReady()).resolves.toBeUndefined();
  expect(mockHasActiveSnapshotCredential).not.toHaveBeenCalled();
});

test('requires one active snapshot-authorized public credential', async () => {
  (config.guardian as any).enabled = true;
  mockHasActiveSnapshotCredential.mockResolvedValue(false);

  await expect(guardianReadinessService.assertReady()).rejects.toThrow(
    /active public credential/i,
  );

  mockHasActiveSnapshotCredential.mockResolvedValue(true);
  await expect(guardianReadinessService.assertReady()).resolves.toBeUndefined();
});
