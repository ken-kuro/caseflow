import type { EvaluationLabel } from "./contracts.ts";

// Deliberately isolated from runtime case inputs and workflow prompts.
export const EVALUATION_LABELS: EvaluationLabel[] = [
  ...[1, 2, 3, 4, 5].map((index) => ({ caseId: `EV-${String(index).padStart(2, "0")}`, expectedDisposition: "CLEAR" as const, requiredClauses: ["CLR-1.1", "TR-1.2"], requiredMissingEvidence: [] })),
  ...[6, 7, 8, 9, 10, 11, 12].map((index) => ({ caseId: `EV-${String(index).padStart(2, "0")}`, expectedDisposition: "ESCALATE" as const, requiredClauses: ["KYT-3.1", "TR-1.2"], requiredMissingEvidence: [] })),
  ...[13, 14, 15, 16, 17].map((index) => ({ caseId: `EV-${String(index).padStart(2, "0")}`, expectedDisposition: "REQUEST_EVIDENCE" as const, requiredClauses: ["TR-1.2"], requiredMissingEvidence: ["beneficiary identity", "beneficiary VASP"] })),
  ...[18, 19, 20].map((index) => ({ caseId: `EV-${String(index).padStart(2, "0")}`, expectedDisposition: "ESCALATE" as const, requiredClauses: ["KYC-2.4", "TR-1.2"], requiredMissingEvidence: [] })),
];
