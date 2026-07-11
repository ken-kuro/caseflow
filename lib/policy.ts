import type { PolicyClause } from "./contracts.ts";

export const POLICY_VERSION = "2026.07";

export const POLICY: PolicyClause[] = [
  {
    id: "TR-1.2",
    version: POLICY_VERSION,
    title: "Travel Rule minimum data",
    text: "Originator, beneficiary, and beneficiary VASP data must be present before a transfer alert can be resolved.",
    jurisdiction: "GoTyme synthetic control set",
    type: "EVIDENCE",
  },
  {
    id: "KYT-3.1",
    version: POLICY_VERSION,
    title: "High-risk wallet exposure",
    text: "High-risk wallet exposure, linked entities, or rapid onward movement requires analyst escalation with a documented fund-flow narrative.",
    jurisdiction: "GoTyme synthetic control set",
    type: "ESCALATION",
  },
  {
    id: "KYC-2.4",
    version: POLICY_VERSION,
    title: "Identity contradictions",
    text: "Material contradictions between verified customer data and transfer data require analyst escalation once minimum evidence is complete.",
    jurisdiction: "GoTyme synthetic control set",
    type: "ESCALATION",
  },
  {
    id: "CLR-1.1",
    version: POLICY_VERSION,
    title: "Explainable low-risk clearance",
    text: "A low-risk alert may be recommended for clearance only when required evidence is complete and no material risk indicator remains unresolved.",
    jurisdiction: "GoTyme synthetic control set",
    type: "CLEARANCE",
  },
  {
    id: "GOV-4.2",
    version: POLICY_VERSION,
    title: "Human-controlled policy activation",
    text: "A policy or threshold change requires a versioned proposal, historical replay, and explicit human approval before activation.",
    jurisdiction: "GoTyme synthetic control set",
    type: "GOVERNANCE",
  },
];

export function getClause(id: string): PolicyClause {
  const clause = POLICY.find((item) => item.id === id);
  if (!clause) throw new Error(`Unknown policy clause: ${id}`);
  return clause;
}
