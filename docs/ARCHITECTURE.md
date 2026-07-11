# CaseFlow architecture

CaseFlow pairs **non-deterministic reasoning** (an LLM that plans, investigates, and argues) with
**deterministic governance** (typed contracts, bounded rounds, hard evidence gates that decide what can be
sealed). This document is the map; the code is the source of truth.

## Runtime shape

```
Browser (app/CaseFlowApp.tsx)
   │  fetch POST /api/run/:caseId  (Server-Sent Events)
   ▼
Vite dev server  ──proxy /api──▶  Node sidecar (server/agent-server.ts, :8788)
                                        │
                                        ▼
                        Orchestrator (server/orchestrator.ts)
                          ├─ Triage agent      ─┐
                          ├─ Compliance Challenger │  server/agent-loop.ts (LLM tool-use loop)
                          └─ deterministic guardrails (server/guardrails.ts)
                                        │
                                        ▼
                              Tool-shaped datastore (server/datastore.ts)
```

The sidecar is plain `node:http`; Node ≥ 22.13 runs the `.ts` files directly (no build step, no extra npm
deps). The UI talks to it same-origin through Vite's `/api` proxy.

## The agent loop (`server/agent-loop.ts`)

A generic OpenAI-compatible streaming tool-use loop: `fetch` + hand-rolled SSE parsing. It sends the system
prompt + messages + tool schemas, streams `delta.content` (reasoning) and `delta.tool_calls`, executes each
non-terminal tool against its handler, appends the real result, and repeats until a **terminal tool** is
called or the turn cap is hit. Every tool execution emits an audit event with a real
`Date.toISOString()` timestamp and a real SHA-256 (`node:crypto`) of its actual input and output.

## Roles

- **Triage agent** — read tools + `submit_decision` (terminal). Gathers evidence, retrieves and cites policy
  by exact clause ID, and proposes one disposition: `CLEAR`, `ESCALATE`, or `REQUEST_EVIDENCE`.
- **Compliance Challenger** — read tools + `raise_objection` / `approve_decision` (terminal). Independently
  re-verifies the proposed packet. A HIGH objection blocks the decision.

Both roles are the same loop with different prompts and tool sets (`server/prompts.ts`).

## Deterministic orchestrator (`server/orchestrator.ts`)

1. Run Triage → get a proposed packet core (or a labelled `AGENT_FAILURE` if it never submits).
2. Run the Challenger. On a HIGH objection, return to Triage with the objection attached — **max 2 critique
   rounds, enforced in code**.
3. Validate the assembled packet with `validatePacket`. On failure, retry Triage once with the validation
   errors attached. If it still fails, emit `AGENT_FAILURE` — **never a fabricated packet**.

### Guardrails (`server/guardrails.ts`)

Deterministic checks independent of model output: allowed disposition, non-empty evidence/citations/next
action, confidence in `[0,1]`, cited clause IDs exist in the corpus, `REQUEST_EVIDENCE` names its missing
evidence, critique rounds ≤ 2, and the hard-stop that an **INCOMPLETE Travel Rule payload can only be
`REQUEST_EVIDENCE`**.

## Tools & data (`server/datastore.ts`)

Each case is split into slices the agent must fetch individually, so multi-step tool use is real:
`get_alert`, `get_customer_profile`, `get_transaction_history`, `get_wallet_intelligence`,
`get_travel_rule_payload`, `search_policy` (honest lexical keyword match — not semantic),
`search_prior_cases`, and the terminal `submit_decision`. All data is synthetic
(`lib/demo-cases.ts`, `lib/evaluation-cases.ts`); the policy corpus is `lib/policy.ts`.

## SSE, recordings & replay (`server/agent-server.ts`)

- `POST /api/run/:caseId` streams orchestrator events and persists the full log to `server/recordings/`.
- `POST /api/case/:caseId/evidence` applies the seeded missing Travel Rule payload — making a resumed run genuine.
- `GET /api/replay/:recordingId` re-streams a recorded run with realistic pacing, badged **RECORDED RUN** in
  the UI. Replay needs no API key — the venue-Wi-Fi fallback.

## Evaluation (`scripts/evaluate.ts`)

Runs the real orchestrator over the 20 labelled cases (labels in `lib/evaluation-labels.ts`, isolated from
runtime prompts) and writes `lib/evaluation-results.json` + `docs/EVALUATION_REPORT.md`. Non-deterministic:
results vary run to run and are reported as measured, including misses.

## Learning loop

Analyst feedback drafts a **versioned policy proposal** (`lib/evaluation.ts`) that is replayed
deterministically against the labelled set and gated behind human approval. It never mutates active policy,
prompts, thresholds, or allowlists silently.
