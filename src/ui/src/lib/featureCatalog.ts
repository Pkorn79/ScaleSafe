export type FeatureStatus = 'planned' | 'researching';

export type FeatureArea =
  | 'clients'
  | 'offers'
  | 'payments'
  | 'evidence'
  | 'defense'
  | 'ai'
  | 'integrations';

export interface FeatureItem {
  id: string;
  title: string;
  area: FeatureArea;
  status: FeatureStatus;
  summary: string;
  userValue: string;
  workflow: string[];
  currentState?: string;
  dependencies?: string[];
}

export const featureStatusLabels: Record<FeatureStatus, string> = {
  planned: 'Planned',
  researching: 'Exploring',
};

export const featureAreaLabels: Record<FeatureArea, string> = {
  clients: 'Clients',
  offers: 'Offers',
  payments: 'Payments',
  evidence: 'Evidence',
  defense: 'Defense',
  ai: 'AI Assistant',
  integrations: 'Integrations',
};

// Merchant-facing roadmap. Working and setup-ready features belong on their
// real product pages and in the user guide, not in a development-status list.
export const featureCatalog: FeatureItem[] = [
  {
    id: 'dashboard-attention-center',
    title: 'Dashboard Attention Center',
    area: 'clients',
    status: 'planned',
    summary: 'A compact work queue for disputes, pulse follow-ups, and upcoming milestones.',
    userValue: 'Keeps action items visible without requiring merchants to search through individual client records.',
    workflow: [
      'Dashboard tabs show open disputes, pulse responses, and milestones that need attention.',
      'Attention dots identify tabs with new or urgent work.',
      'A merchant can dismiss a dashboard item without deleting or resolving its underlying record.',
    ],
  },
  {
    id: 'scheduled-milestones',
    title: 'Scheduled Milestones',
    area: 'offers',
    status: 'planned',
    summary: 'Let offer milestones carry expected delivery windows relative to enrollment.',
    userValue: 'Surfaces upcoming fulfillment work at the right time and makes milestone completion easier to manage.',
    workflow: [
      'Merchant assigns an expected delivery window to each offer milestone.',
      'Upcoming milestones appear in the dashboard attention center before they are due.',
      'Completion uses the existing enrollment-scoped milestone and client sign-off flow.',
    ],
  },
  {
    id: 'financing',
    title: 'Financing and BNPL',
    area: 'payments',
    status: 'researching',
    summary: 'Support certified third-party financing or pay-over-time options.',
    userValue: 'Can help merchants offer financing without manually administering a custom payment plan.',
    workflow: [
      'Merchant enables a certified financing provider.',
      'Client applies or selects financing during checkout.',
      'ScaleSafe records the verified financing and fulfillment relationship without representing itself as the lender.',
    ],
  },
  {
    id: 'fanbasis',
    title: 'FanBasis Checkout Channel',
    area: 'integrations',
    status: 'researching',
    summary: 'Complete and certify the existing FanBasis checkout foundation after provider approval.',
    userValue: 'Would add provider-supported checkout and financing options while preserving ScaleSafe enrollment evidence.',
    workflow: [
      'ScaleSafe certifies checkout behavior against an approved FanBasis account.',
      'Merchant enables FanBasis for selected offers.',
      'Verified payment and membership events remain tied to the correct enrollment.',
    ],
    currentState: 'Foundation exists, but checkout remains unavailable until provider certification is possible.',
    dependencies: ['Approved FanBasis account', 'Provider sandbox or live certification'],
  },
  {
    id: 'enrollment-evidence-readiness',
    title: 'Program Evidence Readiness',
    area: 'evidence',
    status: 'planned',
    summary: 'Score evidence strength per program instead of relying on one contact-level activity score.',
    userValue: 'Shows which individual enrollments have strong documentation and which need attention.',
    workflow: [
      'ScaleSafe groups evidence by enrollment.',
      'Authorization, terms, delivery, communication, satisfaction, and payment records are evaluated separately.',
      'Merchant sees concrete evidence gaps for the selected program.',
    ],
  },
  {
    id: 'pulse-v2-alerts',
    title: 'Pulse Follow-Up Alerts',
    area: 'evidence',
    status: 'planned',
    summary: 'Turn pulse concerns and requests for help into visible merchant follow-up work.',
    userValue: 'Helps merchants respond before a service concern becomes a cancellation or dispute.',
    workflow: [
      'Client submits a structured pulse response.',
      'Low satisfaction, billing concerns, or a follow-up request creates an attention item.',
      'Merchant action and the original response remain linked to the enrollment.',
    ],
  },
  {
    id: 'support-sla-evidence',
    title: 'Support Response Analytics',
    area: 'clients',
    status: 'planned',
    summary: 'Measure response timing and unresolved complaint age from supported communication records.',
    userValue: 'Helps merchants document timely, reasonable support when it is relevant to a dispute.',
    workflow: [
      'Supported messages remain timestamped on the client and enrollment timelines.',
      'ScaleSafe calculates first response, last merchant touch, and unresolved concern age.',
      'Defense packets use the measurements only when the underlying communication is in scope.',
    ],
  },
  {
    id: 'network-alert-integration',
    title: 'Network Alert Integration',
    area: 'defense',
    status: 'researching',
    summary: 'Bring eligible Ethoca, Verifi, and RDR alert outcomes into ScaleSafe when practical provider access exists.',
    userValue: 'Would give merchants one place to understand pre-dispute alert activity and the evidence behind a response decision.',
    workflow: [
      'WholePay or the merchant enables an eligible alert provider.',
      'ScaleSafe receives verified alert and resolution events.',
      'The alert outcome is linked to the correct payment and enrollment without changing processor truth.',
    ],
  },
  {
    id: 'defense-outcome-analytics',
    title: 'Defense Outcome Analytics',
    area: 'defense',
    status: 'planned',
    summary: 'Analyze outcomes by reason code, offer, processor, evidence completeness, and refund timing.',
    userValue: 'Helps merchants learn which practices and evidence patterns produce better outcomes.',
    workflow: [
      'Merchant records or imports the dispute outcome.',
      'ScaleSafe connects the outcome to its scoped payment, enrollment, and evidence profile.',
      'Reports identify patterns without presenting correlation as guaranteed causation.',
    ],
  },
  {
    id: 'ai-assistant',
    title: 'Permissioned AI Assistant',
    area: 'ai',
    status: 'researching',
    summary: 'Add a permissioned assistant for summaries, audits, setup guidance, and carefully approved actions.',
    userValue: 'Would give merchants a plain-language way to understand payments, clients, evidence, and setup gaps.',
    workflow: [
      'Merchant asks a question about records they are permitted to access.',
      'Assistant reads tenant-scoped ScaleSafe data and explains its sources.',
      'Any future action requires explicit permission and an audit record.',
    ],
  },
];

export const publicFeatureCatalog = featureCatalog;

export function getPublicFeatureById(id: string) {
  return publicFeatureCatalog.find((feature) => feature.id === id);
}
