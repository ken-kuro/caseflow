import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { DecisionPacket } from "../lib/contracts.ts";
import { DEMO_CASES } from "../lib/demo-cases.ts";
import { POLICY_VERSION } from "../lib/policy.ts";
import { Datastore } from "../server/datastore.ts";
import { travelRuleMissingFields, validatePacket } from "../server/guardrails.ts";

const store = new Datastore();
const CF003 = DEMO_CASES.find((c) => c.id === "CF-003")!;
const CF001 = DEMO_CASES.find((c) => c.id === "CF-001")!;

function packet(overrides: Partial<DecisionPacket>): DecisionPacket {
  return {
    caseId: "CF-001", runId: "CF-001-RUN-01", policyVersion: POLICY_VERSION,
    recommendation: "CLEAR", confidence: 0.9, rationale: "ok",
    evidence: store.normalizedEvidence("CF-001"),
    citations: [{ clauseId: "CLR-1.1", version: POLICY_VERSION, reason: "complete" }],
    riskIndicators: [], suspectedTypology: null, objections: [], missingEvidence: [],
    nextAction: "Analyst reviews.", escalationNarrative: null, trace: [], critiqueRounds: 1,
    generatedAt: new Date().toISOString(), humanDisposition: null, overrideReason: null,
    ...overrides,
  };
}

test("a well-formed CLEAR packet passes the deterministic guardrails", () => {
  assert.deepEqual(validatePacket(packet({}), CF001), []);
});

test("guardrail hard-stop: an INCOMPLETE Travel Rule payload cannot be sealed CLEAR or ESCALATE", () => {
  const clearErrors = validatePacket(packet({ caseId: "CF-003", recommendation: "CLEAR" }), CF003);
  assert.ok(clearErrors.some((e) => /INCOMPLETE/.test(e)), "CLEAR on incomplete TR must be blocked");
  const escErrors = validatePacket(packet({ caseId: "CF-003", recommendation: "ESCALATE", escalationNarrative: "x" }), CF003);
  assert.ok(escErrors.some((e) => /INCOMPLETE/.test(e)), "ESCALATE on incomplete TR must be blocked");
});

test("a REQUEST_EVIDENCE packet must name the missing evidence", () => {
  const errors = validatePacket(packet({ caseId: "CF-003", recommendation: "REQUEST_EVIDENCE", missingEvidence: [] }), CF003);
  assert.ok(errors.some((e) => /missing evidence/i.test(e)));
  const ok = validatePacket(packet({ caseId: "CF-003", recommendation: "REQUEST_EVIDENCE", missingEvidence: ["beneficiary identity", "beneficiary VASP"] }), CF003);
  assert.deepEqual(ok, []);
});

test("guardrails reject invented clause ids, out-of-range confidence, and critique overflow", () => {
  assert.ok(validatePacket(packet({ citations: [{ clauseId: "ZZ-9.9", version: POLICY_VERSION, reason: "?" }] }), CF001).some((e) => /does not exist/.test(e)));
  assert.ok(validatePacket(packet({ confidence: 1.4 }), CF001).some((e) => /\[0, 1\]/.test(e)));
  assert.ok(validatePacket(packet({ critiqueRounds: 3 }), CF001).some((e) => /round limit/.test(e)));
});

test("travelRuleMissingFields names the CF-003 gaps", () => {
  assert.deepEqual(travelRuleMissingFields(CF003), ["beneficiary identity", "beneficiary VASP"]);
});

// --- Replay fixture integrity: recorded runs carry real timestamps + real SHA-256 ---
const RECORDINGS = "server/recordings";
const files = (() => { try { return readdirSync(RECORDINGS).filter((f) => f.endsWith(".json")); } catch { return []; } })();

test("recorded runs exist to back replay mode without an API key", () => {
  assert.ok(files.length >= 4, `expected the demo recordings, found ${files.length}`);
});

for (const file of files) {
  test(`recording ${file} has real timestamps and real SHA-256 audit hashes`, () => {
    const rec = JSON.parse(readFileSync(join(RECORDINGS, file), "utf8"));
    assert.ok(["SEALED", "AGENT_FAILURE"].includes(rec.status), "status must be honest");
    const decision = rec.events.find((e: any) => e.type === "decision");
    if (rec.status === "SEALED") {
      assert.ok(decision, "sealed run must carry a decision packet");
      const trace = decision.packet.trace as DecisionPacket["trace"];
      assert.ok(trace.length > 0);
      for (const ev of trace) {
        assert.match(ev.outputHash, /^[0-9a-f]{64}$/, "SHA-256 hash");
        assert.ok(!Number.isNaN(Date.parse(ev.timestamp)), "real ISO timestamp");
      }
    }
  });
}

test("CF-003 tells the pause→resume story: run1 REQUEST_EVIDENCE, run2 ESCALATE", () => {
  const read = (f: string) => JSON.parse(readFileSync(join(RECORDINGS, f), "utf8"));
  const run1 = read("CF-003-run1.json");
  assert.equal(run1.recommendation, "REQUEST_EVIDENCE");
  const packet1 = run1.events.find((e: any) => e.type === "decision").packet;
  for (const need of ["beneficiary identity", "beneficiary VASP"]) assert.ok(packet1.missingEvidence.includes(need));
  const run2 = read("CF-003-run2.json");
  assert.equal(run2.recommendation, "ESCALATE");
  const packet2 = run2.events.find((e: any) => e.type === "decision").packet;
  assert.ok(packet2.citations.some((c: any) => c.clauseId === "KYC-2.4"));
});
