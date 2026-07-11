import axios from 'axios';
import { config } from '../config';
import { ValidationError } from '../utils/errors';

export interface ZoomOAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string[];
}

export interface ZoomAccountProfile {
  accountId: string;
  accountName: string;
  userId: string;
  email: string;
}

export interface ZoomMeetingResource {
  id: string;
  topic: string;
  type: number;
  startTime?: string;
  timezone?: string;
  joinUrl?: string;
  hostId?: string;
  hostEmail?: string;
  hostName?: string;
}

function requirePlatformCredentials(): void {
  if (!config.zoom.clientId || !config.zoom.clientSecret) {
    throw new ValidationError('Zoom integration is not configured yet');
  }
}

function tokenAuth() {
  return {
    username: config.zoom.clientId,
    password: config.zoom.clientSecret,
  };
}

function parseTokens(data: any): ZoomOAuthTokens {
  if (!data?.access_token || !data?.refresh_token) {
    throw new ValidationError('Zoom did not return usable OAuth credentials');
  }
  return {
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token),
    expiresIn: Math.max(60, Number(data.expires_in || 3600)),
    scope: String(data.scope || '').split(/\s+/).filter(Boolean),
  };
}

export const zoomClient = {
  authorizationUrl(state: string): string {
    requirePlatformCredentials();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.zoom.clientId,
      redirect_uri: config.zoom.redirectUri,
      state,
    });
    return `https://zoom.us/oauth/authorize?${params.toString()}`;
  },

  async exchangeCode(code: string): Promise<ZoomOAuthTokens> {
    requirePlatformCredentials();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.zoom.redirectUri,
    });
    const response = await axios.post('https://zoom.us/oauth/token', body.toString(), {
      auth: tokenAuth(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });
    return parseTokens(response.data);
  },

  async refresh(refreshToken: string): Promise<ZoomOAuthTokens> {
    requirePlatformCredentials();
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const response = await axios.post('https://zoom.us/oauth/token', body.toString(), {
      auth: tokenAuth(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });
    return parseTokens(response.data);
  },

  async profile(accessToken: string): Promise<ZoomAccountProfile> {
    const response = await axios.get('https://api.zoom.us/v2/users/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15000,
    });
    const row = response.data || {};
    if (!row.account_id || !row.id) throw new ValidationError('Zoom account profile was incomplete');
    return {
      accountId: String(row.account_id),
      accountName: String(row.account_name || row.display_name || row.email || 'Zoom Account'),
      userId: String(row.id),
      email: String(row.email || ''),
    };
  },

  async listMeetings(accessToken: string): Promise<ZoomMeetingResource[]> {
    const users: Array<{ id: string; email: string; name: string }> = [];
    let nextPageToken = '';
    for (let page = 0; page < 10; page += 1) {
      const response = await axios.get('https://api.zoom.us/v2/users', {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { status: 'active', page_size: 100, next_page_token: nextPageToken || undefined },
        timeout: 15000,
      });
      for (const row of response.data?.users || []) {
        if (row?.id) users.push({
          id: String(row.id),
          email: String(row.email || ''),
          name: String(row.display_name || `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.email || 'Zoom Host'),
        });
      }
      nextPageToken = String(response.data?.next_page_token || '');
      if (!nextPageToken) break;
    }

    const meetings: ZoomMeetingResource[] = [];
    for (let offset = 0; offset < users.length; offset += 5) {
      const batch = users.slice(offset, offset + 5);
      const results = await Promise.all(batch.map(async (user) => {
        const rows: ZoomMeetingResource[] = [];
        let meetingPageToken = '';
        for (let page = 0; page < 10; page += 1) {
          const response = await axios.get(`https://api.zoom.us/v2/users/${encodeURIComponent(user.id)}/meetings`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            params: { type: 'scheduled', page_size: 100, next_page_token: meetingPageToken || undefined },
            timeout: 15000,
          });
          for (const row of response.data?.meetings || []) {
            if (!row?.id) continue;
            rows.push({
              id: String(row.id),
              topic: String(row.topic || `Zoom meeting ${row.id}`),
              type: Number(row.type || 2),
              startTime: row.start_time ? String(row.start_time) : undefined,
              timezone: row.timezone ? String(row.timezone) : undefined,
              joinUrl: row.join_url ? String(row.join_url) : undefined,
              hostId: user.id,
              hostEmail: user.email,
              hostName: user.name,
            });
          }
          meetingPageToken = String(response.data?.next_page_token || '');
          if (!meetingPageToken) break;
        }
        return rows;
      }));
      meetings.push(...results.flat());
    }

    const unique = new Map<string, ZoomMeetingResource>();
    for (const meeting of meetings) unique.set(meeting.id, meeting);
    return Array.from(unique.values()).sort((left, right) => left.topic.localeCompare(right.topic));
  },
};
