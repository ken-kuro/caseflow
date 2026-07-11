import type { CaseInput, DecisionPacket, Disposition } from "../lib/contracts.ts";
import { POLICY } from "../lib/policy.ts";

const ALLOWED = new Set<Disposition>(["CLEAR", "ESCALATE", "REQUEST_EVIDENCE"]);
const CLAUSE_IDS = new Set(POLICY.map((c) => c.id));

// Deterministic governance around non-deterministic reasoning. Returns the list
// of violations (empty = valid). Never throws, never fabricates a packet.
export function validatePacket(packet: DecisionPacket, caseInput: CaseInput): string[] {
  const errors: string[] = [];

  if (!ALLOWED.has(packet.recommendation)) errors.push(`Invalid disposition "${packet.recommendation}" (must be CLEAR | ESCALATE | REQUEST_EVIDENCE).`);
  if (!packet.evidence.length) errors.push("Decision packet has no evidence.");
  if (!packet.citations.length) errors.push("Decision packet cites no policy clauses.");
  if (!packet.nextAction || !packet.nextAction.trim()) errors.push("Decision packet has no next action.");
  if (typeof packet.confidence !== "number" || packet.confidence < 0 || packet.confidence > 1) errors.push("Confidence must be a number in [0, 1].");
  if (packet.critiqueRounds > 2) errors.push("Critique round limit (2) exceeded.");

  for (const c of packet.citations) {
    if (!CLAUSE_IDS.has(c.clauseId)) errors.push(`Cited clause "${c.clauseId}" does not exist in the policy corpus.`);
  }

  if (packet.recommendation === "REQUEST_EVIDENCE" && !packet.missingEvidence.length) {
    errors.push("A REQUEST_EVIDENCE packet must name the missing evidence.");
  }

  // Deterministic hard-stop: an incomplete Travel Rule payload can never be
  // sealed as CLEAR or ESCALATE — the only defensible disposition is
  // REQUEST_EVIDENCE. This guarantee holds regardless of model output.
  if (caseInput.travelRule.completeness === "INCOMPLETE" && packet.recommendation !== "REQUEST_EVIDENCE") {
    errors.push(`Travel Rule payload is INCOMPLETE (missing minimum identity fields); "${packet.recommendation}" cannot be sealed — required disposition is REQUEST_EVIDENCE.`);
  }

  return errors;
}

export function travelRuleMissingFields(caseInput: CaseInput): string[] {
  const missing: string[] = [];
  const tr = caseInput.travelRule;
  if (!tr.originator) missing.push("originator identity");
  if (!tr.beneficiary) missing.push("beneficiary identity");
  if (!tr.beneficiaryVasp) missing.push("beneficiary VASP");
  return missing;
}
