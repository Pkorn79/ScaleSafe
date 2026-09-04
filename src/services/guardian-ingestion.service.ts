import { GUARDIAN_PATHS } from '../constants/guardian-checks';
import { guardianRepository } from '../repositories/guardian.repository';
import {
  GuardianAlertDelivery,
  GuardianAuthentication,
  GuardianClaimResult,
  GuardianRecoveryVerification,
  GuardianRequestError,
  GuardianRun,
} from '../types/guardian';
import { parseGuardianPayload } from './guardian-protocol.service';

function rejectionError(rejectionCode: string | null): GuardianRequestError {
  if (
    rejectionCode === 'AUTHENTICATION_FAILED'
    || rejectionCode === 'TIMESTAMP_OUT_OF_RANGE'
  ) {
    return new GuardianRequestError(401, 'AUTHENTICATION_FAILED');
  }
  if (rejectionCode === 'RATE_LIMITED') {
    return new GuardianRequestError(429, 'RATE_LIMITED');
  }
  if (rejectionCode === 'LOGICAL_ID_CONFLICT') {
    return new GuardianRequestError(409, 'LOGICAL_ID_CONFLICT');
  }
  if (
    rejectionCode === 'SEQUENCE_REUSE'
    || rejectionCode === 'STALE_SEQUENCE'
    || rejectionCode === 'SEQUENCE_GAP'
  ) {
    return new GuardianRequestError(409, 'SEQUENCE_CONFLICT');
  }
  return new GuardianRequestError(422, 'VALIDATION_FAILED');
}

function assertClaimAccepted(claim: GuardianClaimResult): GuardianClaimResult {
  if (claim.decision === 'rejected') {
    throw rejectionError(claim.rejectionCode);
  }
  if (
    !claim.receiptId
    || !claim.acceptedSequence
    || !['accepted', 'duplicate', 'logical_duplicate'].includes(claim.decision)
  ) {
    throw new Error('Guardian claim returned an invalid accepted decision');
  }
  return claim;
}

export const guardianIngestionService = {
  async validateAndClaim(authentication: GuardianAuthentication): Promise<{
    payload: GuardianRun | GuardianRecoveryVerification | GuardianAlertDelivery | null;
    claim: GuardianClaimResult;
  }> {
    const payload = parseGuardianPayload(
      authentication.exactPath,
      authentication.rawBody,
    );
    if (
      payload
      && payload.instance_id !== authentication.credential.instanceId
    ) {
      throw new GuardianRequestError(422, 'VALIDATION_FAILED');
    }
    if (
      authentication.exactPath === GUARDIAN_PATHS.snapshot
      && payload !== null
    ) {
      throw new GuardianRequestError(422, 'VALIDATION_FAILED');
    }

    const claim = assertClaimAccepted(await guardianRepository.claimRequest({
      authentication,
      payload,
    }));
    return { payload, claim };
  },

  successBody(claim: GuardianClaimResult) {
    return {
      protocol_version: 1,
      status: claim.decision,
      receipt_id: claim.receiptId,
      original_receipt_id: claim.originalReceiptId,
      accepted_sequence: claim.acceptedSequence,
      accepted_observation_count: claim.acceptedObservationCount,
      record_id: claim.recordId,
      server_time: claim.serverTime,
    };
  },
};
