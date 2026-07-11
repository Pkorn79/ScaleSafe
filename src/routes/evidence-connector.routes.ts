import { Router } from 'express';
import { evidenceConnectorController } from '../controllers/evidence-connector.controller';
import { ssoAuth } from '../middleware/ssoAuth';
import { requireTenant } from '../middleware/tenantContext';
import { requireCanonicalEvidenceApiKey } from '../middleware/evidenceConnectorAuth';
import { zoomIntegrationController } from '../controllers/zoom-integration.controller';

export const evidenceConnectionManagementRoutes = Router();
evidenceConnectionManagementRoutes.use(ssoAuth, requireTenant);
evidenceConnectionManagementRoutes.get('/catalog', evidenceConnectorController.catalog);
evidenceConnectionManagementRoutes.get('/offer-options', evidenceConnectorController.offerOptions);
evidenceConnectionManagementRoutes.post('/catalog/:providerKey/connect', evidenceConnectorController.connectCatalogProvider);
evidenceConnectionManagementRoutes.get('/', evidenceConnectorController.list);
evidenceConnectionManagementRoutes.post('/:id/status', evidenceConnectorController.merchantStatus);
evidenceConnectionManagementRoutes.get('/:id/events', evidenceConnectorController.events);
evidenceConnectionManagementRoutes.get('/:id/zoom-setup', zoomIntegrationController.setup);
evidenceConnectionManagementRoutes.post('/:id/zoom-mappings', zoomIntegrationController.mappings);

export const evidenceConnectorPublicRoutes = Router();
evidenceConnectorPublicRoutes.post('/events', requireCanonicalEvidenceApiKey, evidenceConnectorController.ingestCanonical);
evidenceConnectorPublicRoutes.post('/attachments', requireCanonicalEvidenceApiKey, evidenceConnectorController.prepareAttachment);
evidenceConnectorPublicRoutes.post('/enrollment-links', requireCanonicalEvidenceApiKey, evidenceConnectorController.createEnrollmentLink);
evidenceConnectorPublicRoutes.post('/subjects/bind', requireCanonicalEvidenceApiKey, evidenceConnectorController.bindSubject);
