export interface RiskAuditResult {
  id: string;
  merchantId: string;
  createdAt: string;
  auditPeriodStart: string;
  auditPeriodEnd: string;
  totalCharges: number;
  totalDisputes: number;
  totalEfws: number;
  totalDisputeAmountCents: number;
  disputesWon: number;
  disputesLost: number;
  disputesPending: number;
  reasonCodeBreakdown: Record<string, number>;
  avgTransactionCents: number;
  repeatCustomerCount: number;
  uniqueCustomerCount: number;
  scoreDisputeRate: number;
  scoreEvidenceReadiness: number;
  scoreDescriptorQuality: number;
  scoreRepeatClientRate: number;
  scoreRadarDataQuality: number;
  overallRiskLevel: 'low' | 'moderate' | 'elevated' | 'high' | 'critical' | 'unknown';
  moduleRecommendations: ModuleRecommendation[];
}

export interface ModuleRecommendation {
  module: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  reason: string;
  metric: string;
}

export interface StripeEvidenceVaultEntry {
  id: string;
  merchantId: string;
  stripePaymentIntentId: string;
  stripeChargeId: string | null;
  stripeCustomerId: string | null;
  offerId: string | null;
  enrollmentPacketId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerIp: string | null;
  customerBillingAddress: object | null;
  offerTitle: string | null;
  offerDescription: string | null;
  termsAccepted: boolean;
  termsAcceptedAt: string | null;
  contractSigned: boolean;
  contractFileId: string | null;
  termsFileId: string | null;
  sessionFileIds: string[];
  communicationFileId: string | null;
  refundPolicyText: string | null;
  serviceDeliveryModel: string | null;
  serviceStartDate: string | null;
  ce30Eligible: boolean;
  ce30FieldsComplete: boolean;
  metadataWritten: boolean;
  evidenceScore: number;
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceScoreInput {
  hasTermsFile: boolean;
  hasContractFile: boolean;
  hasSessionLogs: boolean;
  hasCommunicationFile: boolean;
  metadataComplete: boolean;
  hasBillingAddress: boolean;
}

// ─── Phase S3: Dispute Triage + Evidence Assembly ────────────────────

export interface DisputeTriageResult {
  score: number;
  recommendation: DisputeRecommendation;
  gaps: string[];
  deadlineAlerts: {
    dueBy: string;
    t7: string | null;
    t3: string | null;
    t1: string | null;
  } | null;
}

export interface DisputeRecommendation {
  action: 'fight' | 'review' | 'accept';
  reason: string;
  estimatedCost: string;
}

export interface EvidencePacket {
  stripeDisputeId: string;
  evidence: Record<string, string>;
  vaultEntry: any | null;
  complete: boolean;
}

export interface EfwRecommendation {
  action: 'hold' | 'refund';
  reason: string;
}

// ─── Phase S4: Account Health, Radar, Descriptors, Prevention ──────

export interface AccountHealthSnapshot {
  id?: string;
  merchant_id: string;
  location_id: string;
  computed_at: string;
  period_days: number;
  total_charges: number;
  total_disputes: number;
  total_efws: number;
  dispute_rate: number;
  efw_rate: number;
  disputes_won: number;
  disputes_lost: number;
  disputes_pending: number;
  recovery_rate: number;
  financial_exposure_cents: number;
  avg_evidence_score: number;
  reason_code_breakdown: Record<string, number>;
  risk_level: string;
  vamp_status: string;
  mc_status: string;
}

export interface EnrollmentChecklist {
  module: string;
  network: string;
  steps: ChecklistStep[];
  overallProgress: number;
}

export interface ChecklistStep {
  id: string;
  title: string;
  complete: boolean;
  instructions: string;
  actionUrl?: string;
}

export interface RadarListRecord {
  id?: string;
  merchant_id: string;
  location_id: string;
  list_alias: string;
  stripe_value_list_id: string;
  item_type: string;
  created_at?: string;
}

export interface DescriptorAnalysis {
  score: number;
  currentPrefix: string;
  recommendation: string;
}

export interface PreventionCoverage {
  visa: { oi: EnrollmentChecklist; rdr: EnrollmentChecklist };
  mastercard: { ethoca: EnrollmentChecklist };
  overallCoverage: number;
}

export interface Ce30Readiness {
  complete: boolean;
  missing: string[];
  eligibleTransactionPercent: number;
}
