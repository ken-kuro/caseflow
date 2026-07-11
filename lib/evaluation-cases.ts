import type { CaseInput } from "./contracts.ts";

const createdAt = "2026-07-11T07:00:00.000Z";

function makeCase(index: number, kind: "clear" | "wallet" | "velocity" | "incomplete" | "contradiction"): CaseInput {
  const id = `EV-${String(index).padStart(2, "0")}`;
  const complete = kind !== "incomplete";
  const riskyWallet = kind === "wallet";
  const rapid = kind === "velocity";
  const contradiction = kind === "contradiction";
  return {
    id,
    title: `Synthetic evaluation case ${index}`,
    alertType: kind === "wallet" ? "WALLET_RISK" : kind === "velocity" ? "RAPID_MOVEMENT" : "TRAVEL_RULE",
    createdAt,
    status: complete ? "NEW" : "PAUSED",
    vendorScore: riskyWallet || rapid ? 88 : contradiction ? 68 : complete ? 22 : 62,
    customer: { syntheticName: `Synthetic Evaluation Customer ${index}`, kycState: contradiction ? "REVIEW" : "VERIFIED", residency: "PH", riskTier: riskyWallet ? "HIGH" : contradiction ? "MEDIUM" : "LOW", priorAlerts: riskyWallet ? 2 : 0 },
    transaction: { amount: riskyWallet || rapid ? 640000 : 38000, currency: "PHP", corridor: contradiction ? "PH → VN" : "PH → SG", asset: "USDC", transfers24h: rapid ? 8 : 1, counterparties: rapid ? 5 : 1 },
    wallet: { exposure: riskyWallet ? "HIGH" : "LOW", hops: riskyWallet ? 1 : 3, labels: riskyWallet ? ["high-risk service"] : ["known counterparty"], linkedEntities: riskyWallet ? 4 : 0 },
    travelRule: {
      originator: `Synthetic Evaluation Customer ${index}`,
      beneficiary: complete ? `Synthetic Beneficiary ${index}` : null,
      beneficiaryVasp: complete ? "Synthetic VASP SG" : null,
      completeness: complete ? "COMPLETE" : "INCOMPLETE",
      contradictions: contradiction ? ["Transfer residency states VN while the customer profile states PH"] : [],
    },
  };
}

export const EVALUATION_CASES: CaseInput[] = [
  ...[1, 2, 3, 4, 5].map((index) => makeCase(index, "clear")),
  ...[6, 7, 8, 9].map((index) => makeCase(index, "wallet")),
  ...[10, 11, 12].map((index) => makeCase(index, "velocity")),
  ...[13, 14, 15, 16, 17].map((index) => makeCase(index, "incomplete")),
  ...[18, 19, 20].map((index) => makeCase(index, "contradiction")),
];
