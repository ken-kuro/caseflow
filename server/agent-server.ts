import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEMO_CASES } from "../lib/demo-cases.ts";
import type { AgentEvent } from "./agent-loop.ts";
import { Datastore } from "./datastore.ts";
import { runOrchestrator } from "./orchestrator.ts";
import { loadEnvLocal, nowIso } from "./util.ts";

loadEnvLocal();

const PORT = Number(process.env.AGENT_PORT || 8788);
const RECORDINGS_DIR = join("server", "recordings");
if (!existsSync(RECORDINGS_DIR)) mkdirSync(RECORDINGS_DIR, { recursive: true });

// One shared datastore so an evidence-add on run 1 persists into run 2.
let store = new Datastore();

function sseHeaders(res: ServerResponse) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "X-Accel-Buffering": "no",
  });
}

function send(res: ServerResponse, event: AgentEvent | Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function runNumberFor(caseId: string): number {
  const prefix = `${caseId}-run`;
  const existing = readdirSync(RECORDINGS_DIR).filter((f) => f.startsWith(prefix) && f.endsWith(".json"));
  return existing.length + 1;
}

function json(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function handleRun(req: IncomingMessage, res: ServerResponse, caseId: string) {
  let snapshot;
  try { snapshot = store.snapshot(caseId); } catch { return json(res, 404, { error: `Unknown case ${caseId}` }); }

  const runNumber = runNumberFor(caseId);
  const runId = `${caseId}-RUN-${String(runNumber).padStart(2, "0")}`;
  const resumeContext = runNumber > 1
    ? `This is a resumed run. Case ${caseId} was previously stopped at REQUEST_EVIDENCE and new Travel Rule evidence has since been added. Re-evaluate with the now-complete evidence.`
    : undefined;

  sseHeaders(res);
  const events: AgentEvent[] = [];
  const record = (e: AgentEvent) => { events.push(e); send(res, e); };

  send(res, { type: "mode", mode: "live" } as AgentEvent);
  record({ type: "run_start", caseId, mode: "live", runId });

  let status = "SEALED";
  let recommendation: string | null = null;
  try {
    const result = await runOrchestrator({ caseId, runId, store, onEvent: record, resumeContext });
    status = result.status;
    recommendation = result.packet?.recommendation ?? null;
    record({ type: "run_complete", runId, recommendation, status });
  } catch (err) {
    status = "ERROR";
    record({ type: "agent_failure", reason: `Runtime error: ${String(err).slice(0, 400)}` });
    record({ type: "run_complete", runId, recommendation: null, status: "ERROR" });
  }

  // Persist the full event log — real runs become replay fixtures.
  const recording = { caseId, runId, runNumber, mode: "live", status, recommendation, createdAt: nowIso(), model: process.env.LLM_MODEL, events };
  const file = join(RECORDINGS_DIR, `${caseId}-run${runNumber}.json`);
  try { writeFileSync(file, JSON.stringify(recording, null, 2)); } catch { /* non-fatal */ }
  send(res, { type: "recorded", recordingId: `${caseId}-run${runNumber}` });
  res.end();
}

async function handleEvidence(res: ServerResponse, caseId: string) {
  try {
    const updated = store.applyTravelRuleEvidence(caseId);
    return json(res, 200, { ok: true, caseId, travelRule: updated.travelRule, status: updated.status });
  } catch (err) {
    return json(res, 404, { error: String(err) });
  }
}

const REPLAY_DELAY: Record<string, number> = {
  thinking: 12, tool_call: 320, tool_result: 260, objection: 420, approval: 320,
  revision: 400, guardrail: 340, decision: 260, role_start: 200, role_end: 120,
  run_start: 150, agent_failure: 400, run_complete: 150, mode: 50,
};

async function handleReplay(res: ServerResponse, recordingId: string) {
  const file = join(RECORDINGS_DIR, `${recordingId}.json`);
  if (!existsSync(file)) return json(res, 404, { error: `No recording ${recordingId}` });
  const recording = JSON.parse(readFileSync(file, "utf8"));
  sseHeaders(res);
  send(res, { type: "mode", mode: "replay" });
  for (const e of recording.events as AgentEvent[]) {
    send(res, e);
    const delay = REPLAY_DELAY[e.type] ?? 120;
    await new Promise((r) => setTimeout(r, delay));
  }
  send(res, { type: "recorded", recordingId });
  res.end();
}

function handleList(res: ServerResponse) {
  const recordings = readdirSync(RECORDINGS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const r = JSON.parse(readFileSync(join(RECORDINGS_DIR, f), "utf8"));
        return { recordingId: f.replace(/\.json$/, ""), caseId: r.caseId, runId: r.runId, recommendation: r.recommendation, status: r.status, createdAt: r.createdAt, mode: r.mode };
      } catch { return null; }
    })
    .filter(Boolean);
  json(res, 200, { recordings });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }

  try {
    if (parts[0] !== "api") return json(res, 404, { error: "Not found" });

    // GET /api/health
    if (req.method === "GET" && parts[1] === "health") {
      return json(res, 200, { ok: true, model: process.env.LLM_MODEL, hasKey: Boolean(process.env.LLM_API_KEY), time: nowIso() });
    }
    // GET /api/cases
    if (req.method === "GET" && parts[1] === "cases") {
      return json(res, 200, { cases: DEMO_CASES.map((c) => store.snapshot(c.id)) });
    }
    // POST /api/reset
    if (req.method === "POST" && parts[1] === "reset") {
      store = new Datastore();
      return json(res, 200, { ok: true });
    }
    // GET /api/recordings
    if (req.method === "GET" && parts[1] === "recordings") return handleList(res);
    // GET /api/replay/:recordingId
    if (req.method === "GET" && parts[1] === "replay" && parts[2]) return handleReplay(res, decodeURIComponent(parts[2]));
    // POST /api/run/:caseId
    if (req.method === "POST" && parts[1] === "run" && parts[2]) return handleRun(req, res, decodeURIComponent(parts[2]));
    // POST /api/case/:caseId/evidence
    if (req.method === "POST" && parts[1] === "case" && parts[2] && parts[3] === "evidence") return handleEvidence(res, decodeURIComponent(parts[2]));

    return json(res, 404, { error: "Not found" });
  } catch (err) {
    return json(res, 500, { error: String(err) });
  }
});

server.listen(PORT, () => {
  const mode = process.env.LLM_API_KEY ? "LIVE (key present)" : "REPLAY-ONLY (no API key)";
  console.log(`[agent-server] listening on http://localhost:${PORT} — ${mode}, model=${process.env.LLM_MODEL}`);
});
