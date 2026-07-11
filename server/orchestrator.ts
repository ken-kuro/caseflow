import type { AuditEvent, DecisionPacket, Disposition, Objection, PolicyCitation } from "../lib/contracts.ts";
import { POLICY_VERSION } from "../lib/policy.ts";
import type { AgentEvent, ChatMessage } from "./agent-loop.ts";
import { runAgentLoop } from "./agent-loop.ts";
import type { Datastore } from "./datastore.ts";
import { travelRuleMissingFields, validatePacket } from "./guardrails.ts";
import {
  APPROVE_DECISION_TOOL,
  CHALLENGER_SYSTEM,
  RAISE_OBJECTION_TOOL,
  readTools,
  SUBMIT_DECISION_TOOL,
  TRIAGE_SYSTEM,
} from "./prompts.ts";
import { nowIso, sha256, uid } from "./util.ts";

const MAX_CRITIQUE_ROUNDS = 2;

export interface OrchestratorInput {
  caseId: string;
  runId: string;
  store: Datastore;
  onEvent: (e: AgentEvent) => void;
  resumeContext?: string; // run-2 "resuming with new evidence" preface
}

export interface OrchestratorResult {
  status: "SEALED" | "AGENT_FAILURE";
  packet: DecisionPacket | null;
  failureReason?: string;
}

interface PacketCore {
  recommendation: Disposition;
  confidence: number;
  rationale: string;
  citations: { clauseId: string; reason: string }[];
  riskIndicators: string[];
  suspectedTypology: string | null;
  missingEvidence: string[];
  nextAction: string;
  escalationNarrative: string | null;
}

function coerceCore(args: any): PacketCore {
  const clamp = (n: any) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5);
  const nullify = (s: any) => (typeof s === "string" && s.trim() ? s : null);
  return {
    recommendation: args?.recommendation,
    confidence: clamp(args?.confidence),
    rationale: String(args?.rationale ?? ""),
    citations: Array.isArray(args?.citations) ? args.citations.filter((c: any) => c && c.clauseId).map((c: any) => ({ clauseId: String(c.clauseId), reason: String(c.reason ?? "") })) : [],
    riskIndicators: Array.isArray(args?.riskIndicators) ? args.riskIndicators.map(String) : [],
    suspectedTypology: nullify(args?.suspectedTypology),
    missingEvidence: Array.isArray(args?.missingEvidence) ? args.missingEvidence.map(String) : [],
    nextAction: String(args?.nextAction ?? ""),
    escalationNarrative: nullify(args?.escalationNarrative),
  };
}

export async function runOrchestrator(input: OrchestratorInput): Promise<OrchestratorResult> {
  const { caseId, runId, store, onEvent } = input;
  const trace: AuditEvent[] = [];
  const objections: Objection[] = [];
  const tools = readTools(store);
  const triageTools = [...tools, SUBMIT_DECISION_TOOL];
  const challengerTools = [...tools, RAISE_OBJECTION_TOOL, APPROVE_DECISION_TOOL];

  const baseUser = `${input.resumeContext ? input.resumeContext + "\n\n" : ""}Resolve the alert for case ${caseId}. Investigate with the tools, retrieve and cite policy, then call submit_decision.`;

  const orchEvent = (action: string, tool: string, output: unknown, status: AuditEvent["status"] = "COMPLETE") => {
    const ts = nowIso();
    trace.push({ id: uid("EV"), actor: "Orchestrator", action, tool, inputHash: sha256({ caseId, action }), outputHash: sha256(output), timestamp: ts, status });
  };

  // --- Triage (with up to MAX_CRITIQUE_ROUNDS attempts driven by the challenger) ---
  let critiqueRounds = 0;
  let core: PacketCore | null = null;
  let extraContext = "";

  async function runTriage(context: string): Promise<PacketCore | null> {
    critiqueRounds += 1;
    const res = await runAgentLoop({
      role: "Triage",
      system: TRIAGE_SYSTEM,
      user: baseUser + (context ? `\n\n${context}` : ""),
      tools: triageTools,
      onEvent,
      maxTurns: 12,
    });
    trace.push(...res.trace);
    if (res.terminalTool !== "submit_decision" || !res.terminalArgs) return null;
    return coerceCore(res.terminalArgs);
  }

  core = await runTriage(extraContext);
  if (!core) {
    onEvent({ type: "agent_failure", reason: "Triage agent did not submit a decision within the turn limit." });
    orchEvent("Triage failed to submit a decision", "orchestrator.guard", { critiqueRounds }, "BLOCKED");
    return { status: "AGENT_FAILURE", packet: null, failureReason: "Triage did not produce a decision." };
  }

  // --- Challenger + bounded revision loop ---
  let approved = false;
  while (true) {
    const challenge = await runChallenger(core, caseId, challengerTools, onEvent, trace);
    if (challenge.type === "approve") {
      approved = true;
      onEvent({ type: "approval", role: "Compliance Challenger", note: challenge.note });
      break;
    }
    // objection raised
    const objection: Objection = {
      id: uid("O"),
      severity: challenge.severity,
      claimChallenged: challenge.claimChallenged,
      evidenceNeeded: challenge.evidenceNeeded,
      resolution: "UNRESOLVED",
    };
    objections.push(objection);
    onEvent({ type: "objection", role: "Compliance Challenger", severity: objection.severity, claim: objection.claimChallenged, evidenceNeeded: objection.evidenceNeeded });

    if (objection.severity === "HIGH" && critiqueRounds < MAX_CRITIQUE_ROUNDS) {
      onEvent({ type: "revision", round: critiqueRounds + 1, note: "Challenger raised a HIGH objection; returning to triage with the objection attached." });
      orchEvent(`Revision round ${critiqueRounds + 1} triggered by HIGH objection`, "orchestrator.route", objection);
      const context = `A Compliance Challenger raised a HIGH objection to your previous decision:\n- Claim challenged: ${objection.claimChallenged}\n- Evidence needed: ${objection.evidenceNeeded.join(", ") || "(none specified)"}\nRe-investigate as needed and submit a corrected decision.`;
      const revised = await runTriage(context);
      if (!revised) {
        onEvent({ type: "agent_failure", reason: "Triage failed to submit a revised decision after a HIGH objection." });
        return { status: "AGENT_FAILURE", packet: null, failureReason: "Revised triage produced no decision." };
      }
      core = revised;
      continue;
    }
    // Non-HIGH advisory objection, or HIGH at the round cap: stop revising.
    if (objection.severity !== "HIGH") objection.resolution = "RESOLVED";
    break;
  }
  if (approved) for (const o of objections) o.resolution = "RESOLVED";

  // --- Assemble the packet, then run deterministic guardrails ---
  let packet = assemble(core, caseId, runId, objections, store, critiqueRounds, trace);
  let errors = validatePacket(packet, store.snapshot(caseId));
  onEvent({ type: "guardrail", ok: errors.length === 0, errors, note: errors.length ? "Guardrail validation failed; retrying triage once with the errors attached." : "Guardrail validation passed." });
  orchEvent(errors.length ? "Guardrail validation failed" : "Guardrail validation passed", "packet.validate", errors, errors.length ? "BLOCKED" : "COMPLETE");

  if (errors.length && critiqueRounds < MAX_CRITIQUE_ROUNDS + 1) {
    const context = `Your decision failed deterministic validation:\n${errors.map((e) => `- ${e}`).join("\n")}\nSubmit a corrected decision that resolves every issue.`;
    const revised = await runTriage(context);
    if (revised) {
      core = revised;
      packet = assemble(core, caseId, runId, objections, store, critiqueRounds, trace);
      errors = validatePacket(packet, store.snapshot(caseId));
      onEvent({ type: "guardrail", ok: errors.length === 0, errors, note: errors.length ? "Guardrail validation still failing." : "Guardrail validation passed after retry." });
      orchEvent(errors.length ? "Guardrail validation failed after retry" : "Guardrail validation passed after retry", "packet.validate", errors, errors.length ? "BLOCKED" : "COMPLETE");
    }
  }

  if (errors.length) {
    onEvent({ type: "agent_failure", reason: `Decision could not pass deterministic guardrails: ${errors.join(" ")}` });
    return { status: "AGENT_FAILURE", packet: null, failureReason: errors.join(" ") };
  }

  orchEvent(`Sealed ${packet.recommendation} decision`, "packet.seal", { recommendation: packet.recommendation, citations: packet.citations.map((c) => c.clauseId) });
  packet.trace = trace;
  packet.generatedAt = nowIso();
  onEvent({ type: "decision", recommendation: packet.recommendation, packet });
  return { status: "SEALED", packet };
}

interface ChallengeApprove { type: "approve"; note: string }
interface ChallengeObject { type: "object"; severity: "LOW" | "MEDIUM" | "HIGH"; claimChallenged: string; evidenceNeeded: string[] }

async function runChallenger(
  core: PacketCore,
  caseId: string,
  challengerTools: ReturnType<typeof readTools>,
  onEvent: (e: AgentEvent) => void,
  trace: AuditEvent[],
): Promise<ChallengeApprove | ChallengeObject> {
  const proposal = JSON.stringify(core, null, 2);
  const priorMessages: ChatMessage[] = [];
  const res = await runAgentLoop({
    role: "Compliance Challenger",
    system: CHALLENGER_SYSTEM,
    user: `The Triage agent proposed this decision packet for case ${caseId}:\n\n${proposal}\n\nVerify it with the tools if needed, then either raise_objection or approve_decision.`,
    tools: challengerTools,
    onEvent,
    maxTurns: 6,
    priorMessages,
  });
  trace.push(...res.trace);
  if (res.terminalTool === "approve_decision") {
    return { type: "approve", note: String(res.terminalArgs?.note ?? "Approved.") };
  }
  if (res.terminalTool === "raise_objection") {
    const a = res.terminalArgs ?? {};
    const severity = ["LOW", "MEDIUM", "HIGH"].includes(a.severity) ? a.severity : "MEDIUM";
    return { type: "object", severity, claimChallenged: String(a.claimChallenged ?? "Unspecified challenge."), evidenceNeeded: Array.isArray(a.evidenceNeeded) ? a.evidenceNeeded.map(String) : [] };
  }
  // Challenger produced no terminal tool — treat as a conservative MEDIUM note.
  return { type: "object", severity: "MEDIUM", claimChallenged: "Challenger did not return a structured verdict within the turn limit.", evidenceNeeded: [] };
}

function assemble(
  core: PacketCore,
  caseId: string,
  runId: string,
  objections: Objection[],
  store: Datastore,
  critiqueRounds: number,
  trace: AuditEvent[],
): DecisionPacket {
  const snapshot = store.snapshot(caseId);
  const citations: PolicyCitation[] = core.citations.map((c) => ({ clauseId: c.clauseId, version: POLICY_VERSION, reason: c.reason }));
  // Deterministic backstop: a REQUEST_EVIDENCE packet must name missing evidence.
  let missingEvidence = core.missingEvidence;
  if (core.recommendation === "REQUEST_EVIDENCE" && missingEvidence.length === 0) {
    missingEvidence = travelRuleMissingFields(snapshot);
  }
  return {
    caseId,
    runId,
    policyVersion: POLICY_VERSION,
    recommendation: core.recommendation,
    confidence: core.confidence,
    rationale: core.rationale,
    evidence: store.normalizedEvidence(caseId),
    citations,
    riskIndicators: core.riskIndicators,
    suspectedTypology: core.suspectedTypology,
    objections,
    missingEvidence,
    nextAction: core.nextAction,
    escalationNarrative: core.recommendation === "ESCALATE" ? core.escalationNarrative : null,
    trace,
    critiqueRounds,
    generatedAt: nowIso(),
    humanDisposition: null,
    overrideReason: null,
  };
}
