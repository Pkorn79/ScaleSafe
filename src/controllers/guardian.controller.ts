import { Request, Response } from 'express';
import { GUARDIAN_PATHS } from '../constants/guardian-checks';
import { GuardianAuthentication } from '../types/guardian';
import { guardianIngestionService } from '../services/guardian-ingestion.service';
import { guardianSnapshotService } from '../services/guardian-snapshot.service';
import {
  validateGuardianIngestionResponse,
  validateGuardianSnapshotResponse,
} from '../services/guardian-protocol.service';

function authentication(res: Response): GuardianAuthentication {
  const value = res.locals.guardianAuthentication as GuardianAuthentication | undefined;
  if (!value) throw new Error('Guardian authentication context is missing');
  return value;
}

export const guardianController = {
  async snapshot(_req: Request, res: Response): Promise<void> {
    const auth = authentication(res);
    if (auth.exactPath !== GUARDIAN_PATHS.snapshot) {
      throw new Error('Guardian snapshot path mismatch');
    }
    const { claim } = await guardianIngestionService.validateAndClaim(auth);
    const snapshot = await guardianSnapshotService.build(
      claim.acceptedSequence || auth.sequence,
    );
    if (!validateGuardianSnapshotResponse(snapshot)) {
      throw new Error('Guardian snapshot response failed its protocol contract');
    }
    res.status(200).json(snapshot);
  },

  async ingest(_req: Request, res: Response): Promise<void> {
    const auth = authentication(res);
    const { claim } = await guardianIngestionService.validateAndClaim(auth);
    const body = guardianIngestionService.successBody(claim);
    if (!validateGuardianIngestionResponse(body)) {
      throw new Error('Guardian ingestion response failed its protocol contract');
    }
    res
      .status(claim.decision === 'accepted' ? 201 : 200)
      .json(body);
  },
};
