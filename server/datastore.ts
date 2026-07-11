import type { CaseInput, EvidenceItem } from "../lib/contracts.ts";
import { DEMO_CASES } from "../lib/demo-cases.ts";
import { EVALUATION_CASES } from "../lib/evaluation-cases.ts";
import { POLICY } from "../lib/policy.ts";

// A handful of seeded, already-resolved synthetic cases so `search_prior_cases`
// does real lexical retrieval over precedent instead of returning nothing.
export interface PriorCase {
  id: string;
  summary: string;
  disposition: "CLEAR" | "ESCALATE" | "REQUEST_EVIDENCE";
  keywords: string[];
}

export const PRIOR_CASES: PriorCase[] = [
  {
    id: "PC-101",
    summary: "PH→SG USDC transfer to a known merchant counterparty, verified KYC, complete Travel Rule, low wallet exposure. Resolved CLEAR under CLR-1.1.",
    disposition: "CLEAR",
    keywords: ["known counterparty", "clear", "complete travel rule", "low exposure", "usdc", "merchant"],
  },
  {
    id: "PC-102",
    summary: "High-risk wallet exposure with rapid peel-chain onward movement and 4 linked entities. Escalated under KYT-3.1 with a fund-flow narrative.",
    disposition: "ESCALATE",
    keywords: ["high-risk wallet", "peel chain", "rapid movement", "linked entities", "escalate", "layering"],
  },
  {
    id: "PC-103",
    summary: "Incomplete Travel Rule payload missing beneficiary and beneficiary VASP. Stopped at REQUEST_EVIDENCE under TR-1.2 until identity fields were supplied.",
    disposition: "REQUEST_EVIDENCE",
    keywords: ["incomplete travel rule", "missing beneficiary", "missing vasp", "request evidence", "identity"],
  },
  {
    id: "PC-104",
    summary: "Corridor/residency contradiction (transfer VN vs customer profile PH) with open KYC review. Escalated under KYC-2.4 once minimum evidence was complete.",
    disposition: "ESCALATE",
    keywords: ["contradiction", "residency mismatch", "kyc review", "escalate", "corridor"],
  },
  {
    id: "PC-105",
    summary: "Remittance under threshold, verified identity, single counterparty, no wallet risk signals. Resolved CLEAR under CLR-1.1.",
    disposition: "CLEAR",
    keywords: ["remittance", "verified", "single counterparty", "clear", "low risk"],
  },
];

function completeTravelRule(input: CaseInput): CaseInput {
  return {
    ...input,
    status: "READY",
    travelRule: {
      ...input.travelRule,
      beneficiary: input.travelRule.beneficiary ?? "Synthetic Beneficiary C",
      beneficiaryVasp: input.travelRule.beneficiaryVasp ?? "Synthetic VASP VN",
      completeness: "COMPLETE",
      // The residency contradiction survives evidence completion — it is a
      // substantive risk signal, not a missing field. This is what drives the
      // resumed CF-003 run to ESCALATE rather than CLEAR.
    },
  };
}

// Tool result shapes. Each is a synthetic slice of one case the agent must
// fetch individually so multi-step tool use is real and visible.
export class Datastore {
  private cases = new Map<string, CaseInput>();

  constructor(seed: CaseInput[] = [...DEMO_CASES, ...EVALUATION_CASES]) {
    for (const c of seed) this.cases.set(c.id, structuredClone(c));
  }

  private require(caseId: string): CaseInput {
    const c = this.cases.get(caseId);
    if (!c) throw new Error(`Unknown case: ${caseId}`);
    return c;
  }

  snapshot(caseId: string): CaseInput {
    return structuredClone(this.require(caseId));
  }

  getAlert(caseId: string) {
    const c = this.require(caseId);
    return {
      caseId: c.id,
      title: c.title,
      alertType: c.alertType,
      vendorScore: c.vendorScore,
      status: c.status,
      createdAt: c.createdAt,
      note: "Vendor score is a third-party signal, not a disposition.",
    };
  }

  getCustomerProfile(caseId: string) {
    const c = this.require(caseId);
    return { caseId: c.id, ...c.customer };
  }

  getTransactionHistory(caseId: string) {
    const c = this.require(caseId);
    return { caseId: c.id, ...c.transaction };
  }

  getWalletIntelligence(caseId: string) {
    const c = this.require(caseId);
    return { caseId: c.id, ...c.wallet };
  }

  getTravelRulePayload(caseId: string) {
    const c = this.require(caseId);
    const tr = c.travelRule;
    const missing: string[] = [];
    if (!tr.originator) missing.push("originator identity");
    if (!tr.beneficiary) missing.push("beneficiary identity");
    if (!tr.beneficiaryVasp) missing.push("beneficiary VASP");
    return { caseId: c.id, ...tr, missingRequiredFields: missing };
  }

  // Honest lexical (substring/keyword) retrieval — NOT semantic search.
  searchPolicy(query: string) {
    const q = (query || "").toLowerCase();
    const terms = q.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
    const scored = POLICY.map((clause) => {
      const hay = `${clause.id} ${clause.title} ${clause.text} ${clause.type}`.toLowerCase();
      let score = 0;
      for (const t of terms) if (hay.includes(t)) score += 1;
      if (q && hay.includes(q)) score += 2;
      return { clause, score };
    })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);
    const hits = (scored.length ? scored : POLICY.map((clause) => ({ clause, score: 0 })))
      .slice(0, 5)
      .map((r) => ({
        clauseId: r.clause.id,
        version: r.clause.version,
        title: r.clause.title,
        text: r.clause.text,
        type: r.clause.type,
      }));
    return { query, method: "lexical keyword match", results: hits };
  }

  searchPriorCases(query: string) {
    const q = (query || "").toLowerCase();
    const terms = q.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
    const scored = PRIOR_CASES.map((pc) => {
      const hay = `${pc.summary} ${pc.keywords.join(" ")}`.toLowerCase();
      let score = 0;
      for (const t of terms) if (hay.includes(t)) score += 1;
      return { pc, score };
    })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((r) => ({ id: r.pc.id, summary: r.pc.summary, disposition: r.pc.disposition }));
    return { query, method: "lexical keyword match", results: scored };
  }

  // Apply the seeded missing Travel Rule evidence — makes run 2 a genuine resume.
  applyTravelRuleEvidence(caseId: string): CaseInput {
    const updated = completeTravelRule(this.require(caseId));
    this.cases.set(caseId, updated);
    return structuredClone(updated);
  }

  // Build the normalized evidence timeline from the data the tools actually
  // served for this case (honest: reflects the synthetic evidence record).
  normalizedEvidence(caseId: string): EvidenceItem[] {
    const c = this.require(caseId);
    return [
      { id: `${c.id}-E1`, label: "Customer profile", value: `${c.customer.kycState} · ${c.customer.residency} · ${c.customer.riskTier} risk · ${c.customer.priorAlerts} prior alerts`, source: "get_customer_profile", timestamp: c.createdAt, reliability: "HIGH" },
      { id: `${c.id}-E2`, label: "Transaction", value: `${c.transaction.currency} ${c.transaction.amount.toLocaleString("en-US")} · ${c.transaction.corridor} · ${c.transaction.asset} · ${c.transaction.transfers24h} transfers/24h · ${c.transaction.counterparties} counterparties`, source: "get_transaction_history", timestamp: c.createdAt, reliability: "HIGH" },
      { id: `${c.id}-E3`, label: "Wallet intelligence", value: `${c.wallet.exposure} exposure · ${c.wallet.hops} hops · ${c.wallet.linkedEntities} linked entities · ${c.wallet.labels.join(", ") || "no labels"}`, source: "get_wallet_intelligence", timestamp: c.createdAt, reliability: "MEDIUM" },
      { id: `${c.id}-E4`, label: "Travel Rule payload", value: `${c.travelRule.completeness}${c.travelRule.contradictions.length ? ` · ${c.travelRule.contradictions.join("; ")}` : ""}`, source: "get_travel_rule_payload", timestamp: c.createdAt, reliability: c.travelRule.completeness === "COMPLETE" ? "HIGH" : "LOW", contradiction: c.travelRule.contradictions[0] },
    ];
  }
}
