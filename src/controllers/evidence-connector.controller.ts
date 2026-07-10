import { Request, Response, NextFunction } from 'express';
import { evidenceConnectionService } from '../services/evidence-connection.service';
import { evidenceConnectorService } from '../services/evidence-connector.service';
import { evidenceConnectorRepository } from '../repositories/evidence-connector.repository';
import { externalEvidenceAttachmentService } from '../services/external-evidence-attachment.service';
import { ValidationError } from '../utils/errors';

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
  };
}

export const evidenceConnectorController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try { res.json({ connections: await evidenceConnectionService.list(tenant(req)) }); } catch (err) { next(err); }
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
      const connection = await evidenceConnectorRepository.getConnection(locationId, req.params.id);
      if (!connection) throw new ValidationError('Evidence connection not found');
      const subject = await evidenceConnectorRepository.getSubjectByEnrollment(locationId, String(req.body?.enrollmentId || ''));
      if (!subject) throw new ValidationError('Choose a valid enrollment for the test');
      const credentials = await evidenceConnectorRepository.listActiveCredentials(connection.id);
      if (!credentials[0]) throw new ValidationError('Connection has no active credential');
      const eventType = String(req.body?.eventType || 'service.login');
      const event = {
        schema_version: '1.0',
        event_id: `test_${Date.now()}`,
        event_type: eventType,
        occurred_at: new Date().toISOString(),
        subject: { enrollment_ref: subject.enrollment_ref },
        resource: { type: 'test', id: 'test_resource', name: 'Connector Test Activity' },
        actor: { type: 'client' },
        activity: { status: 'completed', description: 'Synthetic validation event. This does not become evidence.' },
        attachments: [],
        metadata: {},
      };
      const result = await evidenceConnectorService.ingestCanonical({
        connection,
        credential: credentials[0],
        authMethod: credentials[0].credential_type,
        signatureVerified: credentials[0].credential_type === 'hmac',
      }, event, undefined, true);
      await evidenceConnectorRepository.audit(locationId, connection.id, 'connection.test_sent', actor(req), { enrollmentId: subject.enrollment_id });
      res.status(202).json({ event: publicEvent(result.event), message: 'Test accepted. It will validate matching but will not create evidence.' });
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
