// Runs the REAL agent orchestrator over the 20 labelled synthetic cases and
// writes measured metrics to lib/evaluation-results.json + docs/EVALUATION_REPORT.md.
// Non-deterministic: real agents will not score 20/20 like the old scripted
// function — that is expected and reported honestly.
import { writeFileSync } from "node:fs";
import type { DecisionPacket } from "../lib/contracts.ts";
import { EVALUATION_CASES } from "../lib/evaluation-cases.ts";
import { EVALUATION_LABELS } from "../lib/evaluation-labels.ts";
import { Datastore } from "../server/datastore.ts";
import { runOrchestrator } from "../server/orchestrator.ts";
import { loadEnvLocal, nowIso } from "../server/util.ts";

loadEnvLocal();

const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY || 3);
const LIMIT = Number(process.env.EVAL_LIMIT || EVALUATION_CASES.length);
const cases = EVALUATION_CASES.slice(0, LIMIT);
const store = new Datastore();

interface RunOutcome {
  caseId: string;
  packet: DecisionPacket | null;
  status: string;
  ms: number;
  objections: number;
  highObjections: number;
  revisions: number;
}

async function runOne(caseId: string): Promise<RunOutcome> {
  let objections = 0, highObjections = 0, revisions = 0;
  const start = Date.now();
  const result = await runOrchestrator({
    caseId,
    runId: caseId,
    store,
    onEvent: (e: any) => {
      if (e.type === "objection") { objections += 1; if (e.severity === "HIGH") highObjections += 1; }
      if (e.type === "revision") revisions += 1;
    },
  });
  return { caseId, packet: result.packet, status: result.status, ms: Date.now() - start, objections, highObjections, revisions };
}

async function pool<T>(items: string[], size: number, fn: (x: string) => Promise<T>): Promise<T[]> {
  const results: T[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
      console.error(`  [${i + 1}/${items.length}] ${items[i]} done`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

function round(v: number): number { return Math.round(v * 1000) / 1000; }

(async () => {
  console.error(`Evaluating ${cases.length} cases with the live agent runtime (model=${process.env.LLM_MODEL}, concurrency=${CONCURRENCY})...`);
  const outcomes = await pool(cases.map((c) => c.id), CONCURRENCY, runOne);

  let dispositionMatches = 0, requiredCitations = 0, matchedCitations = 0;
  let incompleteCases = 0, incompleteMatches = 0, unsupportedClaimCount = 0;
  let agentFailures = 0, challengerBlockedRuns = 0;
  const durations: number[] = [];
  const perCase: any[] = [];

  for (const label of EVALUATION_LABELS.filter((l) => cases.some((c) => c.id === l.caseId))) {
    const o = outcomes.find((x) => x.caseId === label.caseId)!;
    const packet = o.packet;
    durations.push(o.ms);
    if (o.highObjections > 0 || o.revisions > 0) challengerBlockedRuns += 1;
    if (o.status === "AGENT_FAILURE" || !packet) {
      agentFailures += 1;
      perCase.push({ caseId: label.caseId, expected: label.expectedDisposition, actual: "AGENT_FAILURE", citationOk: false, pass: false, ms: o.ms });
      if (label.expectedDisposition === "REQUEST_EVIDENCE") incompleteCases += 1;
      requiredCitations += label.requiredClauses.length;
      continue;
    }
    const dispositionOk = packet.recommendation === label.expectedDisposition;
    if (dispositionOk) dispositionMatches += 1;
    const cited = new Set(packet.citations.map((c) => c.clauseId));
    requiredCitations += label.requiredClauses.length;
    const matchedHere = label.requiredClauses.filter((c) => cited.has(c)).length;
    matchedCitations += matchedHere;
    const citationOk = matchedHere === label.requiredClauses.length;
    if (label.expectedDisposition === "REQUEST_EVIDENCE") {
      incompleteCases += 1;
      const named = new Set(packet.missingEvidence);
      if (packet.recommendation === "REQUEST_EVIDENCE" && label.requiredMissingEvidence.every((m) => named.has(m))) incompleteMatches += 1;
    }
    // Unsupported-claim heuristic: no citations, or an ESCALATE risk indicator absent from the rationale.
    if (!packet.citations.length || (packet.recommendation === "ESCALATE" && packet.riskIndicators.some((r) => !packet.rationale.toLowerCase().includes(r.toLowerCase().slice(0, 12))))) {
      unsupportedClaimCount += 1;
    }
    perCase.push({ caseId: label.caseId, expected: label.expectedDisposition, actual: packet.recommendation, citationOk, pass: dispositionOk && citationOk, ms: o.ms, confidence: packet.confidence });
  }

  const sorted = [...durations].sort((a, b) => a - b);
  const medianWorkflowMs = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

  const metrics = {
    dispositionAgreement: round(dispositionMatches / EVALUATION_LABELS.filter((l) => cases.some((c) => c.id === l.caseId)).length),
    policyCitationRecall: round(matchedCitations / requiredCitations),
    requestEvidenceRecall: incompleteCases ? round(incompleteMatches / incompleteCases) : null,
    unsupportedClaimCount,
    medianWorkflowMs: Math.round(medianWorkflowMs),
    challengerBlockedRuns,
    agentFailures,
  };

  const results = {
    status: "MEASURED",
    model: process.env.LLM_MODEL,
    temperature: 0.2,
    generatedAt: nowIso(),
    caseCount: cases.length,
    metrics,
    perCase,
  };

  writeFileSync("lib/evaluation-results.json", JSON.stringify(results, null, 2));

  const pct = (v: number | null) => (v === null ? "n/a" : `${Math.round(v * 100)}%`);
  const report = `# CaseFlow Evaluation Report

**Measured, not asserted.** These numbers come from running the real agent orchestrator
(triage LLM + compliance-challenger LLM + deterministic guardrails) over the labelled
synthetic case set. Non-deterministic reasoning means results can vary run to run.

- **Model:** ${process.env.LLM_MODEL} (Alibaba Cloud Model Studio, OpenAI-compatible)
- **Temperature:** 0.2
- **Run date:** ${results.generatedAt}
- **Cases evaluated:** ${cases.length} of ${EVALUATION_CASES.length} labelled synthetic cases
- **Labels:** isolated in \`lib/evaluation-labels.ts\`, never shown to the runtime prompts

## Measured metrics

| Metric | Value |
|---|---|
| Disposition agreement | ${pct(metrics.dispositionAgreement)} |
| Policy-citation recall | ${pct(metrics.policyCitationRecall)} |
| REQUEST_EVIDENCE recall (incomplete cases) | ${pct(metrics.requestEvidenceRecall)} |
| Unsupported-claim count | ${metrics.unsupportedClaimCount} |
| Median run time | ${(metrics.medianWorkflowMs / 1000).toFixed(1)} s |
| Runs the challenger blocked / revised | ${metrics.challengerBlockedRuns} |
| Agent failures (no packet sealed) | ${metrics.agentFailures} |

## Per-case results

| Case | Expected | Agent | Citations | Result | Time |
|---|---|---|---|---|---|
${perCase.map((r) => `| ${r.caseId} | ${r.expected} | ${r.actual} | ${r.citationOk ? "✓" : "—"} | ${r.pass ? "PASS" : "MISS"} | ${(r.ms / 1000).toFixed(1)}s |`).join("\n")}

## Notes

- Disposition agreement below 100% is expected for a live LLM and is reported honestly rather than hidden.
- Citation recall counts whether every *required* clause appears; the agent may cite additional supporting clauses.
- The challenger and deterministic guardrails are governance, not scoring: an AGENT_FAILURE is a safe stop, never a fabricated packet.
- Synthetic results do not imply production accuracy, false-positive reduction, or time savings.
`;
  writeFileSync("docs/EVALUATION_REPORT.md", report);

  console.error("\n=== RESULTS ===");
  console.log(JSON.stringify(metrics, null, 2));
  console.error(`\nWrote lib/evaluation-results.json and docs/EVALUATION_REPORT.md`);
})();
