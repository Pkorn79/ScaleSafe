import { zoomClient } from '../clients/zoom.client';
import { ProviderAdapter, providerAdapterRegistry } from './provider-adapter';

export const zoomAdapter: ProviderAdapter = {
  key: 'zoom',
  capabilities: ['evidence', 'attendance'],
  buildAuthorizationUrl: (state) => zoomClient.authorizationUrl(state),
  exchangeAuthorizationCode: async (code) => ({ ...await zoomClient.exchangeCode(code) }),
  discoverResources: async (authorization) => {
    const meetings = await zoomClient.listMeetings(String(authorization.accessToken || ''));
    return meetings.map((meeting) => ({
      type: 'zoom_meeting',
      id: meeting.id,
      name: meeting.topic,
      metadata: {
        meetingType: meeting.type,
        startTime: meeting.startTime || null,
        timezone: meeting.timezone || null,
      },
    }));
  },
};

providerAdapterRegistry.register(zoomAdapter);
