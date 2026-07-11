# CaseFlow — Five-minute Pitch

Target duration: 4:45, leaving 15 seconds of safety. Open with the problem, let the demo carry the
architecture, end on the decision packet and human-gated learning.

## Slide 1 — Team and promise (0:00–0:20)

“We built CaseFlow for GoTyme's AML/KYT analysts. It turns an existing risk alert into an evidence-backed,
policy-cited decision packet — and it knows when *not* to decide.”

## Slide 2 — Problem insight (0:20–1:00)

“The problem isn't a lack of alerts — risk tools already generate scores. The workflow breaks *after* the
alert: analysts reconstruct customer, transaction, wallet, Travel Rule, policy, and prior-case evidence by
hand. False positives create workload; opaque automation creates regulatory risk. The opportunity is faster
resolution without sacrificing defensibility.”

## Slide 3 — The agent runtime (1:00–1:45)

“CaseFlow's runtime is a real agent. A live LLM plans, then calls tools — customer profile, transaction,
wallet intelligence, Travel Rule payload, policy search — and submits a disposition. A second LLM, the
Compliance Challenger, independently attacks that decision. A deterministic orchestrator governs it all: typed
contracts, a two-round critique cap, and hard evidence gates. Every step is a real timestamped, hashed audit
event. That's our differentiator: **non-deterministic reasoning inside deterministic governance.**”

## Slide 4 — Why this can win (1:45–2:30)

“It is not autonomous compliance — humans own every action. And learning is governed: analyst feedback becomes
a versioned policy proposal, replayed against labelled cases, gated behind human approval. Improvement is
inspectable and reversible, never a silent change.”

## Slide 5 — Live demo (2:30–3:40)

Run CF-003 (incomplete Travel Rule) — live if the key/network are good, else Replay mode.

- Watch the agent plan and call tools live.
- Challenger verifies; missing beneficiary/VASP → `REQUEST_EVIDENCE`, gaps named. (The guardrail guarantees an
  incomplete payload can't be cleared; the challenger will *block* a flawed clear — `npm run challenger:check`.)
- Add seeded evidence → same case resumes → cited `ESCALATE` with a drafted narrative.

End on the packet, not architecture.

## Slide 6 — Measured impact and close (3:40–4:45)

“We ran the *real* agent over 20 labelled synthetic cases: 90% disposition agreement, 100% policy-citation
recall, 100% request-evidence recall, and zero fabricated packets. We report the two misses honestly — a live
model won't score 20/20, and that's more credible than a script that does. These are synthetic-fixture
results, not production accuracy or time-savings claims.

CaseFlow removes the reconstruction work, makes reasoning reviewable, and turns every resolved case into a
safely testable improvement. We'd like to pilot it on GoTyme's real alert and policy schemas.”

## Q&A anchors

- **Why agents?** Conditional evidence-gathering, specialized analysis, adversarial critique, stopping, and
  resumption — not one prompt-response.
- **Is it deterministic or an LLM?** The runtime is a live LLM (Qwen via Alibaba Cloud Model Studio); the
  *governance* around it is deterministic — that's the point.
- **What's autonomous?** No regulatory or customer-impacting action. It recommends and drafts.
- **What if the model is wrong?** Typed contracts, hard evidence gates, a challenger that can block, bounded
  confidence, an honest `AGENT_FAILURE` state, and a human disposition.
- **How is it validated?** Labelled synthetic cases with isolated expected labels; measured, reported with misses.
