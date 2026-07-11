import { Router } from 'express';
import { evidenceConnectorController } from '../controllers/evidence-connector.controller';
import { ssoAuth } from '../middleware/ssoAuth';
import { requireTenant } from '../middleware/tenantContext';
import { requireCanonicalEvidenceApiKey } from '../middleware/evidenceConnectorAuth';

export const evidenceConnectionManagementRoutes = Router();
evidenceConnectionManagementRoutes.use(ssoAuth, requireTenant);
evidenceConnectionManagementRoutes.get('/', evidenceConnectorController.list);
evidenceConnectionManagementRoutes.get('/:id/events', evidenceConnectorController.events);

export const evidenceConnectorPublicRoutes = Router();
evidenceConnectorPublicRoutes.post('/events', requireCanonicalEvidenceApiKey, evidenceConnectorController.ingestCanonical);
evidenceConnectorPublicRoutes.post('/attachments', requireCanonicalEvidenceApiKey, evidenceConnectorController.prepareAttachment);
evidenceConnectorPublicRoutes.post('/enrollment-links', requireCanonicalEvidenceApiKey, evidenceConnectorController.createEnrollmentLink);
evidenceConnectorPublicRoutes.post('/subjects/bind', requireCanonicalEvidenceApiKey, evidenceConnectorController.bindSubject);
