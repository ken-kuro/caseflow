# CaseFlow — AABW portal copy

## Team setup

- **Recommended team name:** CaseFlow
- **Team captain:** [confirm in portal]
- **Teammates:** [confirm every teammate before roster lock]
- **In-person check-in owner:** [assign one teammate]

## Track and problem

- **Track:** Financial Services II powered by GoTymeX
- **Selected problem statement:** Adaptive AML/KYT workflow engine — policy-driven alert triage that learns
- **Submission scope:** GoTyme only. Do not select or claim the AWS track.

## Project title

CaseFlow — an agentic AML/KYT alert-resolution workspace

## Elevator pitch

CaseFlow helps GoTyme AML/KYT analysts resolve existing risk alerts. A live LLM agent plans, calls tools to
gather synthetic evidence, cites policy, and proposes a disposition; a second LLM adversarially challenges it;
and deterministic guardrails decide what can be sealed. Analyst feedback becomes a versioned, replay-tested
policy proposal that cannot activate without human approval.

## About the project

### Inspiration

Financial-crime teams do not only struggle to detect risk; they struggle to resolve the alerts they already
have. Evidence is fragmented across customer records, transaction history, wallet-risk signals, Travel Rule
payloads, policy documents, and prior cases. Analysts reconstruct that context under time pressure while
preserving a rationale they can defend.

### What it does

CaseFlow starts at an existing AML/KYT alert and returns exactly one recommendation: `CLEAR`, `ESCALATE`, or
`REQUEST_EVIDENCE`. A live language-model agent investigates by calling tools — customer profile, transaction
history, wallet intelligence, Travel Rule payload, policy search, and prior-case search — then submits a
decision. A second language-model role, the Compliance Challenger, independently re-verifies the decision and
can raise a blocking objection. A deterministic orchestrator governs the exchange and produces a structured
packet: evidence IDs, policy citations, calibrated confidence, objections, missing information, the next
action, an audit trace, and an analyst-ready narrative for escalations.

CaseFlow never files a report, freezes funds, clears a customer, or activates policy. A human analyst accepts
the recommendation, overrides it with a required reason, or requests more evidence. All data is synthetic.

### How we built it

The runtime is a real agent system. A generic OpenAI-compatible tool-use loop (Node `fetch` + hand-rolled SSE
parsing, no extra dependencies) streams the model's reasoning and tool calls. The model calls typed tools
against a synthetic datastore, and the loop appends real tool results until the agent calls `submit_decision`.
A deterministic orchestrator (`server/orchestrator.ts`) runs the **Triage** agent, then the **Compliance
Challenger** (read tools plus `raise_objection`/`approve_decision`), allows a bounded revision (max two
critique rounds, enforced in code), and validates the final packet with deterministic guardrails —
including a hard-stop that an incomplete Travel Rule payload can only be `REQUEST_EVIDENCE`. If a valid packet
cannot be produced, the orchestrator emits a labelled `AGENT_FAILURE` state; it never fabricates a packet.

Every audit event carries a real `Date.toISOString()` timestamp and a real SHA-256 hash of its actual input
and output (`node:crypto`), verifiable in the downloaded decision-packet JSON. Runs stream to the analyst UI
over Server-Sent Events and are persisted as recordings, so a "Replay mode" can re-stream a genuine recorded
run with no API key — the venue-Wi-Fi fallback. Typed contracts, versioned policy clauses, and 20 labelled
synthetic cases (labels isolated from runtime prompts) round out the deterministic spine.

The model is **Qwen (`qwen3.7-plus`) via Alibaba Cloud Model Studio's OpenAI-compatible API**. The web app is
TypeScript, React 19, and vinext/Vite, with Cloudflare Workers as the deployment target.

### Challenges we ran into

Getting reliable, schema-valid decisions out of a live model was the core challenge. Tool-calling has to be
robust to streamed, partial arguments; the final packet has to satisfy a typed contract; and the model must
cite real clause IDs rather than invent them. We solved this with deterministic governance around the
non-deterministic reasoning: bounded critique rounds, a validation-retry, hard evidence gates, and an honest
`AGENT_FAILURE` path instead of a fabricated answer.

Making "learning" safe in a regulated workflow was the second challenge. Silently changing prompts, thresholds,
or allowlists would be hard to audit. CaseFlow instead converts feedback into a versioned proposal, replays it
deterministically against isolated historical labels, shows changed outcomes and regressions, and stops at a
human activation gate.

### Accomplishments we're proud of

- **A real, visible agent.** Judges watch the model plan, call tools with real arguments, and get
  independently re-verified by a second LLM — live, with real timestamps and hashes.
- **Pause and resume that works.** On the incomplete Travel Rule case (CF-003) the agent returns
  `REQUEST_EVIDENCE` and names the exact gaps (beneficiary identity, beneficiary VASP). After the seeded
  payload is added, the same case resumes to a cited `ESCALATE` — the audit trail preserved.
- **Governance that is a feature.** The deterministic guardrails demonstrably cap critique rounds and block
  invalid packets; the Compliance Challenger's blocking power is exercised in the test suite.
- **Honest, measured evaluation.** See below — reported as measured, including the misses.

### Measured evaluation

Running the **real agent orchestrator** over the 20 labelled synthetic cases (model `qwen3.7-plus`,
temperature 0.2):

- **Disposition agreement:** 90% (18/20) — two rapid-movement cases were cleared where the label expects
  escalate; reported honestly, not hidden.
- **Policy-citation recall:** 100% (every required clause cited).
- **REQUEST_EVIDENCE recall on incomplete cases:** 100%.
- **Agent failures (fabricated packets):** 0.
- **Median run time:** ~83 s per fully-governed run (two LLM roles + guardrails).

These are fixture-scoped synthetic results. They do **not** imply production accuracy, false-positive
reduction, analyst time savings, or ROI. Full table: `EVALUATION_REPORT.md`.

### What we learned

In a regulated workflow, the most valuable agent behavior is often refusing to complete the task until its
evidence contract is satisfied. Non-deterministic reasoning becomes trustworthy only when deterministic
governance decides what can be sealed. Traceability, bounded autonomy, and reversible learning matter more
than adding more agents.

### What's next

A narrow GoTyme pilot using real alert and policy schemas, with every customer-impacting and regulatory action
kept human-controlled. We would tighten the rapid-movement escalation prompt (the source of the two evaluation
misses), then compare analyst handling time, override rate, citation quality, and missed-evidence rate against
the current workflow before calibrating any threshold.

## Built With tags

- TypeScript
- React 19
- vinext / Vite
- Node.js (`node:http` sidecar, global `fetch`, `node:crypto`)
- **Qwen (`qwen3.7-plus`) via Alibaba Cloud Model Studio (OpenAI-compatible API)** — the agent runtime
- Server-Sent Events (live streaming) + recorded-run replay
- Cloudflare Workers (deployment target)
- Synthetic JSON fixtures

Do not select AWS. No AWS service is used.

## Partner-tool usage explanation

CaseFlow's runtime is an LLM agent: the Triage agent and Compliance Challenger are calls to Qwen
(`qwen3.7-plus`) via Alibaba Cloud Model Studio's OpenAI-compatible API, wrapped in deterministic governance.
No customer data, bank, KYC, or sanctions integration is used — all data is synthetic. Coding assistants were
used during development to help write and test the code; they are not part of the runtime decision engine.

## Links and media

- **Demo URL:** localhost-primary (`npm run agent` + `npm run dev`). Replay mode gives a no-API-key fallback
  locally; deploy the build to Cloudflare Workers if a hosted URL is required.
- **Repository URL:** [confirm judge-accessible GitHub URL before submitting]
- **Product video:** `artifacts/video/CaseFlow_Product_Demo.mp4` (2:09)
- **Pitch deck:** `artifacts/pitch/CaseFlow_Pitch_Deck.pptx` (export a PDF from it if the venue needs one)

### Image gallery order

1. `artifacts/screenshots/01-case-and-goal.png` — alert, synthetic banner, and analyst goal
2. `artifacts/screenshots/02-live-agent-activity.png` — live agent planning and tool calls mid-run
3. `artifacts/screenshots/03-request-evidence-challenger.png` — challenger verification → `REQUEST_EVIDENCE` with named gaps
4. `artifacts/screenshots/04-resumed-escalate.png` — resumed, cited `ESCALATE` decision packet
5. `artifacts/screenshots/05-measured-evaluation.png` — measured evaluation dashboard (90% / 100% / 100%)

## Required final confirmations

- Confirm every teammate and the team captain in the portal.
- Confirm one teammate owns on-site check-in before 9:00 AM.
- Provide `LLM_API_KEY` on the demo laptop; rehearse the runbook; keep Replay mode ready as the fallback.
- Publish or grant judge access to the repository (only when the team decides to push).
- Upload the 2:09 video and paste its shareable link.
- Read and accept the official rules checkbox; choose the public-visibility checkbox.
- Reconfirm the GoTyme track and problem statement on the final portal step.
