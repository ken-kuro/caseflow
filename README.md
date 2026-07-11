# CaseFlow

An **agentic AML/KYT alert-resolution workspace** for GoTyme analysts (AABW — Financial Services II, GoTymeX track).

CaseFlow begins where monitoring ends: at an alert. A live LLM agent plans, calls tools to gather
evidence, retrieves and cites policy, and proposes exactly one disposition — `CLEAR`, `ESCALATE`, or
`REQUEST_EVIDENCE`. A second LLM role (the **Compliance Challenger**) adversarially reviews the
conclusion. A **deterministic orchestrator** governs the whole thing: typed contracts, a two-round
critique cap, and hard evidence gates decide what can be sealed. Every audit event carries a real
timestamp and a real SHA-256 hash of its actual input/output.

> **Non-deterministic reasoning inside deterministic governance** — the LLM plans, investigates, and
> argues; typed contracts, round limits, and hard evidence gates decide what can be sealed.

All data is **synthetic**. CaseFlow produces **recommendations only** — it never files a report, freezes
funds, clears a customer, or activates policy without a human.

**Live hosted demo (no login, no key):** https://ken-kuro.github.io/caseflow/ — replays genuine recorded
agent runs client-side, badged "RECORDED RUN". For a live agent run, follow the Quickstart below.

## Architecture

- `server/agent-loop.ts` — generic OpenAI-compatible streaming tool-use loop (fetch + hand-rolled SSE).
- `server/datastore.ts` — tool-shaped synthetic data (`get_alert`, `get_customer_profile`,
  `get_transaction_history`, `get_wallet_intelligence`, `get_travel_rule_payload`, `search_policy`,
  `search_prior_cases`, `submit_decision`).
- `server/orchestrator.ts` — deterministic governance: Triage agent → Compliance Challenger → bounded
  revision (max 2 critique rounds) → `validatePacket` guardrails → seal or a labelled `AGENT_FAILURE`
  (never a fabricated packet).
- `server/guardrails.ts` — deterministic packet validation + the hard-stop that an INCOMPLETE Travel Rule
  payload can only be `REQUEST_EVIDENCE`.
- `server/agent-server.ts` — `node:http` sidecar: SSE run endpoint, evidence-resume, replay of recorded runs.
- `app/CaseFlowApp.tsx` — analyst UI that streams the live agent activity, assembles the decision packet,
  and supports human review + a governed policy-proposal loop.

## Quickstart

Requirements: **Node ≥ 22.13** (Node 25 runs the `.ts` sidecar directly). No extra npm dependencies.

1. Create `.env.local` (git-ignored):
   ```
   LLM_BASE_URL=https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
   LLM_API_KEY=sk-...
   LLM_MODEL=qwen3.7-plus
   ```
2. Start the agent runtime (sidecar on :8788):
   ```
   npm run agent
   ```
3. In another terminal, start the UI (Vite proxies `/api` → :8788):
   ```
   npm run dev
   ```
   Open the printed URL (e.g. http://localhost:3001).

### Replay mode — no API key needed

The agent server records every live run to `server/recordings/`. Tick **Replay mode** in the UI (or hit
`GET /api/replay/<recordingId>`) to re-stream a recorded run with realistic pacing, badged **RECORDED RUN**.
This is the venue-Wi-Fi / no-key fallback: the demo streams from committed recordings even with no
`LLM_API_KEY` set.

## Evaluation

```
npm run evaluate      # runs the real orchestrator over the 20 labelled cases → docs/EVALUATION_REPORT.md
```

Labels live in `lib/evaluation-labels.ts`, isolated from runtime prompts. Numbers are measured, not
asserted — see [docs/EVALUATION_REPORT.md](docs/EVALUATION_REPORT.md).

## Tests

```
npm test              # guardrail unit tests + build + server-rendered HTML test
```

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the agent loop, roles, orchestrator, and guardrails fit together.
- [docs/EVALUATION_REPORT.md](docs/EVALUATION_REPORT.md) — measured results over the labelled synthetic cases.
- [docs/DEMO_RUNBOOK.md](docs/DEMO_RUNBOOK.md) — the 60-second live-demo click path.
- [AGENTS.md](AGENTS.md) — product and engineering rules. [HANDOFF.md](HANDOFF.md) — remaining human steps.

## Built with

TypeScript · React 19 · vinext/Vite · Node.js · **Qwen (`qwen3.7-plus`) via Alibaba Cloud Model Studio
(OpenAI-compatible API)** · Cloudflare Workers (deployment) · synthetic JSON fixtures.

Coding assistants were used during development; the product is the agent runtime, not how the code was typed.
