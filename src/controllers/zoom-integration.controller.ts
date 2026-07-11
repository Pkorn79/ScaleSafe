import { NextFunction, Request, Response } from 'express';
import { zoomIntegrationService } from '../services/zoom-integration.service';
import { ValidationError } from '../utils/errors';

function tenant(req: Request): string {
  const locationId = req.tenantContext?.locationId;
  if (!locationId) throw new ValidationError('Tenant context required');
  return locationId;
}

function actor(req: Request): string {
  return req.tenantContext?.email || req.tenantContext?.userId || 'merchant_user';
}

export const zoomIntegrationController = {
  async callback(req: Request, res: Response, next: NextFunction) {
    try {
      if (req.query.error) {
        res.type('html').send(await zoomIntegrationService.callback('', ''));
        return;
      }
      res.type('html').send(await zoomIntegrationService.callback(String(req.query.code || ''), String(req.query.state || '')));
    } catch (error) { next(error); }
  },

  async setup(req: Request, res: Response, next: NextFunction) {
    try { res.json(await zoomIntegrationService.setup(tenant(req), req.params.id)); } catch (error) { next(error); }
  },

  async mappings(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await zoomIntegrationService.saveMappings(
        tenant(req), req.params.id, actor(req), Array.isArray(req.body?.mappings) ? req.body.mappings : [],
      ));
    } catch (error) { next(error); }
  },

  async webhook(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = req.body || {};
      if (payload.event === 'endpoint.url_validation') {
        const plainToken = String(payload.payload?.plainToken || '');
        if (!plainToken) throw new ValidationError('Zoom endpoint validation token is missing');
        res.json(zoomIntegrationService.endpointValidation(plainToken));
        return;
      }
      const rawBody = req.rawBody || Buffer.from(JSON.stringify(payload));
      const timestamp = String(req.header('x-zm-request-timestamp') || '');
      const signature = String(req.header('x-zm-signature') || '');
      if (!zoomIntegrationService.verifyWebhook(rawBody, timestamp, signature)) {
        res.status(401).json({ error: 'INVALID_ZOOM_SIGNATURE', message: 'Zoom webhook signature verification failed' });
        return;
      }
      res.json(await zoomIntegrationService.handleWebhook(payload, rawBody));
    } catch (error) { next(error); }
  },
};
