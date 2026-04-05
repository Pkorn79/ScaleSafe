import { Router } from 'express';
import { handleQueryUrl } from '../controllers/query-url.controller';

const router = Router();

// queryUrl endpoint — ALL GHL payment operations come here
router.post('/query', handleQueryUrl);

export default router;
