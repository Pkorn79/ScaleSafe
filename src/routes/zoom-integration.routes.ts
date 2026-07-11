import { Router } from 'express';
import { zoomIntegrationController } from '../controllers/zoom-integration.controller';

const router = Router();
router.get('/callback', zoomIntegrationController.callback);

export default router;
