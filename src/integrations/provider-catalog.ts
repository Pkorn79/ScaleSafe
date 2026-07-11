export type IntegrationCategory =
  | 'native'
  | 'course_community'
  | 'meetings_scheduling'
  | 'agency_delivery'
  | 'communication_support'
  | 'files_deliverables'
  | 'checkout_enrollment'
  | 'reporting_outcomes'
  | 'advanced';

export type IntegrationCapability =
  | 'evidence'
  | 'attendance'
  | 'progress'
  | 'attachments'
  | 'communications'
  | 'native_purchases'
  | 'access_management'
  | 'reporting';

export type IntegrationReleaseStatus =
  | 'native'
  | 'available'
  | 'beta'
  | 'guided'
  | 'planned'
  | 'discovery'
  | 'disabled';

export interface IntegrationProviderDefinition {
  key: string;
  name: string;
  category: IntegrationCategory;
  wave: number;
  authMode: 'native' | 'oauth2' | 'api_key' | 'signed_webhook' | 'guided_webhook' | 'zapier';
  capabilities: IntegrationCapability[];
  summary: string;
}

const p = (
  key: string,
  name: string,
  category: IntegrationCategory,
  wave: number,
  authMode: IntegrationProviderDefinition['authMode'],
  capabilities: IntegrationCapability[],
  summary: string,
): IntegrationProviderDefinition => ({ key, name, category, wave, authMode, capabilities, summary });

export const INTEGRATION_PROVIDERS: IntegrationProviderDefinition[] = [
  p('ghl_native', 'GHL Fulfillment', 'native', 0, 'native', ['evidence', 'attendance', 'progress', 'communications'], 'Native appointment, communication, invoice, course, and client-fulfillment evidence from this GoHighLevel sub-account.'),
  p('custom_api', 'Custom Software API', 'advanced', 0, 'api_key', ['evidence', 'progress', 'attachments'], 'Send authenticated, enrollment-bound evidence from custom software.'),
  p('raw_webhook', 'Guided Webhook', 'advanced', 0, 'guided_webhook', ['evidence', 'progress', 'attachments'], 'ScaleSafe-assisted setup for a supported webhook payload.'),

  p('zoom', 'Zoom', 'meetings_scheduling', 1, 'oauth2', ['evidence', 'attendance'], 'Meeting and webinar attendance, join and leave times, and duration.'),
  p('kajabi', 'Kajabi', 'course_community', 1, 'api_key', ['evidence', 'progress', 'native_purchases', 'access_management'], 'Purchases, course activity, and offer access.'),
  p('teachable', 'Teachable', 'course_community', 1, 'api_key', ['evidence', 'progress', 'native_purchases', 'access_management'], 'Sales, enrollment, lecture progress, completion, refunds, and access.'),
  p('thinkific', 'Thinkific', 'course_community', 1, 'oauth2', ['evidence', 'progress', 'native_purchases', 'access_management'], 'Orders, enrollments, progress, products, and access.'),
  p('clickup', 'ClickUp', 'agency_delivery', 1, 'oauth2', ['evidence', 'attachments', 'communications'], 'Tasks, approvals, comments, status changes, and tracked time.'),

  p('asana', 'Asana', 'agency_delivery', 2, 'oauth2', ['evidence', 'attachments', 'communications'], 'Project tasks, status changes, comments, and deliverables.'),
  p('monday', 'monday.com', 'agency_delivery', 2, 'oauth2', ['evidence', 'attachments', 'communications'], 'Board activity, updates, approvals, and files.'),
  p('teamwork', 'Teamwork.com', 'agency_delivery', 2, 'oauth2', ['evidence', 'attachments', 'communications'], 'Projects, tasks, time, comments, and client delivery.'),
  p('notion', 'Notion', 'agency_delivery', 2, 'oauth2', ['evidence', 'attachments', 'communications'], 'Selected project pages, approvals, updates, and comments.'),
  p('copilot', 'Copilot', 'agency_delivery', 2, 'api_key', ['evidence', 'attachments', 'communications', 'native_purchases'], 'Client portal activity, contracts, files, messages, and billing events.'),
  p('manyrequests', 'ManyRequests', 'agency_delivery', 2, 'api_key', ['evidence', 'attachments', 'communications', 'native_purchases'], 'Requests, comments, attachments, clients, invoices, and subscriptions.'),
  p('suitedash', 'SuiteDash', 'agency_delivery', 2, 'guided_webhook', ['evidence', 'progress', 'attachments', 'communications', 'native_purchases'], 'Projects, subscriptions, LMS, appointments, invoices, and portal activity.'),
  p('basecamp', 'Basecamp', 'agency_delivery', 2, 'oauth2', ['evidence', 'attachments', 'communications'], 'Project activity, messages, tasks, files, and approvals.'),
  p('trello', 'Trello', 'agency_delivery', 2, 'oauth2', ['evidence', 'attachments', 'communications'], 'Cards, lists, comments, checklists, and attachments.'),

  p('circle', 'Circle', 'course_community', 3, 'api_key', ['evidence', 'progress', 'communications', 'access_management'], 'Community membership, spaces, events, and engagement.'),
  p('mighty_networks', 'Mighty Networks', 'course_community', 3, 'api_key', ['evidence', 'progress', 'communications', 'access_management'], 'Members, spaces, events, course participation, and access.'),
  p('learnworlds', 'LearnWorlds', 'course_community', 3, 'oauth2', ['evidence', 'progress', 'native_purchases', 'access_management'], 'Users, courses, progress, certifications, payments, and access.'),
  p('google_meet', 'Google Meet', 'meetings_scheduling', 3, 'oauth2', ['evidence', 'attendance', 'attachments'], 'Conference attendance, participant sessions, recordings, and transcripts.'),
  p('calendly', 'Calendly', 'meetings_scheduling', 3, 'oauth2', ['evidence'], 'Scheduled and cancelled appointment evidence.'),
  p('learndash', 'LearnDash', 'course_community', 3, 'guided_webhook', ['evidence', 'progress', 'access_management'], 'WordPress course enrollment, progress, completion, and access.'),
  p('memberpress', 'MemberPress', 'course_community', 3, 'guided_webhook', ['evidence', 'native_purchases', 'access_management'], 'WordPress membership purchases, status, and access.'),
  p('skool', 'Skool', 'course_community', 3, 'zapier', ['evidence', 'progress', 'access_management'], 'Official Zapier-assisted membership and course activity.'),
  p('podia', 'Podia', 'course_community', 3, 'zapier', ['evidence', 'native_purchases'], 'Zapier-assisted sales and customer activity.'),

  p('slack', 'Slack', 'communication_support', 4, 'oauth2', ['evidence', 'attachments', 'communications'], 'Only explicitly selected client channels; never workspace-wide capture.'),
  p('microsoft_teams', 'Microsoft Teams', 'communication_support', 4, 'oauth2', ['evidence', 'attendance', 'attachments', 'communications'], 'Selected meetings, channels, messages, and files.'),
  p('google_drive', 'Google Drive', 'files_deliverables', 4, 'oauth2', ['evidence', 'attachments', 'communications'], 'Selected deliverables, file activity, and comments.'),
  p('dropbox', 'Dropbox', 'files_deliverables', 4, 'oauth2', ['evidence', 'attachments'], 'Selected delivered files and activity.'),
  p('box', 'Box', 'files_deliverables', 4, 'oauth2', ['evidence', 'attachments'], 'Selected files, downloads, comments, and approvals.'),
  p('zendesk', 'Zendesk', 'communication_support', 4, 'oauth2', ['evidence', 'attachments', 'communications'], 'Support tickets, replies, resolution, and response timing.'),
  p('intercom', 'Intercom', 'communication_support', 4, 'oauth2', ['evidence', 'attachments', 'communications'], 'Support conversations and response history.'),
  p('help_scout', 'Help Scout', 'communication_support', 4, 'oauth2', ['evidence', 'attachments', 'communications'], 'Mailbox conversations, replies, and resolution.'),
  p('loom', 'Loom', 'files_deliverables', 4, 'oauth2', ['evidence', 'attachments'], 'Delivered videos and viewing activity where available.'),
  p('vimeo', 'Vimeo', 'files_deliverables', 4, 'oauth2', ['evidence', 'progress', 'attachments'], 'Video delivery and viewing activity.'),
  p('wistia', 'Wistia', 'files_deliverables', 4, 'api_key', ['evidence', 'progress', 'attachments'], 'Video delivery and engagement.'),
  p('docusign', 'DocuSign', 'files_deliverables', 4, 'oauth2', ['evidence', 'attachments'], 'Envelope delivery, viewing, and signatures.'),
  p('pandadoc', 'PandaDoc', 'files_deliverables', 4, 'oauth2', ['evidence', 'attachments'], 'Document delivery, viewing, approvals, and signatures.'),

  ...['thrivecart:ThriveCart', 'samcart:SamCart', 'clickfunnels:ClickFunnels', 'kartra:Kartra', 'systeme:Systeme.io', 'woocommerce_memberships:WooCommerce Memberships', 'stripe_hosted:Stripe-hosted Memberships']
    .map((entry) => {
      const [key, name] = entry.split(':');
      return p(key, name, 'checkout_enrollment', 5, key === 'stripe_hosted' ? 'oauth2' : 'guided_webhook', ['evidence', 'native_purchases'], 'Verified purchase and enrollment import without changing ScaleSafe processor truth.');
    }),

  ...['agencyanalytics:AgencyAnalytics', 'google_analytics:Google Analytics 4', 'google_search_console:Google Search Console', 'meta_ads:Meta Ads', 'google_ads:Google Ads', 'callrail:CallRail', 'whatconverts:WhatConverts', 'hubspot:HubSpot', 'activecampaign:ActiveCampaign', 'keap:Keap']
    .map((entry) => {
      const [key, name] = entry.split(':');
      return p(key, name, 'reporting_outcomes', 6, ['agencyanalytics', 'activecampaign', 'callrail', 'whatconverts'].includes(key) ? 'api_key' : 'oauth2', ['evidence', 'reporting'], 'Client-facing outcome and campaign delivery evidence, summarized without raw analytics noise.');
    }),

  ...['spp:SPP.co', 'dubsado:Dubsado', 'honeybook:HoneyBook', 'productive:Productive', 'accelo:Accelo', 'client_hub:Client Hub', 'vendasta:Vendasta', 'goproposal:GoProposal', 'practice:Practice', 'coachaccountable:CoachAccountable']
    .map((entry) => {
      const [key, name] = entry.split(':');
      return p(key, name, 'advanced', 7, 'guided_webhook', ['evidence'], 'Discovery candidate pending official API, webhook, and partner-access verification.');
    }),
];

export const INTEGRATION_PROVIDER_MAP = new Map(INTEGRATION_PROVIDERS.map((provider) => [provider.key, provider]));
