import { nmiRecurringSyncService } from '../services/nmi-recurring-sync.service';
import { logger } from '../utils/logger';

export async function runNmiRecurringSync(): Promise<void> {
  try {
    const result = await nmiRecurringSyncService.syncDueEnrollments();
    logger.info(result, 'NMI recurring history sync complete');
  } catch (err: any) {
    logger.error({ err: err?.message || String(err) }, 'NMI recurring history sync failed');
  }
}
