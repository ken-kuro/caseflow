# CaseFlow Evaluation Report

**Measured, not asserted.** These numbers come from running the real agent orchestrator
(triage LLM + compliance-challenger LLM + deterministic guardrails) over the labelled
synthetic case set. Non-deterministic reasoning means results can vary run to run.

- **Model:** qwen3.7-plus (Alibaba Cloud Model Studio, OpenAI-compatible)
- **Temperature:** 0.2
- **Run date:** 2026-07-11T22:04:35.552Z
- **Cases evaluated:** 20 of 20 labelled synthetic cases
- **Labels:** isolated in `lib/evaluation-labels.ts`, never shown to the runtime prompts

## Measured metrics

| Metric | Value |
|---|---|
| Disposition agreement | 90% |
| Policy-citation recall | 100% |
| REQUEST_EVIDENCE recall (incomplete cases) | 100% |
| Unsupported-claim count | 7 |
| Median run time | 82.6 s |
| Runs the challenger blocked / revised | 0 |
| Agent failures (no packet sealed) | 0 |

## Per-case results

| Case | Expected | Agent | Citations | Result | Time |
|---|---|---|---|---|---|
| EV-01 | CLEAR | CLEAR | ✓ | PASS | 84.2s |
| EV-02 | CLEAR | CLEAR | ✓ | PASS | 77.9s |
| EV-03 | CLEAR | CLEAR | ✓ | PASS | 81.8s |
| EV-04 | CLEAR | CLEAR | ✓ | PASS | 74.3s |
| EV-05 | CLEAR | CLEAR | ✓ | PASS | 78.0s |
| EV-06 | ESCALATE | ESCALATE | ✓ | PASS | 86.5s |
| EV-07 | ESCALATE | ESCALATE | ✓ | PASS | 97.7s |
| EV-08 | ESCALATE | ESCALATE | ✓ | PASS | 88.9s |
| EV-09 | ESCALATE | ESCALATE | ✓ | PASS | 83.3s |
| EV-10 | ESCALATE | CLEAR | ✓ | MISS | 108.0s |
| EV-11 | ESCALATE | ESCALATE | ✓ | PASS | 104.6s |
| EV-12 | ESCALATE | CLEAR | ✓ | MISS | 104.3s |
| EV-13 | REQUEST_EVIDENCE | REQUEST_EVIDENCE | ✓ | PASS | 59.0s |
| EV-14 | REQUEST_EVIDENCE | REQUEST_EVIDENCE | ✓ | PASS | 49.7s |
| EV-15 | REQUEST_EVIDENCE | REQUEST_EVIDENCE | ✓ | PASS | 60.4s |
| EV-16 | REQUEST_EVIDENCE | REQUEST_EVIDENCE | ✓ | PASS | 62.4s |
| EV-17 | REQUEST_EVIDENCE | REQUEST_EVIDENCE | ✓ | PASS | 58.7s |
| EV-18 | ESCALATE | ESCALATE | ✓ | PASS | 97.4s |
| EV-19 | ESCALATE | ESCALATE | ✓ | PASS | 73.4s |
| EV-20 | ESCALATE | ESCALATE | ✓ | PASS | 97.3s |

## Notes

- Disposition agreement below 100% is expected for a live LLM and is reported honestly rather than hidden.
- Citation recall counts whether every *required* clause appears; the agent may cite additional supporting clauses.
- The challenger and deterministic guardrails are governance, not scoring: an AGENT_FAILURE is a safe stop, never a fabricated packet.
- Synthetic results do not imply production accuracy, false-positive reduction, or time savings.
