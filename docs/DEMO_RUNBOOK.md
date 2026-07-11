# CaseFlow — 60-second live demo

Target: 55–60 seconds. **Reset immediately before presenting** (`↻ Reset demo`). Use the default `CF-003`
incomplete Travel Rule alert.

**Live vs. replay:** with `LLM_API_KEY` set and `npm run agent` running, leave **Replay mode OFF** for a
genuine live run (~40–70 s per run — practise the pacing, or narrate over the streaming activity). On
unreliable Wi-Fi or with no key, tick **Replay mode**: the identical click path streams a recorded run,
badged **RECORDED RUN**. Everything below works in both modes.

## Click path and narration

### 0–8 s — Goal
Point to the analyst goal:

> “CaseFlow starts after an alert. The analyst’s job is a defensible next action — not blindly trusting a vendor score. All data here is synthetic.”

### 8–28 s — Plan and tools (live agent activity)
Click **Run CaseFlow** (or **Replay recorded run**). Point at the streaming **LIVE AGENT ACTIVITY** panel:

> “A live LLM analyst plans, then calls tools — it fetches the customer profile, transaction, wallet
> intelligence and the Travel Rule payload, and searches policy. Every tool call has real arguments and a
> real hashed, timestamped audit event.”

### 28–40 s — Adversarial challenge + safe stop
Point at the **Compliance Challenger** verifying, then the `REQUEST_EVIDENCE` packet and `TR-1.2`:

> “A second LLM — the Compliance Challenger — attacks the conclusion. Beneficiary identity and VASP are
> missing, so under TR-1.2 no decision can be sealed. A deterministic guardrail guarantees an incomplete
> Travel Rule payload can only be REQUEST_EVIDENCE. CaseFlow names exactly what’s missing.”

### 40–50 s — Resume the same case
Click **Add seeded evidence & resume**:

> “I add the synthetic beneficiary payload and resume the same case — no lost audit trail. The agent
> re-investigates with the now-complete evidence.”

### 50–60 s — Decision packet
Point at `ESCALATE`, the citations, and the analyst-ready narrative:

> “Now minimum evidence is complete, but a residency contradiction remains — so under KYC-2.4 the agent
> recommends ESCALATE, with confidence, cited clauses, evidence IDs, and a drafted narrative. It’s a
> recommendation: the analyst accepts, overrides with a reason, or requests more evidence.”

### Optional +10 s — Governed learning
Click **Accept recommendation** → Policy proposal tab:

> “Analyst feedback drafts a versioned policy proposal and replays it against the labelled set. It cannot
> activate policy — a human owns that gate.”

## Recovery paths

- Wrong state → **Reset demo**.
- Live run too slow / network flaky → tick **Replay mode** and re-run the identical path.
- Button clicked early → **Run again**.
- No `LLM_API_KEY` at all → Replay mode still works from committed recordings.

## What not to say

- Not “the system cleared the customer / filed / escalated.” It **recommended** a disposition for human review.
- No production accuracy, false-positive reduction, time-savings, ROI, or compliance claims.
- If citing results: “on the labelled synthetic cases in the current harness (measured — see EVALUATION_REPORT.md).”
