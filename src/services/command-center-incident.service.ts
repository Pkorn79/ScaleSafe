import crypto from 'crypto';
import { Request } from 'express';
import { commandCenterHealthRepository } from '../repositories/command-center-health.repository';
import { operatorAuthorizationService } from './operator-authorization.service';

function uuid(value: unknown): string {
  const normalized = String(value || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw Object.assign(new Error('Incident identifier is invalid'), { statusCode: 400 });
  }
  return normalized;
}

function text(value: unknown, maximum: number, fallback = ''): string {
  const normalized = String(value || '').trim();
  return (normalized || fallback).slice(0, maximum);
}

async function audit(req: Request, input: {
  action: string;
  result: 'intent' | 'succeeded' | 'failed';
  targetId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const actor = req.operatorContext!;
  await operatorAuthorizationService.auditRequest(req, {
    correlationId: crypto.randomUUID(),
    actorOperatorUserId: actor.operatorUserId,
    actorOrganizationId: actor.organizationId,
    actorRole: actor.role,
    actorSessionId: actor.sessionId,
    action: input.action,
    result: input.result,
    targetType: 'platform_incident',
    targetId: input.targetId,
    metadata: input.metadata,
  });
}

export const commandCenterIncidentService = {
  async acknowledge(req: Request, incidentIdValue: unknown, summaryValue: unknown): Promise<any> {
    const incidentId = uuid(incidentIdValue);
    const summary = text(summaryValue, 1000, 'Incident acknowledged.');
    await audit(req, { action: 'platform.incident.acknowledge', result: 'intent', targetId: incidentId });
    try {
      const result = await commandCenterHealthRepository.acknowledgeIncident({
        incidentId,
        operatorUserId: req.operatorContext!.operatorUserId,
        summary,
      });
      await audit(req, { action: 'platform.incident.acknowledge', result: 'succeeded', targetId: incidentId });
      return result;
    } catch (error) {
      await audit(req, { action: 'platform.incident.acknowledge', result: 'failed', targetId: incidentId });
      throw error;
    }
  },

  async suppress(req: Request, incidentIdValue: unknown, body: any): Promise<any> {
    const incidentId = uuid(incidentIdValue);
    const reason = text(body?.reason, 500);
    const until = new Date(String(body?.until || ''));
    if (!reason || !Number.isFinite(until.getTime())) {
      throw Object.assign(new Error('Suppression reason and expiration are required'), { statusCode: 400 });
    }
    await audit(req, {
      action: 'platform.incident.suppress',
      result: 'intent',
      targetId: incidentId,
      metadata: { until: until.toISOString() },
    });
    try {
      const result = await commandCenterHealthRepository.suppressIncident({
        incidentId,
        operatorUserId: req.operatorContext!.operatorUserId,
        reason,
        until: until.toISOString(),
      });
      await audit(req, {
        action: 'platform.incident.suppress',
        result: 'succeeded',
        targetId: incidentId,
        metadata: { until: until.toISOString() },
      });
      return result;
    } catch (error) {
      await audit(req, { action: 'platform.incident.suppress', result: 'failed', targetId: incidentId });
      throw error;
    }
  },
};

