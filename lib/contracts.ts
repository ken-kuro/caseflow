export const DISPOSITIONS = ["CLEAR", "ESCALATE", "REQUEST_EVIDENCE"] as const;

export type Disposition = (typeof DISPOSITIONS)[number];
export type Reliability = "HIGH" | "MEDIUM" | "LOW";

export interface TravelRuleContext {
  originator: string | null;
  beneficiary: string | null;
  beneficiaryVasp: string | null;
  completeness: "COMPLETE" | "INCOMPLETE";
  contradictions: string[];
}

export interface CaseInput {
  id: string;
  title: string;
  alertType: "TRAVEL_RULE" | "WALLET_RISK" | "RAPID_MOVEMENT" | "REMITTANCE";
  createdAt: string;
  status: "NEW" | "PAUSED" | "READY";
  vendorScore: number;
  customer: {
    syntheticName: string;
    kycState: "VERIFIED" | "REVIEW";
    residency: string;
    riskTier: "LOW" | "MEDIUM" | "HIGH";
    priorAlerts: number;
  };
  transaction: {
    amount: number;
    currency: "PHP" | "USD";
    corridor: string;
    asset: string;
    transfers24h: number;
    counterparties: number;
  };
  wallet: {
    exposure: "LOW" | "MEDIUM" | "HIGH";
    hops: number;
    labels: string[];
    linkedEntities: number;
  };
  travelRule: TravelRuleContext;
}

export interface PolicyClause {
  id: string;
  version: string;
  title: string;
  text: string;
  jurisdiction: string;
  type: "EVIDENCE" | "ESCALATION" | "CLEARANCE" | "GOVERNANCE";
}

export interface EvidenceItem {
  id: string;
  label: string;
  value: string;
  source: string;
  timestamp: string;
  reliability: Reliability;
  contradiction?: string;
}

export interface PolicyCitation {
  clauseId: string;
  version: string;
  reason: string;
}

export interface Objection {
  id: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  claimChallenged: string;
  evidenceNeeded: string[];
  resolution: "RESOLVED" | "UNRESOLVED";
}

export interface AuditEvent {
  id: string;
  actor: "Case Intake" | "Triage" | "Investigation" | "Compliance Challenger" | "Orchestrator" | "Analyst";
  action: string;
  tool: string;
  inputHash: string;
  outputHash: string;
  timestamp: string;
  status: "COMPLETE" | "BLOCKED" | "SKIPPED";
}

export interface DecisionPacket {
  caseId: string;
  runId: string;
  policyVersion: string;
  recommendation: Disposition;
  confidence: number;
  rationale: string;
  evidence: EvidenceItem[];
  citations: PolicyCitation[];
  riskIndicators: string[];
  suspectedTypology: string | null;
  objections: Objection[];
  missingEvidence: string[];
  nextAction: string;
  escalationNarrative: string | null;
  trace: AuditEvent[];
  critiqueRounds: number;
  generatedAt: string;
  humanDisposition: null | "ACCEPTED" | "OVERRIDDEN" | "EVIDENCE_REQUESTED";
  overrideReason: string | null;
}

export interface ReviewFeedback {
  caseId: string;
  action: "ACCEPT" | "OVERRIDE" | "REQUEST_EVIDENCE";
  reason: string;
  correctedLabel: Disposition | null;
  timestamp: string;
}

export interface EvaluationLabel {
  caseId: string;
  expectedDisposition: Disposition;
  requiredClauses: string[];
  requiredMissingEvidence: string[];
}

export interface EvaluationMetrics {
  generatedAt: string;
  caseCount: number;
  dispositionAgreement: number;
  policyCitationRecall: number;
  unsupportedClaimCount: number;
  requestEvidenceRecall: number;
  medianWorkflowMs: number;
}

export interface PolicyProposal {
  id: string;
  fromVersion: string;
  proposedVersion: string;
  sourceCases: string[];
  title: string;
  rationale: string;
  diff: { before: string; after: string };
  replay: {
    cases: number;
    changedOutcomes: number;
    regressions: number;
    dispositionAgreementDelta: number;
  };
  approvalState: "AWAITING_APPROVAL" | "APPROVED" | "REJECTED";
}
