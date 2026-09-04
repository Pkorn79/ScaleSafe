import express, { NextFunction, Request, Response, Router } from 'express';
import { config } from '../config';
import { guardianController } from '../controllers/guardian.controller';
import {
  GUARDIAN_PATHS,
} from '../constants/guardian-checks';
import {
  authenticateGuardianRequest,
  guardianFeatureAndHost,
  rejectGuardianQueryString,
  sendGuardianError,
} from '../middleware/guardianSignature';
import { GuardianRequestError } from '../types/guardian';
import { logger } from '../utils/logger';

const router = Router();

function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };
}

function exactRouteBoundary(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const allowed = (
    req.method === 'GET'
    && req.originalUrl === GUARDIAN_PATHS.snapshot
  ) || (
    req.method === 'POST'
    && (
      req.originalUrl === GUARDIAN_PATHS.runs
      || req.originalUrl === GUARDIAN_PATHS.recoveryVerifications
      || req.originalUrl === GUARDIAN_PATHS.alertDeliveries
    )
  );
  if (!allowed) {
    sendGuardianError(res, 404, 'NOT_FOUND', res.locals.guardianRequestId);
    return;
  }
  next();
}

function requireJsonForPost(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.method === 'POST' && !req.is('application/json')) {
    sendGuardianError(
      res,
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      res.locals.guardianRequestId,
    );
    return;
  }
  next();
}

function rejectDeclaredOversize(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const rawLength = req.headers['content-length'];
  if (
    typeof rawLength === 'string'
    && /^[0-9]+$/.test(rawLength)
    && BigInt(rawLength) > BigInt(config.guardian.maxBodyBytes)
  ) {
    sendGuardianError(
      res,
      413,
      'PAYLOAD_TOO_LARGE',
      res.locals.guardianRequestId,
    );
    return;
  }
  next();
}

router.use(guardianFeatureAndHost);
router.use(rejectGuardianQueryString);
router.use(exactRouteBoundary);
router.use(requireJsonForPost);
router.use(rejectDeclaredOversize);
router.use(express.raw({
  type: () => true,
  limit: config.guardian.maxBodyBytes,
}));
router.use(authenticateGuardianRequest);

router.get('/v1/snapshot', asyncRoute(guardianController.snapshot));
router.post('/v1/runs', asyncRoute(guardianController.ingest));
router.post(
  '/v1/recovery-verifications',
  asyncRoute(guardianController.ingest),
);
router.post(
  '/v1/alert-deliveries',
  asyncRoute(guardianController.ingest),
);

router.use((
  error: any,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  const requestId = res.locals.guardianRequestId;
  if (error instanceof GuardianRequestError) {
    sendGuardianError(res, error.statusCode, error.errorCode, requestId);
    return;
  }
  if (error?.type === 'entity.too.large' || error?.status === 413) {
    sendGuardianError(res, 413, 'PAYLOAD_TOO_LARGE', requestId);
    return;
  }
  if (error?.type === 'encoding.unsupported' || error?.status === 415) {
    sendGuardianError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', requestId);
    return;
  }

  logger.error(
    {
      requestId,
      errorClass: String(error?.name || 'Error').slice(0, 80),
    },
    'Guardian request failed unexpectedly',
  );
  sendGuardianError(res, 500, 'INTERNAL_ERROR', requestId);
});

export default router;
