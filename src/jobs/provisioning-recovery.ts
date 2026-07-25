import { merchantService } from '../services/merchant.service';
import { logger } from '../utils/logger';

/** Recover installs interrupted by a deploy, restart, or transient GHL error. */
export async function runProvisioningRecovery(): Promise<{
  inspected: number;
  started: number;
  failed: number;
  waitingForOauth: number;
}> {
  const result = await merchantService.recoverPendingProvisioning();
  if (result.inspected > 0) {
    logger.info(result, 'Provisioning recovery sweep complete');
  }
  return result;
}
