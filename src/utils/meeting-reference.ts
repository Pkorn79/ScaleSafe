export interface MeetingReference {
  provider: 'zoom' | 'google_meet' | 'microsoft_teams' | null;
  id: string | null;
  url: string | null;
}

function firstUrl(value: string): string | null {
  const match = String(value || '').match(/https:\/\/[^\s<>"']+/i);
  return match?.[0]?.replace(/[),.;]+$/g, '') || null;
}

export function extractMeetingReference(...values: unknown[]): MeetingReference {
  const text = values.map((value) => String(value || '')).join(' ');
  const url = firstUrl(text);

  const zoom = text.match(/https:\/\/[a-z0-9.-]*zoom\.us\/(?:j|wc)\/(\d{8,13})/i);
  if (zoom?.[1]) return { provider: 'zoom', id: zoom[1], url: zoom[0] };

  const googleMeet = text.match(/https:\/\/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i);
  if (googleMeet?.[1]) return { provider: 'google_meet', id: googleMeet[1].toLowerCase(), url: googleMeet[0] };

  const teams = text.match(/https:\/\/teams\.microsoft\.com\/l\/meetup-join\/([^\s?]+)/i);
  if (teams?.[1]) return { provider: 'microsoft_teams', id: decodeURIComponent(teams[1]).slice(0, 500), url: teams[0] };

  return { provider: null, id: null, url };
}
