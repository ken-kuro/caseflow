// Demonstrates that the Compliance Challenger genuinely BLOCKS a flawed decision.
// We hand it a deliberately-wrong CLEAR on the incomplete-Travel-Rule case CF-003
// and assert it raises a HIGH objection. Requires LLM_API_KEY. Run: npm run challenger:check
import assert from "node:assert/strict";
import { runAgentLoop } from "../server/agent-loop.ts";
import { Datastore } from "../server/datastore.ts";
import { APPROVE_DECISION_TOOL, CHALLENGER_SYSTEM, RAISE_OBJECTION_TOOL, readTools } from "../server/prompts.ts";
import { loadEnvLocal } from "../server/util.ts";

loadEnvLocal();
const store = new Datastore();

const bogus = {
  recommendation: "CLEAR",
  confidence: 0.9,
  rationale: "Customer looks fine; clearing the alert.",
  citations: [{ clauseId: "CLR-1.1", reason: "Low risk." }],
  riskIndicators: [],
  suspectedTypology: null,
  missingEvidence: [],
  nextAction: "Close the alert.",
  escalationNarrative: null,
};

const res = await runAgentLoop({
  role: "Compliance Challenger",
  system: CHALLENGER_SYSTEM,
  user: `The Triage agent proposed this decision packet for case CF-003:\n\n${JSON.stringify(bogus, null, 2)}\n\nVerify it with the tools if needed, then either raise_objection or approve_decision.`,
  tools: [...readTools(store), RAISE_OBJECTION_TOOL, APPROVE_DECISION_TOOL],
  onEvent: () => {},
  maxTurns: 6,
});

console.log("terminal tool:", res.terminalTool);
console.log("args:", JSON.stringify(res.terminalArgs, null, 2));
assert.equal(res.terminalTool, "raise_objection", "challenger must object to a CLEAR on an incomplete Travel Rule payload");
assert.equal(res.terminalArgs.severity, "HIGH", "the objection must be HIGH (blocking)");
console.log("\nPASS: the Compliance Challenger blocked the flawed CLEAR with a HIGH objection.");
