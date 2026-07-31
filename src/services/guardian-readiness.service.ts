import { config } from '../config';
import { guardianRepository } from '../repositories/guardian.repository';

export const guardianReadinessService = {
  async assertReady(): Promise<void> {
    if (!config.guardian.enabled) return;
    const hasCredential = await guardianRepository.hasActiveSnapshotCredential();
    if (!hasCredential) {
      throw new Error(
        'Guardian ingestion requires an active public credential authorized for snapshots',
      );
    }
  },
};
