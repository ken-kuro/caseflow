import type { ToolDef } from "./agent-loop.ts";
import type { Datastore } from "./datastore.ts";

const caseIdParam = {
  type: "object",
  properties: { caseId: { type: "string", description: "The case id, e.g. CF-003." } },
  required: ["caseId"],
};

// Read tools shared by triage and challenger, bound to a datastore instance.
export function readTools(store: Datastore): ToolDef[] {
  return [
    { name: "get_alert", description: "Fetch the alert metadata (type, vendor score, status) for a case.", parameters: caseIdParam, handler: (a) => store.getAlert(a.caseId) },
    { name: "get_customer_profile", description: "Fetch the synthetic KYC profile: verification state, residency, risk tier, prior alerts.", parameters: caseIdParam, handler: (a) => store.getCustomerProfile(a.caseId) },
    { name: "get_transaction_history", description: "Fetch the transaction: amount, currency, corridor, asset, 24h transfer velocity, counterparties.", parameters: caseIdParam, handler: (a) => store.getTransactionHistory(a.caseId) },
    { name: "get_wallet_intelligence", description: "Fetch wallet-intelligence signals: exposure level, hops, risk labels, linked entities.", parameters: caseIdParam, handler: (a) => store.getWalletIntelligence(a.caseId) },
    { name: "get_travel_rule_payload", description: "Fetch the Travel Rule payload: originator, beneficiary, beneficiary VASP, completeness, contradictions, and any missing required fields.", parameters: caseIdParam, handler: (a) => store.getTravelRulePayload(a.caseId) },
    {
      name: "search_policy",
      description: "Lexical keyword search over the versioned policy clause corpus. Returns clause IDs you MUST cite by exact id.",
      parameters: { type: "object", properties: { query: { type: "string", description: "Keywords, e.g. 'travel rule minimum data' or 'wallet exposure escalation'." } }, required: ["query"] },
      handler: (a) => store.searchPolicy(a.query),
    },
    {
      name: "search_prior_cases",
      description: "Lexical keyword search over a set of resolved synthetic precedent cases and their dispositions.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      handler: (a) => store.searchPriorCases(a.query),
    },
  ];
}

export const SUBMIT_DECISION_TOOL: ToolDef = {
  name: "submit_decision",
  description: "Submit the final decision packet core. Call this exactly once, only after gathering evidence and retrieving policy.",
  terminal: true,
  parameters: {
    type: "object",
    properties: {
      recommendation: { type: "string", enum: ["CLEAR", "ESCALATE", "REQUEST_EVIDENCE"] },
      confidence: { type: "number", description: "Calibrated confidence in [0,1]." },
      rationale: { type: "string", description: "Why this disposition, grounded in the fetched evidence." },
      citations: {
        type: "array",
        description: "Policy clauses supporting the decision. Use exact clause IDs returned by search_policy.",
        items: { type: "object", properties: { clauseId: { type: "string" }, reason: { type: "string" } }, required: ["clauseId", "reason"] },
      },
      riskIndicators: { type: "array", items: { type: "string" } },
      suspectedTypology: { type: ["string", "null"], description: "Suspected AML/KYT typology, or null." },
      missingEvidence: { type: "array", items: { type: "string" }, description: "Required for REQUEST_EVIDENCE; the specific missing fields." },
      nextAction: { type: "string" },
      escalationNarrative: { type: ["string", "null"], description: "Analyst-ready narrative for ESCALATE, else null." },
    },
    required: ["recommendation", "confidence", "rationale", "citations", "riskIndicators", "missingEvidence", "nextAction"],
  },
};

export const RAISE_OBJECTION_TOOL: ToolDef = {
  name: "raise_objection",
  description: "Raise an objection against the proposed decision. Severity HIGH blocks the decision from being sealed.",
  terminal: true,
  parameters: {
    type: "object",
    properties: {
      severity: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
      claimChallenged: { type: "string", description: "The specific claim or assumption you are challenging." },
      evidenceNeeded: { type: "array", items: { type: "string" } },
    },
    required: ["severity", "claimChallenged", "evidenceNeeded"],
  },
};

export const APPROVE_DECISION_TOOL: ToolDef = {
  name: "approve_decision",
  description: "Approve the proposed decision when it is well-supported, correctly cited, and Travel-Rule-complete for its disposition.",
  terminal: true,
  parameters: { type: "object", properties: { note: { type: "string" } }, required: ["note"] },
};

export const TRIAGE_SYSTEM = `You are an AML/KYT triage analyst assistant for GoTyme's CaseFlow. All data is SYNTHETIC.

Your job: resolve one alert into exactly one recommendation — CLEAR, ESCALATE, or REQUEST_EVIDENCE — that a human analyst can defend.

Rules:
- Gather evidence with the read tools BEFORE concluding. At minimum inspect the alert, customer profile, transaction, wallet intelligence, and Travel Rule payload.
- Retrieve policy with search_policy and cite the specific clause IDs it returns (exact ids like TR-1.2, KYT-3.1, KYC-2.4, CLR-1.1). Never invent clause IDs.
- You may consult search_prior_cases for precedent.
- Dispositions:
  - CLEAR: required evidence is complete and no material risk indicator remains.
  - ESCALATE: evidence supports analyst investigation (e.g. high-risk wallet exposure, rapid onward movement, linked entities, or a material identity/corridor contradiction) AND the Travel Rule minimum fields are complete.
  - REQUEST_EVIDENCE: a defensible decision cannot be made yet. If the Travel Rule payload is INCOMPLETE (missing originator, beneficiary, or beneficiary VASP), you MUST return REQUEST_EVIDENCE and name the missing fields.
- The vendor score is a third-party signal, not a disposition.
- You produce recommendations only. You never file reports, freeze funds, clear customers, or take any customer-impacting action.
- When ready, call submit_decision exactly once with well-formed arguments.`;

export const CHALLENGER_SYSTEM = `You are the Compliance Challenger for CaseFlow — an adversarial reviewer. All data is SYNTHETIC.

You receive a proposed decision packet. Your job is to attack it:
- Check that every claim is supported by the fetched evidence.
- Check that cited clause IDs actually support the disposition (use search_policy / the read tools to verify).
- Check Travel Rule completeness: a CLEAR or ESCALATE on an INCOMPLETE Travel Rule payload is indefensible.
- Watch for unsupported assumptions and over-confidence.

Be efficient: verify with at most 2-3 targeted tool calls (do not re-fetch everything), keep your reasoning brief, then call exactly one of:
- raise_objection(severity, claimChallenged, evidenceNeeded): severity HIGH blocks the decision.
- approve_decision(note): only when the decision is well-supported and correctly cited.

Raise a HIGH objection if the disposition is unsupported or the Travel Rule payload is incomplete for a CLEAR/ESCALATE. Be strict but fair, and decide quickly.`;
