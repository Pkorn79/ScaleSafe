export type FeatureStatus = 'live' | 'beta' | 'needs_setup' | 'coming_soon' | 'internal';

export type FeatureArea =
  | 'clients'
  | 'offers'
  | 'payments'
  | 'evidence'
  | 'defense'
  | 'ai'
  | 'integrations'
  | 'settings';

export interface FeatureItem {
  id: string;
  title: string;
  area: FeatureArea;
  status: FeatureStatus;
  summary: string;
  userValue: string;
  workflow: string[];
  currentState?: string;
  proofNeeded?: string;
  dependencies?: string[];
  channels?: string[];
  internalOnly?: boolean;
}

export const featureStatusLabels: Record<FeatureStatus, string> = {
  live: 'Live',
  beta: 'Beta',
  needs_setup: 'Needs Setup',
  coming_soon: 'Coming Soon',
  internal: 'Internal',
};

export const featureAreaLabels: Record<FeatureArea, string> = {
  clients: 'Clients',
  offers: 'Offers',
  payments: 'Payments',
  evidence: 'Evidence',
  defense: 'Defense',
  ai: 'AI Assistant',
  integrations: 'Integrations',
  settings: 'Settings',
};

export const featureCatalog: FeatureItem[] = [
  {
    id: 'ghl-communications',
    title: 'GHL Communications Evidence',
    area: 'clients',
    status: 'beta',
    summary: 'Captures inbound and outbound GHL messages as client-level evidence.',
    userValue: 'Shows the client conversation trail without asking the merchant to copy messages into ScaleSafe.',
    workflow: [
      'GHL sends inbound or outbound message webhook.',
      'ScaleSafe stores readable communication evidence on the client.',
      'Merchant can link important messages to a program when needed.',
    ],
    currentState: 'Built for GHL message webhooks and visible in client evidence.',
    proofNeeded: 'Validate channel labels for email, SMS, chat, WhatsApp/social inbox sources, and client replies.',
    channels: ['Email', 'SMS', 'Chat', 'Call', 'Social inbox when GHL sends the source'],
  },
  {
    id: 'activity-ledger',
    title: 'Client Activity Ledger',
    area: 'clients',
    status: 'beta',
    summary: 'Combines client-level appointments, invoices, notes, tasks, opportunities, messages, payments, and evidence.',
    userValue: 'Gives merchants one simple timeline of what happened with a client.',
    workflow: [
      'GHL activity arrives through official marketplace webhooks.',
      'ScaleSafe attaches activity to the client first.',
      'Program-specific linking happens only when the merchant or payload provides a strong connection.',
    ],
    currentState: 'Backend capture exists for supported GHL activity. UI should continue to mature around the timeline.',
    proofNeeded: 'Live-test each GHL event type and confirm noisy unsupported events are skipped.',
  },
  {
    id: 'ghl-invoices',
    title: 'GHL Invoice Evidence',
    area: 'clients',
    status: 'beta',
    summary: 'Tracks invoice created, sent, paid, partially paid, updated, voided, and deleted events.',
    userValue: 'Adds billing proof to the client record even when the invoice was created inside GHL.',
    workflow: [
      'GHL invoice webhook is received.',
      'ScaleSafe records invoice state and line item context as client-level evidence.',
      'Defense packets can include invoice proof inside the dispute window.',
    ],
    currentState: 'Invoice evidence capture exists.',
    proofNeeded: 'Confirm line item display and paid/voided lifecycle in live testing.',
  },
  {
    id: 'ghl-appointments',
    title: 'GHL Appointment Evidence',
    area: 'clients',
    status: 'beta',
    summary: 'Records booked, updated, cancelled, completed, and no-show appointment activity when GHL sends status.',
    userValue: 'Shows service delivery attempts and session activity without forcing scheduling inside ScaleSafe.',
    workflow: [
      'Appointment changes happen in GHL calendars.',
      'ScaleSafe records the event to the client timeline.',
      'Show/no-show status is used when present in the GHL payload or workflow source.',
    ],
    currentState: 'Appointment evidence capture exists.',
    proofNeeded: 'Verify status naming from real GHL appointment events and Zoom/Meet-adjacent workflows.',
  },
  {
    id: 'ghl-courses',
    title: 'GHL Course Activity',
    area: 'clients',
    status: 'needs_setup',
    summary: 'Records course access, login, lesson progress, module completion, and product completion through a ScaleSafe course webhook.',
    userValue: 'Helps prove access and consumption for course, membership, and coaching programs.',
    workflow: [
      'Merchant adds GHL course workflow triggers.',
      'GHL posts course activity to ScaleSafe.',
      'ScaleSafe records service access, module progress, and completion evidence.',
    ],
    currentState: 'Course activity webhook bridge exists.',
    proofNeeded: 'Create the GHL workflow trigger set and run a live course login/lesson completion test.',
    dependencies: ['GHL course workflows', 'Merchant webhook secret'],
  },
  {
    id: 'quick-manual-sale',
    title: 'Quick Manual Sale',
    area: 'clients',
    status: 'beta',
    summary: 'Lets a merchant charge a client on the phone or Zoom, then send the paid enrollment link.',
    userValue: 'Reduces sales friction for high-ticket phone sales while still collecting enrollment consent evidence.',
    workflow: [
      'Merchant selects or creates a client.',
      'Merchant selects an offer and charges the card through Stripe or NMI tokenization.',
      'ScaleSafe sends a paid enrollment link so the client signs terms without paying again.',
    ],
    currentState: 'Initial flow exists and should be polished through beta testing.',
    proofNeeded: 'Run PIF, installment, failed-charge, and paid-enrollment completion tests.',
  },
  {
    id: 'nmi-multi-mid',
    title: 'NMI Multi-MID Routing',
    area: 'payments',
    status: 'beta',
    summary: 'Supports multiple NMI merchant accounts and offer-level routing.',
    userValue: 'Lets merchants route different offers or brands through the right NMI account.',
    workflow: [
      'Merchant adds one or more NMI processor configs.',
      'Offer chooses the intended NMI merchant account.',
      'Checkout, recurring billing, refunds, and webhooks preserve that processor assignment.',
    ],
    currentState: 'Processor config foundation and offer-level NMI processor selection exist.',
    proofNeeded: 'Run a two-MID test: checkout, recurring webhook, refund, and ledger attribution.',
  },
  {
    id: 'ach',
    title: 'ACH Payments',
    area: 'payments',
    status: 'coming_soon',
    summary: 'Add bank debit payment support for merchants who want card alternatives.',
    userValue: 'Reduces card fees and gives high-ticket clients another way to pay.',
    workflow: [
      'Merchant enables ACH-capable processor setup.',
      'Client authorizes bank payment through the processor-approved flow.',
      'ScaleSafe records payment, authorization, and refund evidence.',
    ],
  },
  {
    id: 'financing',
    title: 'Financing / BNPL',
    area: 'payments',
    status: 'coming_soon',
    summary: 'Support approved third-party financing or pay-over-time options.',
    userValue: 'Helps merchants close high-ticket buyers without manually managing custom payment plans.',
    workflow: [
      'Merchant enables a financing provider.',
      'Client applies or selects financing during checkout.',
      'ScaleSafe stores financing/payment status as evidence.',
    ],
  },
  {
    id: 'whop',
    title: 'Whop Checkout Channel',
    area: 'integrations',
    status: 'beta',
    summary: 'Use Whop checkout for selected ScaleSafe offers while keeping ScaleSafe enrollment evidence in front.',
    userValue: 'Lets merchants use Whop checkout without losing ScaleSafe consent, evidence, and defense records.',
    workflow: [
      'Merchant connects Whop in Payment Settings.',
      'Merchant selects Whop as the offer checkout channel.',
      'ScaleSafe captures enrollment evidence, embeds Whop checkout, and records Whop payment/membership webhooks.',
    ],
  },
  {
    id: 'fanbasis',
    title: 'FanBasis Checkout Channel',
    area: 'integrations',
    status: 'coming_soon',
    summary: 'Use FanBasis (Merchant of Record) checkout — cards, Apple/Google Pay, Cash App, and BNPL where enabled — on selected ScaleSafe offers.',
    userValue: 'Lets merchants offer financing and alternative payment methods through FanBasis without losing ScaleSafe consent, evidence, and defense records.',
    workflow: [
      'Merchant connects FanBasis in Payment Settings.',
      'Merchant selects FanBasis as the offer checkout channel.',
      'ScaleSafe captures enrollment evidence, renders FanBasis checkout, and records FanBasis payment webhooks.',
    ],
  },
  {
    id: 'digistore24',
    title: 'Digistore24 Integration',
    area: 'integrations',
    status: 'coming_soon',
    summary: 'Explore Digistore24 purchase, refund, affiliate, and delivery evidence.',
    userValue: 'Adds support for merchants selling through Digistore24.',
    workflow: [
      'Merchant connects Digistore24.',
      'ScaleSafe records purchases, refunds, and product access signals.',
      'Defense packets use those records when relevant.',
    ],
  },
  {
    id: 'checkout-upsells',
    title: 'Order Bumps and Upsells',
    area: 'offers',
    status: 'coming_soon',
    summary: 'Add optional add-ons and upsell paths around the ScaleSafe checkout.',
    userValue: 'Lets merchants increase order value while preserving clean payment and evidence records.',
    workflow: [
      'Merchant configures add-ons on the offer.',
      'Client chooses accepted add-ons during checkout.',
      'ScaleSafe records exactly what was purchased and agreed to.',
    ],
  },
  {
    id: 'source-closer-tracking',
    title: 'Source and Closer Tracking',
    area: 'offers',
    status: 'coming_soon',
    summary: 'Track source, setter, closer, campaign, and partner attribution through enrollment and payment records.',
    userValue: 'Helps merchants see which sales channels produce reliable clients and risky disputes.',
    workflow: [
      'Merchant tags links or chooses attribution during manual sale.',
      'ScaleSafe carries that attribution into payment, client, and defense records.',
      'Reports surface conversion and risk by source.',
    ],
  },
  {
    id: 'evidence-linking',
    title: 'Manual Evidence Linking',
    area: 'evidence',
    status: 'beta',
    summary: 'Let merchants connect important client-level evidence to the right program.',
    userValue: 'Avoids guessing while still giving merchants control over what supports a specific enrollment.',
    workflow: [
      'ScaleSafe captures client-level evidence automatically.',
      'Merchant clicks Link to Program on important records.',
      'Defense packets treat linked records as program-specific proof.',
    ],
    currentState: 'Visible action exists and needs completion/verification.',
    proofNeeded: 'Click-test link-to-program from client evidence and confirm defense packet inclusion.',
  },
  {
    id: 'stripe-defense-layer',
    title: 'Stripe Defense Layer',
    area: 'defense',
    status: 'coming_soon',
    summary: 'Prepare Stripe-ready dispute evidence bundles and submission helpers.',
    userValue: 'Turns ScaleSafe records into cleaner Stripe dispute responses.',
    workflow: [
      'Dispute arrives through Stripe.',
      'ScaleSafe selects the strongest evidence by reason.',
      'Merchant reviews and submits through the guided defense flow.',
    ],
  },
  {
    id: 'verifi-ethoca',
    title: 'Verifi / Ethoca Alerts',
    area: 'defense',
    status: 'coming_soon',
    summary: 'Explore alert integrations that may help merchants respond before disputes become chargebacks.',
    userValue: 'Can reduce chargebacks by catching cardholder disputes earlier.',
    workflow: [
      'Merchant connects alert provider.',
      'ScaleSafe records alert and response actions.',
      'Refund, outreach, or defense activity is tracked.',
    ],
  },
  {
    id: 'ai-assistant',
    title: 'AI Assistant and Control Layer',
    area: 'ai',
    status: 'coming_soon',
    summary: 'Add a permissioned assistant for summaries, audits, setup guidance, and eventually safe actions.',
    userValue: 'Gives merchants a plain-English way to understand clients, evidence, payments, and setup gaps.',
    workflow: [
      'Merchant asks a question or gives a command.',
      'Assistant reads permitted ScaleSafe records.',
      'Actions require clear permissions and audit logs before anything changes.',
    ],
  },
  {
    id: 'cloudflare-security',
    title: 'Cloudflare Security Layer',
    area: 'settings',
    status: 'internal',
    summary: 'Internal security hardening layer under evaluation.',
    userValue: 'Hidden from merchant-facing roadmap.',
    workflow: ['Evaluate value.', 'Avoid blocking checkout, GHL, processor, milestone, and webhook routes.', 'Roll out only after verification.'],
    internalOnly: true,
  },
];

export const publicFeatureCatalog = featureCatalog.filter((feature) => !feature.internalOnly && feature.status !== 'internal');

export function getFeatureById(id: string) {
  return featureCatalog.find((feature) => feature.id === id);
}

export function getPublicFeatureById(id: string) {
  return publicFeatureCatalog.find((feature) => feature.id === id);
}

export function getFeaturesByArea(area: FeatureArea) {
  return publicFeatureCatalog.filter((feature) => feature.area === area);
}
