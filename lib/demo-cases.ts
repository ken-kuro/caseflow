import type { CaseInput } from "./contracts.ts";

const timestamp = "2026-07-11T08:30:00.000Z";

export const DEMO_CASES: CaseInput[] = [
  {
    id: "CF-001",
    title: "Known counterparty pattern",
    alertType: "TRAVEL_RULE",
    createdAt: timestamp,
    status: "NEW",
    vendorScore: 24,
    customer: { syntheticName: "Synthetic Customer A", kycState: "VERIFIED", residency: "PH", riskTier: "LOW", priorAlerts: 1 },
    transaction: { amount: 42000, currency: "PHP", corridor: "PH → SG", asset: "USDC", transfers24h: 1, counterparties: 1 },
    wallet: { exposure: "LOW", hops: 3, labels: ["known counterparty"], linkedEntities: 0 },
    travelRule: { originator: "Synthetic Customer A", beneficiary: "Synthetic Merchant A", beneficiaryVasp: "Synthetic VASP SG", completeness: "COMPLETE", contradictions: [] },
  },
  {
    id: "CF-002",
    title: "Rapid cross-border wallet flow",
    alertType: "WALLET_RISK",
    createdAt: timestamp,
    status: "NEW",
    vendorScore: 91,
    customer: { syntheticName: "Synthetic Customer B", kycState: "VERIFIED", residency: "PH", riskTier: "HIGH", priorAlerts: 3 },
    transaction: { amount: 780000, currency: "PHP", corridor: "PH → multiple", asset: "USDT", transfers24h: 7, counterparties: 5 },
    wallet: { exposure: "HIGH", hops: 1, labels: ["high-risk service", "rapid peel chain"], linkedEntities: 4 },
    travelRule: { originator: "Synthetic Customer B", beneficiary: "Synthetic Beneficiary B", beneficiaryVasp: "Synthetic VASP HK", completeness: "COMPLETE", contradictions: [] },
  },
  {
    id: "CF-003",
    title: "Incomplete Travel Rule payload",
    alertType: "TRAVEL_RULE",
    createdAt: timestamp,
    status: "PAUSED",
    vendorScore: 74,
    customer: { syntheticName: "Synthetic Customer C", kycState: "REVIEW", residency: "PH", riskTier: "MEDIUM", priorAlerts: 1 },
    transaction: { amount: 265000, currency: "PHP", corridor: "PH → VN", asset: "USDT", transfers24h: 2, counterparties: 2 },
    wallet: { exposure: "MEDIUM", hops: 2, labels: ["new counterparty"], linkedEntities: 1 },
    travelRule: { originator: "Synthetic Customer C", beneficiary: null, beneficiaryVasp: null, completeness: "INCOMPLETE", contradictions: ["Transfer residency states VN while the customer profile states PH"] },
  },
];

export function cloneDemoCases(): CaseInput[] {
  return structuredClone(DEMO_CASES);
}
