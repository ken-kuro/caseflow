// DETERMINISTIC REPLAY BASELINE — not the runtime.
//
// The CaseFlow runtime is the live LLM agent in `server/` (see README). This
// module is a small, deterministic classifier used ONLY by the learning-loop
// regression replay (`lib/evaluation.ts` → `proposePolicyChange`): it needs a
// stable, side-effect-free disposition for each labelled case so a policy diff
// can be replayed reproducibly. It intentionally produces NO audit trace,
// timestamps, or hashes — the fabricated versions from the old prototype were
// removed. Real, verifiable audit events come only from the agent runtime.
import type { CaseInput, DecisionPacket, Disposition, EvidenceItem, Objection, PolicyCitation } from "./contracts.ts";
import { POLICY_VERSION } from "./policy.ts";

function normalizeEvidence(input: CaseInput): EvidenceItem[] {
  return [
    { id: `${input.id}-E1`, label: "Customer profile", value: `${input.customer.kycState} · ${input.customer.residency} · ${input.customer.riskTier} risk`, source: "synthetic_customer", timestamp: input.createdAt, reliability: "HIGH" },
    { id: `${input.id}-E2`, label: "Transfer", value: `${input.transaction.currency} ${input.transaction.amount.toLocaleString("en-US")} · ${input.transaction.corridor} · ${input.transaction.asset}`, source: "synthetic_transaction", timestamp: input.createdAt, reliability: "HIGH" },
    { id: `${input.id}-E3`, label: "Wallet signal", value: `${input.wallet.exposure} exposure · ${input.wallet.linkedEntities} linked entities`, source: "synthetic_wallet_intelligence", timestamp: input.createdAt, reliability: "MEDIUM" },
    { id: `${input.id}-E4`, label: "Travel Rule payload", value: input.travelRule.completeness, source: "synthetic_travel_rule", timestamp: input.createdAt, reliability: input.travelRule.completeness === "COMPLETE" ? "HIGH" : "LOW", contradiction: input.travelRule.contradictions[0] },
  ];
}

function missingEvidence(input: CaseInput): string[] {
  const missing: string[] = [];
  if (!input.travelRule.originator) missing.push("originator identity");
  if (!input.travelRule.beneficiary) missing.push("beneficiary identity");
  if (!input.travelRule.beneficiaryVasp) missing.push("beneficiary VASP");
  return missing;
}

function investigate(input: CaseInput): { risks: string[]; typology: string | null } {
  const risks: string[] = [];
  if (input.wallet.exposure === "HIGH") risks.push("High-risk wallet exposure");
  if (input.wallet.linkedEntities >= 3) risks.push(`${input.wallet.linkedEntities} linked entities`);
  if (input.transaction.transfers24h >= 5) risks.push(`${input.transaction.transfers24h} transfers in 24 hours`);
  if (input.travelRule.contradictions.length) risks.push(...input.travelRule.contradictions);
  if (input.customer.kycState === "REVIEW") risks.push("Customer identity review is open");
  const typology = input.wallet.exposure === "HIGH" && input.transaction.transfers24h >= 5
    ? "Rapid cross-border layering"
    : input.travelRule.contradictions.length
      ? "Identity or corridor mismatch"
      : null;
  return { risks, typology };
}

function validatePacket(packet: DecisionPacket): void {
  const allowed = new Set<Disposition>(["CLEAR", "ESCALATE", "REQUEST_EVIDENCE"]);
  if (!allowed.has(packet.recommendation)) throw new Error("Invalid disposition");
  if (!packet.evidence.length || !packet.citations.length || !packet.nextAction) throw new Error("Incomplete decision contract");
  if (packet.confidence < 0 || packet.confidence > 1) throw new Error("Confidence out of bounds");
  if (packet.recommendation === "REQUEST_EVIDENCE" && !packet.missingEvidence.length) throw new Error("Blocked packet requires named missing evidence");
  if (packet.critiqueRounds > 2) throw new Error("Critique round limit exceeded");
}

// Deterministic classifier. Same disposition contract as the agent, but decided
// by fixed rules so the learning-loop regression replay is reproducible.
export function runWorkflow(input: CaseInput): DecisionPacket {
  const evidence = normalizeEvidence(input);
  const missing = missingEvidence(input);
  const investigation = investigate(input);
  const initialRecommendation: Disposition = investigation.risks.length ? "ESCALATE" : "CLEAR";

  const objections: Objection[] = [];
  let recommendation = initialRecommendation;
  if (missing.length) {
    recommendation = "REQUEST_EVIDENCE";
    objections.push({ id: `${input.id}-O1`, severity: "HIGH", claimChallenged: `The proposed ${initialRecommendation} is defensible with an incomplete Travel Rule payload.`, evidenceNeeded: missing, resolution: "UNRESOLVED" });
  } else {
    objections.push({ id: `${input.id}-O1`, severity: "LOW", claimChallenged: "Required Travel Rule fields may be incomplete.", evidenceNeeded: [], resolution: "RESOLVED" });
  }

  let citations: PolicyCitation[];
  let confidence: number;
  let rationale: string;
  let nextAction: string;
  if (recommendation === "REQUEST_EVIDENCE") {
    citations = [{ clauseId: "TR-1.2", version: POLICY_VERSION, reason: "Minimum Travel Rule identity fields are missing." }];
    confidence = 0.98;
    rationale = `A defensible recommendation is blocked because ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} missing.`;
    nextAction = `Request ${missing.join(" and ")}, preserve case state, then resume the same workflow.`;
  } else if (recommendation === "ESCALATE") {
    citations = [
      { clauseId: investigation.risks.some((risk) => risk.includes("wallet") || risk.includes("transfers") || risk.includes("linked")) ? "KYT-3.1" : "KYC-2.4", version: POLICY_VERSION, reason: "The evidence supports analyst investigation." },
      { clauseId: "TR-1.2", version: POLICY_VERSION, reason: "Minimum Travel Rule evidence is complete." },
    ];
    confidence = Math.min(0.94, 0.72 + investigation.risks.length * 0.04);
    rationale = `Escalation is recommended for analyst review based on ${investigation.risks.join("; ")}.`;
    nextAction = "Analyst reviews the cited evidence and narrative, then records a human disposition.";
  } else {
    citations = [
      { clauseId: "CLR-1.1", version: POLICY_VERSION, reason: "Evidence is complete and no material risk indicator remains." },
      { clauseId: "TR-1.2", version: POLICY_VERSION, reason: "Minimum Travel Rule evidence is complete." },
    ];
    confidence = 0.9;
    rationale = "The alert is consistent with verified customer and counterparty behavior, with complete required evidence and no unresolved material indicator.";
    nextAction = "Analyst verifies the packet and records a human disposition; CaseFlow takes no customer-impacting action.";
  }

  const packet: DecisionPacket = {
    caseId: input.id,
    runId: `${input.id}-BASELINE-${input.travelRule.completeness === "COMPLETE" ? "02" : "01"}`,
    policyVersion: POLICY_VERSION,
    recommendation,
    confidence,
    rationale,
    evidence,
    citations,
    riskIndicators: investigation.risks,
    suspectedTypology: investigation.typology,
    objections,
    missingEvidence: missing,
    nextAction,
    escalationNarrative: recommendation === "ESCALATE"
      ? `Deterministic baseline: analyst escalation recommended for synthetic case ${input.id} based on ${investigation.risks.join(", ").toLowerCase()}.`
      : null,
    trace: [], // No fabricated audit trace — real audit events come only from the agent runtime.
    critiqueRounds: 1,
    generatedAt: input.createdAt,
    humanDisposition: null,
    overrideReason: null,
  };
  validatePacket(packet);
  return packet;
}

export function completeTravelRule(input: CaseInput): CaseInput {
  return {
    ...input,
    status: "READY",
    travelRule: {
      ...input.travelRule,
      beneficiary: "Synthetic Beneficiary C",
      beneficiaryVasp: "Synthetic VASP VN",
      completeness: "COMPLETE",
    },
  };
}
