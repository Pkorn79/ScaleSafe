import { Router } from 'express';
import { evidenceConnectorController } from '../controllers/evidence-connector.controller';
import { ssoAuth } from '../middleware/ssoAuth';
import { requireTenant } from '../middleware/tenantContext';
import { requireCanonicalEvidenceApiKey } from '../middleware/evidenceConnectorAuth';

export const evidenceConnectionManagementRoutes = Router();
evidenceConnectionManagementRoutes.use(ssoAuth, requireTenant);
evidenceConnectionManagementRoutes.get('/', evidenceConnectorController.list);
evidenceConnectionManagementRoutes.post('/', evidenceConnectorController.create);
evidenceConnectionManagementRoutes.get('/subjects', evidenceConnectorController.subjects);
evidenceConnectionManagementRoutes.put('/:id', evidenceConnectorController.update);
evidenceConnectionManagementRoutes.post('/:id/rotate', evidenceConnectorController.rotate);
evidenceConnectionManagementRoutes.post('/:id/status', evidenceConnectorController.status);
evidenceConnectionManagementRoutes.post('/:id/preview', evidenceConnectorController.preview);
evidenceConnectionManagementRoutes.post('/:id/test', evidenceConnectorController.sendTest);
evidenceConnectionManagementRoutes.get('/:id/events', evidenceConnectorController.events);

export const evidenceConnectorPublicRoutes = Router();
evidenceConnectorPublicRoutes.post('/events', requireCanonicalEvidenceApiKey, evidenceConnectorController.ingestCanonical);
evidenceConnectorPublicRoutes.post('/attachments', requireCanonicalEvidenceApiKey, evidenceConnectorController.prepareAttachment);
