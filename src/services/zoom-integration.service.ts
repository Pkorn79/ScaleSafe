import crypto from 'crypto';
import { config } from '../config';
import { zoomClient } from '../clients/zoom.client';
import { evidenceConnectorRepository } from '../repositories/evidence-connector.repository';
import { merchantRepository } from '../repositories/merchant.repository';
import { zoomIntegrationRepository } from '../repositories/zoom-integration.repository';
import { ConnectorAuthContext, EvidenceConnectionRecord } from '../types/evidence-connector.types';
import { decrypt, encrypt } from '../utils/field-encryption';
import { ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';
import { evidenceConnectionService } from './evidence-connection.service';
import { evidenceConnectorService } from './evidence-connector.service';
import { zoomAdapter } from '../integrations/zoom.adapter';

const OAUTH_STATE_TTL_MS = 15 * 60_000;
const WEBHOOK_TOLERANCE_MS = 5 * 60_000;

function randomPublicId(): string {
  return `evc_${crypto.randomBytes(12).toString('base64url')}`;
}

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizedName(value: unknown): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function popupHtml(success: boolean, error?: string): string {
  const payload = JSON.stringify({ type: 'zoom_connect_result', success, error: error || null }).replace(/</g, '\\u003c');
  const message = success ? 'Zoom connected. You can close this window.' : `Zoom connection failed: ${error || 'unknown'}`;
  const safeMessage = message.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character] as string));
  return `<!doctype html><html><head><meta charset="utf-8"><title>Zoom Connection</title><style>body{font-family:system-ui;color:#334155;text-align:center;padding:60px 24px;background:#f8fafc}p{font-size:14px}</style></head><body><p>${safeMessage}</p><script>(function(){try{if(window.opener&&!window.opener.closed){window.opener.postMessage(${payload},window.location.origin)}}catch(e){}setTimeout(function(){try{window.close()}catch(e){}},800)})()</script></body></html>`;
}

function participantInstance(participant: any): string {
  return String(
    participant?.participant_uuid
    || participant?.user_id
    || participant?.registrant_id
    || participant?.participant_user_id
    || '',
  ).trim();
}

function externalParticipantId(participant: any): string | undefined {
  const registrant = String(participant?.registrant_id || '').trim();
  if (registrant) return `zoom_registrant:${registrant}`;
  const user = String(participant?.participant_user_id || participant?.id || '').trim();
  return user ? `zoom_user:${user}` : undefined;
}

function isHostParticipant(meeting: any, participant: any, connection: EvidenceConnectionRecord): boolean {
  const hostIds = new Set([
    meeting?.host_id,
    (connection.provider_metadata as any)?.zoomUserId,
  ].map((value) => String(value || '').trim()).filter(Boolean));
  const participantIds = [
    participant?.id,
    participant?.user_id,
    participant?.participant_user_id,
  ].map((value) => String(value || '').trim()).filter(Boolean);
  if (participantIds.some((value) => hostIds.has(value))) return true;

  const hostEmails = new Set([
    meeting?.host_email,
    (connection.provider_metadata as any)?.zoomEmail,
  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
  const participantEmail = String(participant?.email || '').trim().toLowerCase();
  return Boolean(participantEmail && hostEmails.has(participantEmail));
}

export const zoomIntegrationService = {
  async begin(locationId: string, actorLabel: string, nameInput?: string) {
    if (!config.zoom.clientId || !config.zoom.clientSecret) {
      throw new ValidationError('Zoom app credentials must be configured before connecting an account');
    }
    const merchant = await merchantRepository.getByLocationId(locationId);
    const existing = (await evidenceConnectorRepository.listConnections(locationId))
      .find((connection) => connection.provider_key === 'zoom' && connection.setup_status !== 'disabled');
    const connection = existing || await evidenceConnectorRepository.createConnection({
      merchant_id: merchant.id,
      location_id: locationId,
      public_id: randomPublicId(),
      name: String(nameInput || 'Zoom').trim().slice(0, 120) || 'Zoom',
      source_label: 'Zoom',
      connection_type: 'provider_adapter',
      mapping_config: {},
      status: 'disabled',
      health_status: 'disabled',
      setup_status: 'draft',
      setup_mode: 'native_adapter',
      identity_strategy: 'email_resource_bootstrap',
      provider_key: 'zoom',
      auth_mode: 'oauth2',
      provider_capabilities: ['evidence', 'attendance'],
      provider_metadata: { chatCollection: false },
      configured_by: actorLabel,
      created_by: actorLabel,
    });

    const state = crypto.randomBytes(32).toString('base64url');
    await zoomIntegrationRepository.createOAuthState({
      state_hash: sha256(state),
      location_id: locationId,
      provider_key: 'zoom',
      connection_id: connection.id,
      requested_by: actorLabel,
      redirect_path: '/settings/evidence-connections',
      expires_at: new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString(),
    });
    await evidenceConnectorRepository.audit(locationId, connection.id, 'zoom.oauth_started', actorLabel, {});
    return { connectionId: connection.id, authorizationUrl: zoomClient.authorizationUrl(state) };
  },

  async callback(code: string, state: string): Promise<string> {
    try {
      if (!code || !state) throw new ValidationError('Zoom callback was missing code or state');
      const claimed = await zoomIntegrationRepository.claimOAuthState(sha256(state));
      if (!claimed?.connection_id) throw new ValidationError('Zoom connection state was incomplete');
      const connection = await evidenceConnectorRepository.getConnection(claimed.location_id, claimed.connection_id);
      if (!connection || connection.provider_key !== 'zoom') throw new ValidationError('Zoom connection was not found');
      const merchant = await merchantRepository.getByLocationId(claimed.location_id);
      const tokens = await zoomClient.exchangeCode(code);
      const profile = await zoomClient.profile(tokens.accessToken);
      await zoomIntegrationRepository.saveAuthorization({
        connection_id: connection.id,
        merchant_id: merchant.id,
        location_id: claimed.location_id,
        provider_key: 'zoom',
        auth_mode: 'oauth2',
        access_token_encrypted: encrypt(tokens.accessToken),
        refresh_token_encrypted: encrypt(tokens.refreshToken),
        expires_at: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
        scopes: tokens.scope,
        external_account_id: profile.accountId,
        external_account_name: profile.accountName,
        status: 'active',
        last_verified_at: new Date().toISOString(),
        last_error: null,
        created_by: claimed.requested_by || 'merchant_user',
      });
      await evidenceConnectorRepository.updateConnection(claimed.location_id, connection.id, {
        external_account_id: profile.accountId,
        external_account_name: profile.accountName,
        provider_metadata: { zoomUserId: profile.userId, zoomEmail: profile.email, chatCollection: false },
        setup_status: 'active',
        status: 'active',
        // OAuth is connected, but webhook delivery and evidence publication have
        // not been proven yet. The worker promotes this to healthy after a real
        // event is resolved and published.
        health_status: 'ready',
        activated_at: new Date().toISOString(),
        last_error_message: null,
      });
      await evidenceConnectorRepository.audit(claimed.location_id, connection.id, 'zoom.oauth_completed', claimed.requested_by || 'merchant_user', {
        externalAccountId: profile.accountId,
      });
      return popupHtml(true);
    } catch (error: any) {
      return popupHtml(false, String(error?.message || error).slice(0, 200));
    }
  },

  async accessToken(connectionId: string): Promise<{ token: string; authorization: any }> {
    const authorization = await zoomIntegrationRepository.getAuthorization(connectionId);
    if (!authorization || authorization.status !== 'active' || !authorization.access_token_encrypted) {
      throw new ValidationError('Zoom account authorization is not active');
    }
    const expiresAt = authorization.expires_at ? new Date(authorization.expires_at).getTime() : 0;
    if (expiresAt > Date.now() + 120_000) {
      return { token: decrypt(authorization.access_token_encrypted), authorization };
    }
    if (!authorization.refresh_token_encrypted) throw new ValidationError('Zoom refresh credential is missing');
    const refreshed = await zoomClient.refresh(decrypt(authorization.refresh_token_encrypted));
    const updates = {
      access_token_encrypted: encrypt(refreshed.accessToken),
      refresh_token_encrypted: encrypt(refreshed.refreshToken),
      expires_at: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
      scopes: refreshed.scope,
      last_verified_at: new Date().toISOString(),
      last_error: null,
    };
    await zoomIntegrationRepository.updateAuthorization(authorization.id, updates);
    return { token: refreshed.accessToken, authorization: { ...authorization, ...updates } };
  },

  async setup(locationId: string, connectionId: string) {
    const connection = await evidenceConnectorRepository.getConnection(locationId, connectionId);
    if (!connection || connection.provider_key !== 'zoom') throw new ValidationError('Zoom connection not found');
    const { token, authorization } = await this.accessToken(connectionId);
    const resources = await zoomAdapter.discoverResources!({ accessToken: token });
    const [mappings, offers] = await Promise.all([
      evidenceConnectorRepository.listResourceMappings(locationId, connectionId),
      zoomIntegrationRepository.listOffers(locationId),
    ]);
    const offersByName = new Map(offers.map((offer) => [normalizedName(offer.offer_name), offer.id]));
    return {
      connection: {
        id: connection.id,
        name: connection.name,
        setupStatus: connection.setup_status,
        externalAccountName: connection.external_account_name,
      },
      authorization: { status: authorization.status, scopes: authorization.scopes || [] },
      resources: resources.map((resource) => ({
        ...resource,
        suggestedOfferId: offersByName.get(normalizedName(resource.name)) || null,
        mapping: mappings.find((mapping: any) => mapping.resource_type === resource.type && mapping.external_resource_id === resource.id) || null,
      })),
      offers,
      webhookUrl: `${config.appUrl.replace(/\/$/, '')}/webhooks/zoom`,
      chatCollection: false,
    };
  },

  async saveMappings(locationId: string, connectionId: string, actorLabel: string, input: any[]) {
    const connection = await evidenceConnectorRepository.getConnection(locationId, connectionId);
    if (!connection || connection.provider_key !== 'zoom') throw new ValidationError('Zoom connection not found');
    const { token } = await this.accessToken(connectionId);
    const resources = await zoomAdapter.discoverResources!({ accessToken: token });
    const allowed = new Map(resources.map((resource) => [`${resource.type}:${resource.id}`, resource]));
    const mappings = input.filter((row) => row?.offerId).map((row) => {
      const resource = allowed.get(`zoom_meeting:${String(row.resourceId || '')}`);
      if (!resource) throw new ValidationError('Choose a meeting returned by the connected Zoom account');
      return {
        offerId: String(row.offerId),
        resourceType: 'zoom_meeting',
        externalResourceId: resource.id,
        externalResourceName: resource.name,
        approvalStatus: 'approved',
        approvedBy: actorLabel,
        providerMetadata: resource.metadata || {},
      };
    });
    if (!mappings.length) throw new ValidationError('Map at least one Zoom meeting to a ScaleSafe offer');
    await evidenceConnectionService.replaceMappings(locationId, connectionId, mappings);
    const updated = await evidenceConnectorRepository.updateConnection(locationId, connectionId, {
      status: 'active',
      setup_status: 'active',
      health_status: 'ready',
      activated_at: new Date().toISOString(),
      configured_by: actorLabel,
      last_error_message: null,
    });
    await evidenceConnectorRepository.audit(locationId, connectionId, 'zoom.mappings_activated', actorLabel, { mappingCount: mappings.length });
    return { connection: updated, mappingCount: mappings.length };
  },

  async disable(locationId: string, connectionId: string, actorLabel: string) {
    const connection = await evidenceConnectorRepository.getConnection(locationId, connectionId);
    if (!connection || connection.provider_key !== 'zoom') throw new ValidationError('Zoom connection not found');
    const authorization = await zoomIntegrationRepository.getAuthorization(connectionId);
    if (authorization) await zoomIntegrationRepository.updateAuthorization(authorization.id, { status: 'revoked' });
    const updated = await evidenceConnectorRepository.updateConnection(locationId, connectionId, {
      status: 'disabled', setup_status: 'disabled', health_status: 'disabled',
    });
    await evidenceConnectorRepository.audit(locationId, connectionId, 'zoom.disconnected', actorLabel, {});
    return updated;
  },

  endpointValidation(plainToken: string) {
    if (!config.zoom.webhookSecretToken) throw new ValidationError('Zoom webhook secret is not configured');
    return {
      plainToken,
      encryptedToken: crypto.createHmac('sha256', config.zoom.webhookSecretToken).update(plainToken).digest('hex'),
    };
  },

  verifyWebhook(rawBody: Buffer, timestamp: string, signature: string): boolean {
    if (!config.zoom.webhookSecretToken || !timestamp || !signature || !rawBody?.length) return false;
    const timestampMs = Number(timestamp) * 1000;
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > WEBHOOK_TOLERANCE_MS) return false;
    const expected = `v0=${crypto.createHmac('sha256', config.zoom.webhookSecretToken).update(`v0:${timestamp}:${rawBody.toString('utf8')}`).digest('hex')}`;
    return safeEqual(signature, expected);
  },

  async handleWebhook(payload: any, rawBody: Buffer) {
    const accountId = String(payload?.payload?.account_id || '').trim();
    const eventName = String(payload?.event || '').trim();
    if (!accountId || !eventName) return { accepted: true, ignored: true };
    const authorization = await zoomIntegrationRepository.getAuthorizationByAccount(accountId);
    const connection = authorization?.connection as EvidenceConnectionRecord | undefined;
    if (!authorization || !connection || connection.status !== 'active' || connection.setup_status !== 'active') {
      return { accepted: true, ignored: true };
    }
    if (!['meeting.participant_joined', 'meeting.participant_left'].includes(eventName)) {
      return { accepted: true, ignored: true };
    }

    const meeting = payload.payload?.object || {};
    const participant = meeting.participant || {};
    const meetingId = String(meeting.id || '').trim();
    const meetingUuid = String(meeting.uuid || meetingId).trim();
    const participantId = participantInstance(participant);
    if (!meetingId || !meetingUuid || !participantId) return { accepted: true, ignored: true };
    const sourceId = `zoom:${eventName}:${sha256(rawBody).slice(0, 40)}`;

    if (isHostParticipant(meeting, participant, connection)) {
      // A host proves that the merchant opened the meeting, not that the client
      // attended. Quarantine an open legacy host session if one exists, and never
      // publish it through the client-evidence pipeline.
      if (eventName === 'meeting.participant_left') {
        const openHostSession = await zoomIntegrationRepository.findOpenAttendance(
          connection.id, meetingUuid, participantId,
        );
        if (openHostSession) {
          await zoomIntegrationRepository.completeAttendance(openHostSession.id, {
            left_at: String(participant.leave_time || new Date(Number(payload.event_ts || Date.now())).toISOString()),
            leave_source_event_id: sourceId,
            status: 'quarantined',
          });
        }
      }
      logger.info({ connectionId: connection.id, meetingUuid }, 'Zoom host participant ignored for client attendance evidence');
      return { accepted: true, ignored: true, reason: 'host_participant' };
    }

    if (eventName === 'meeting.participant_joined') {
      const joinedAt = String(participant.join_time || new Date(Number(payload.event_ts || Date.now())).toISOString());
      await zoomIntegrationRepository.createAttendance({
        connection_id: connection.id,
        location_id: connection.location_id,
        meeting_id: meetingId,
        meeting_uuid: meetingUuid,
        meeting_topic: String(meeting.topic || 'Zoom Meeting'),
        participant_instance_id: participantId,
        participant_user_id: String(participant.participant_user_id || participant.id || '') || null,
        registrant_id: String(participant.registrant_id || '') || null,
        participant_email: String(participant.email || '').trim().toLowerCase() || null,
        participant_name: String(participant.user_name || '').trim() || null,
        joined_at: joinedAt,
        join_source_event_id: sourceId,
        status: 'joined',
      });
      return { accepted: true, recorded: 'join' };
    }

    const leftAt = String(participant.leave_time || new Date(Number(payload.event_ts || Date.now())).toISOString());
    let attendance = await zoomIntegrationRepository.findOpenAttendance(connection.id, meetingUuid, participantId);
    if (!attendance) {
      await zoomIntegrationRepository.createAttendance({
        connection_id: connection.id,
        location_id: connection.location_id,
        meeting_id: meetingId,
        meeting_uuid: meetingUuid,
        meeting_topic: String(meeting.topic || 'Zoom Meeting'),
        participant_instance_id: participantId,
        participant_user_id: String(participant.participant_user_id || participant.id || '') || null,
        registrant_id: String(participant.registrant_id || '') || null,
        participant_email: String(participant.email || '').trim().toLowerCase() || null,
        participant_name: String(participant.user_name || '').trim() || null,
        joined_at: leftAt,
        join_source_event_id: `${sourceId}:missing_join`,
        leave_source_event_id: sourceId,
        left_at: leftAt,
        duration_seconds: null,
        status: 'quarantined',
      });
      logger.warn({
        connectionId: connection.id,
        meetingUuid,
        participantId,
      }, 'Zoom leave event had no matching join; attendance evidence not published');
      return { accepted: true, recorded: 'leave_without_join', evidencePublished: false };
    }
    const joinedAtMs = new Date(attendance.joined_at).getTime();
    const leftAtMs = new Date(leftAt).getTime();
    const durationSeconds = Number.isFinite(joinedAtMs) && Number.isFinite(leftAtMs)
      ? Math.max(0, Math.round((leftAtMs - joinedAtMs) / 1000))
      : 0;
    attendance = await zoomIntegrationRepository.completeAttendance(attendance.id, {
      left_at: leftAt,
      duration_seconds: durationSeconds,
      leave_source_event_id: sourceId,
      participant_email: String(participant.email || attendance.participant_email || '').trim().toLowerCase() || null,
      registrant_id: String(participant.registrant_id || attendance.registrant_id || '') || null,
      status: 'completed',
    });
    const canonical = {
      schema_version: '1.0' as const,
      event_id: sourceId,
      event_type: 'session.attended',
      occurred_at: attendance.joined_at,
      subject: {
        external_contact_id: externalParticipantId(participant),
        email: attendance.participant_email || undefined,
      },
      resource: { type: 'zoom_meeting', id: meetingId, name: attendance.meeting_topic || 'Zoom Meeting' },
      actor: {
        type: 'client' as const,
        external_id: externalParticipantId(participant),
        name: attendance.participant_name || undefined,
        email: attendance.participant_email || undefined,
      },
      activity: {
        status: 'attended',
        description: 'Zoom recorded the client joining and leaving this meeting.',
        duration_seconds: durationSeconds || undefined,
        started_at: attendance.joined_at,
        ended_at: leftAt,
      },
      metadata: {
        meeting_uuid: meetingUuid,
        meeting_id: meetingId,
        meeting_start_time: String(meeting.start_time || attendance.joined_at),
        host_id: String(meeting.host_id || ''),
        verification: 'zoom_signed_webhook',
      },
    };
    const authContext: ConnectorAuthContext = {
      connection,
      credential: {
        id: `zoom_${authorization.id}`,
        connection_id: connection.id,
        credential_type: 'hmac',
        key_prefix: 'zoom',
        secret_hash: '',
        secret_encrypted: null,
        status: 'active',
        expires_at: null,
      },
      authMethod: 'hmac',
      signatureVerified: true,
    };
    const result = await evidenceConnectorService.ingestCanonical(authContext, canonical, rawBody, false);
    await zoomIntegrationRepository.linkEvidenceEvent(attendance.id, result.event.id);
    return { accepted: true, eventId: result.event.id, duplicate: result.duplicate };
  },
};
