import { Request, Response, NextFunction } from 'express';
import { evidenceConnectionService } from '../services/evidence-connection.service';
import { evidenceConnectorService } from '../services/evidence-connector.service';
import { evidenceConnectorRepository } from '../repositories/evidence-connector.repository';
import { externalEvidenceAttachmentService } from '../services/external-evidence-attachment.service';
import { evidenceEnrollmentContextService } from '../services/evidence-enrollment-context.service';
import { ValidationError } from '../utils/errors';
import { integrationCatalogService } from '../services/integration-catalog.service';
import { ghlFulfillmentService } from '../services/ghl-fulfillment.service';

function tenant(req: Request): string {
  const locationId = req.tenantContext?.locationId;
  if (!locationId) throw new ValidationError('Tenant context required');
  return locationId;
}

function actor(req: Request): string {
  return req.tenantContext?.email || req.tenantContext?.userId || 'merchant_user';
}

function requireConnector(req: Request) {
  if (!req.evidenceConnector) throw new ValidationError('Evidence connector authentication required');
  return req.evidenceConnector;
}

function publicEvent(row: any) {
  const enrollment = Array.isArray(row.enrollment) ? row.enrollment[0] : row.enrollment;
  const offer = Array.isArray(row.offer) ? row.offer[0] : row.offer;
  const email = String(enrollment?.email || '');
  const maskedEmail = email.includes('@')
    ? `${email.slice(0, 2)}***@${email.split('@')[1]}`
    : '';
  return {
    id: row.id,
    sourceEventId: row.source_event_id,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
    status: row.status,
    isTest: row.is_test,
    resolutionMethod: row.resolution_method,
    enrollmentId: row.enrollment_id,
    evidenceType: row.evidence_type,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    target: row.enrollment_id ? {
      enrollmentId: row.enrollment_id,
      contactId: enrollment?.contact_id || row.contact_id || '',
      client: maskedEmail,
      offerId: row.offer_id || enrollment?.offer_id || '',
      offerName: offer?.offer_name || enrollment?.offer_name || '',
      matchMethod: row.resolution_method || '',
    } : null,
  };
}

export const evidenceConnectorController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try { res.json({ connections: await evidenceConnectionService.list(tenant(req)) }); } catch (err) { next(err); }
  },

  async catalog(req: Request, res: Response, next: NextFunction) {
    try { res.json(await integrationCatalogService.list(tenant(req))); } catch (err) { next(err); }
  },

  async connectCatalogProvider(req: Request, res: Response, next: NextFunction) {
    try {
      res.status(201).json(await integrationCatalogService.connect(
        tenant(req),
        actor(req),
        String(req.params.providerKey || ''),
        req.body || {},
      ));
    } catch (err) { next(err); }
  },

  async offerOptions(req: Request, res: Response, next: NextFunction) {
    try { res.json({ options: await integrationCatalogService.offerOptions(tenant(req)) }); } catch (err) { next(err); }
  },

  async ghlNativeHealth(req: Request, res: Response, next: NextFunction) {
    try { res.json(await ghlFulfillmentService.getHealth(tenant(req))); } catch (err) { next(err); }
  },

  async merchantStatus(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await integrationCatalogService.setMerchantStatus(
        tenant(req), req.params.id, actor(req), req.body?.enabled === true,
      ));
    } catch (err) { next(err); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try { res.status(201).json(await evidenceConnectionService.create(tenant(req), actor(req), req.body || {})); } catch (err) { next(err); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try { res.json(await evidenceConnectionService.update(tenant(req), req.params.id, actor(req), req.body || {})); } catch (err) { next(err); }
  },

  async rotate(req: Request, res: Response, next: NextFunction) {
    try { res.json(await evidenceConnectionService.rotate(tenant(req), req.params.id, actor(req), req.body?.graceHours)); } catch (err) { next(err); }
  },

  async status(req: Request, res: Response, next: NextFunction) {
    try { res.json(await evidenceConnectionService.setStatus(tenant(req), req.params.id, actor(req), req.body?.enabled === true)); } catch (err) { next(err); }
  },

  async preview(req: Request, res: Response, next: NextFunction) {
    try { res.json(await evidenceConnectionService.preview(tenant(req), req.params.id, req.body?.payload || {})); } catch (err) { next(err); }
  },

  async events(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = tenant(req);
      const connection = await evidenceConnectorRepository.getConnection(locationId, req.params.id);
      if (!connection) throw new ValidationError('Evidence connection not found');
      const rows = await evidenceConnectorRepository.listEvents(locationId, connection.id, Number(req.query.limit || 50));
      res.json({ events: rows.map(publicEvent) });
    } catch (err) { next(err); }
  },

  async subjects(req: Request, res: Response, next: NextFunction) {
    try {
      const rows = await evidenceConnectorRepository.listSubjects(tenant(req), Number(req.query.limit || 100));
      res.json({ subjects: rows.map((row: any) => ({
        enrollmentId: row.enrollment_id,
        enrollmentRef: row.enrollment_ref,
        contactId: row.contact_id,
        email: row.normalized_email,
        offerId: row.offer_id,
        offerName: row.offer?.offer_name || '',
        status: row.enrollment?.status || '',
      })) });
    } catch (err) { next(err); }
  },

  async sendTest(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = tenant(req);
      const result = await evidenceConnectionService.sendTest(
        locationId,
        req.params.id,
        String(req.body?.enrollmentId || ''),
        actor(req),
        String(req.body?.eventType || 'service.login'),
      );
      res.status(202).json({
        event: publicEvent(result.event),
        target: result.target,
        message: 'Test accepted. It will validate matching but will not create evidence.',
      });
    } catch (err) { next(err); }
  },

  async createEnrollmentLink(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await evidenceEnrollmentContextService.createEnrollmentLink(requireConnector(req), req.body || {});
      res.status(result.idempotentReplay ? 200 : 201).json(result);
    } catch (err) { next(err); }
  },

  async bindSubject(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await evidenceEnrollmentContextService.bindExistingSubject(requireConnector(req), req.body || {}));
    } catch (err) { next(err); }
  },

  async ingestCanonical(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await evidenceConnectorService.ingestCanonical(requireConnector(req), req.body || {}, req.rawBody, false);
      res.status(result.duplicate ? 200 : 202).json({ status: result.processingStatus, eventId: result.event.id });
    } catch (err) { next(err); }
  },

  async ingestRaw(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await evidenceConnectorService.ingestRaw(requireConnector(req), req.body || {}, req.rawBody, false);
      res.status(result.duplicate ? 200 : 202).json({ status: result.processingStatus, eventId: result.event.id });
    } catch (err) { next(err); }
  },

  async prepareAttachment(req: Request, res: Response, next: NextFunction) {
    try {
      const auth = requireConnector(req);
      const result = await externalEvidenceAttachmentService.createSignedUpload(
        auth.connection,
        String(req.body?.filename || ''),
        String(req.body?.content_type || req.body?.contentType || ''),
      );
      res.status(201).json(result);
    } catch (err) { next(err); }
  },
};
