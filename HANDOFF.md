# CaseFlow — submission handoff

Everything is prepared **locally**. No external upload, push, deploy, or portal action has been performed.
These are the remaining human steps before the AABW submission (Financial Services II, GoTymeX track).

## 1. Run it on the demo laptop

Create `.env.local` (git-ignored) with your credentials:

```
LLM_BASE_URL=https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=sk-...
LLM_MODEL=qwen3.7-plus
```

Then, in two terminals:

```
npm run agent      # agent runtime sidecar on :8788
npm run dev        # UI (proxies /api → :8788), prints the local URL
```

**Fallback:** if the key or network is unavailable, tick **Replay mode** in the UI — the demo streams the
committed recorded runs in `server/recordings/` with no key. Rehearse the click path in
[docs/DEMO_RUNBOOK.md](docs/DEMO_RUNBOOK.md).

## 2. Publish the repository

Push to a judge-accessible GitHub repo and paste the URL into the portal. Confirm it opens without
authentication and that the README commands work from a fresh clone (`node_modules` present is fine to assume).

## 3. Demo URL

Localhost-primary is recommended (`npm run agent` + `npm run dev`). If a hosted URL is required, deploy the
build to Cloudflare Workers first — do not advertise a URL that isn't running this build. Replay mode is the
no-key / bad-Wi-Fi fallback either way.

## 4. Upload the product video

`artifacts/video/CaseFlow_Product_Demo.mp4` — 2:09, 1920×1080, H.264 + AAC. Captions:
`artifacts/video/CaseFlow_Product_Demo.srt`. Upload to a judge-accessible host and test the link signed-out.
Optional: re-record the narration in a teammate's voice using
`artifacts/video/CaseFlow_Product_Demo_Narration.txt` (keep it 2–3 min); the current track is a system voice.

## 5. Upload the image gallery (in order)

1. `artifacts/screenshots/01-case-and-goal.png`
2. `artifacts/screenshots/02-live-agent-activity.png`
3. `artifacts/screenshots/03-request-evidence-challenger.png`
4. `artifacts/screenshots/04-resumed-escalate.png`
5. `artifacts/screenshots/05-measured-evaluation.png`

## 6. Present the deck

- `artifacts/pitch/CaseFlow_Pitch_Deck.pptx` (editable). Export a PDF from it if the venue needs one.
- Talk track: `artifacts/pitch/PITCH_SCRIPT.md` (five minutes, timed).
- Demo beats architecture; end on the decision packet and the human-gated learning loop.

## 7. Fill the portal

Copy from `artifacts/submission/CaseFlow_Portal_Copy.md`. Complete only team-owned fields (captain, roster,
GitHub URL, video URL, pre-existing-code disclosure, rules/visibility checkboxes, on-site check-in owner).

**Do not select AWS.** CaseFlow is a GoTyme Financial Services II submission.

## 8. On-site

One teammate owns the in-person check-in before **9:00 AM**.

---

### Already done for you

- Live agent runtime, analyst UI, deterministic guardrails, evaluation harness, and tests — all committed.
- Measured evaluation over 20 labelled synthetic cases (see [docs/EVALUATION_REPORT.md](docs/EVALUATION_REPORT.md)):
  90% disposition agreement, 100% citation recall, 100% request-evidence recall, 0 fabricated packets.
- Four recorded runs committed for Replay mode (CF-001 CLEAR, CF-002 ESCALATE, CF-003 REQUEST_EVIDENCE → resumed ESCALATE).
- Portal copy, five screenshots, the 2:09 video, and the deck — all reflecting the real product.
- `npm test` green; `npm run challenger:check` demonstrates the challenger blocking a flawed decision (needs the key).
