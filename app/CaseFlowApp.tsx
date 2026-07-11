"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaseInput, DecisionPacket, Disposition, PolicyProposal, ReviewFeedback } from "../lib/contracts";
import { cloneDemoCases } from "../lib/demo-cases";
import { proposePolicyChange } from "../lib/evaluation";
import { getClause } from "../lib/policy";
import evaluationResults from "../lib/evaluation-results.json";

type View = "review" | "evaluation" | "proposal";
type RunMode = "live" | "replay";

const dispositionLabel: Record<Disposition, string> = {
  CLEAR: "Clear",
  ESCALATE: "Escalate",
  REQUEST_EVIDENCE: "Request evidence",
};

// One activity item in the live agent feed.
interface ThinkingItem { kind: "thinking"; key: string; role: string; text: string }
interface ToolItem { kind: "tool"; key: string; role: string; tool: string; args: unknown; summary?: string; status?: string; timestamp?: string }
interface RoleItem { kind: "role"; key: string; role: string; note: string }
interface ObjectionItem { kind: "objection"; key: string; severity: string; claim: string; evidenceNeeded: string[] }
interface ApprovalItem { kind: "approval"; key: string; note: string }
interface RevisionItem { kind: "revision"; key: string; round: number; note: string }
interface GuardrailItem { kind: "guardrail"; key: string; ok: boolean; errors: string[]; note: string }
interface FailureItem { kind: "failure"; key: string; reason: string }
type Activity = ThinkingItem | ToolItem | RoleItem | ObjectionItem | ApprovalItem | RevisionItem | GuardrailItem | FailureItem;

const roleIcon: Record<string, string> = {
  Triage: "◎",
  "Compliance Challenger": "⚔",
  Orchestrator: "▣",
};

function formatAmount(input: CaseInput): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: input.transaction.currency, maximumFractionDigits: 0 }).format(input.transaction.amount);
}

function downloadPacket(packet: DecisionPacket): void {
  const blob = new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${packet.caseId}-decision-packet.json`;
  link.click();
  URL.revokeObjectURL(url);
}

// Parse a fetch SSE stream, calling onEvent for each `data:` JSON payload.
async function consumeSse(response: Response, onEvent: (e: any) => void): Promise<void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data) continue;
      try { onEvent(JSON.parse(data)); } catch { /* ignore keepalives */ }
    }
  }
}

export default function CaseFlowApp() {
  const [cases, setCases] = useState<CaseInput[]>(() => cloneDemoCases());
  const [selectedId, setSelectedId] = useState("CF-003");
  const [activity, setActivity] = useState<Activity[]>([]);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<RunMode | null>(null);
  const [packet, setPacket] = useState<DecisionPacket | null>(null);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [replayMode, setReplayMode] = useState(false);
  const [view, setView] = useState<View>("review");
  const [reviewReason, setReviewReason] = useState("Evidence and cited policy support the recommendation.");
  const [correctedLabel, setCorrectedLabel] = useState<Disposition>("ESCALATE");
  const [feedback, setFeedback] = useState<ReviewFeedback | null>(null);
  const [proposal, setProposal] = useState<PolicyProposal | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const activityRef = useRef<HTMLDivElement>(null);
  const turnRef = useRef(0);

  const selectedCase = useMemo(() => cases.find((item) => item.id === selectedId) ?? cases[0], [cases, selectedId]);
  const evalMeta = evaluationResults as any;

  function flash(message: string): void {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }

  useEffect(() => {
    if (activityRef.current) activityRef.current.scrollTop = activityRef.current.scrollHeight;
  }, [activity]);

  const applyEvent = useCallback((e: any) => {
    switch (e.type) {
      case "mode":
        setMode(e.mode);
        break;
      case "role_start":
        turnRef.current += 1;
        setActivity((a) => [...a, { kind: "role", key: `role-${a.length}`, role: e.role, note: e.note }]);
        break;
      case "thinking":
        setActivity((a) => {
          const last = a[a.length - 1];
          if (last && last.kind === "thinking" && last.role === e.role) {
            const copy = a.slice();
            copy[copy.length - 1] = { ...last, text: last.text + e.text };
            return copy;
          }
          return [...a, { kind: "thinking", key: `think-${a.length}-${turnRef.current}`, role: e.role, text: e.text }];
        });
        break;
      case "tool_call":
        setActivity((a) => [...a, { kind: "tool", key: e.id || `tool-${a.length}`, role: e.role, tool: e.tool, args: e.args, status: "running", timestamp: e.timestamp }]);
        break;
      case "tool_result":
        setActivity((a) => a.map((item) => (item.kind === "tool" && item.key === e.id ? { ...item, summary: e.summary, status: e.status } : item)));
        break;
      case "objection":
        setActivity((a) => [...a, { kind: "objection", key: `obj-${a.length}`, severity: e.severity, claim: e.claim, evidenceNeeded: e.evidenceNeeded }]);
        break;
      case "approval":
        setActivity((a) => [...a, { kind: "approval", key: `appr-${a.length}`, note: e.note }]);
        break;
      case "revision":
        setActivity((a) => [...a, { kind: "revision", key: `rev-${a.length}`, round: e.round, note: e.note }]);
        break;
      case "guardrail":
        setActivity((a) => [...a, { kind: "guardrail", key: `guard-${a.length}`, ok: e.ok, errors: e.errors, note: e.note }]);
        break;
      case "decision":
        setPacket(e.packet as DecisionPacket);
        break;
      case "agent_failure":
        setFailureReason(e.reason);
        setActivity((a) => [...a, { kind: "failure", key: `fail-${a.length}`, reason: e.reason }]);
        break;
      case "run_complete":
        setRunStatus(e.status);
        break;
      default:
        break;
    }
  }, []);

  const startStream = useCallback(async (response: Response) => {
    setActivity([]);
    setPacket(null);
    setRunStatus(null);
    setFailureReason(null);
    setFeedback(null);
    setProposal(null);
    setView("review");
    setRunning(true);
    turnRef.current = 0;
    try {
      if (!response.ok || !response.body) throw new Error(`stream failed (${response.status})`);
      await consumeSse(response, applyEvent);
    } catch (err) {
      setFailureReason(`Stream error: ${String(err)}. Is the agent server running (npm run agent)? Toggle Replay mode to use a recorded run.`);
      setActivity((a) => [...a, { kind: "failure", key: `fail-${a.length}`, reason: String(err) }]);
    } finally {
      setRunning(false);
    }
  }, [applyEvent]);

  const runLive = useCallback(async (caseId: string) => {
    flash("Live agent run started");
    const res = await fetch(`/api/run/${caseId}`, { method: "POST" }).catch((err) => { throw err; });
    await startStream(res);
  }, [startStream]);

  const runReplay = useCallback(async (caseId: string, runIndex = 0) => {
    const list = await fetch("/api/recordings").then((r) => r.json()).catch(() => ({ recordings: [] }));
    const matches = (list.recordings ?? [])
      .filter((r: any) => r.caseId === caseId)
      .sort((a: any, b: any) => a.recordingId.localeCompare(b.recordingId, undefined, { numeric: true }));
    const pick = matches[Math.min(runIndex, matches.length - 1)];
    if (!pick) { flash("No recorded run for this case yet"); return; }
    flash(`Replaying recorded run ${pick.recordingId}`);
    const res = await fetch(`/api/replay/${pick.recordingId}`);
    await startStream(res);
  }, [startStream]);

  const run = useCallback(() => {
    if (running) return;
    (replayMode ? runReplay(selectedCase.id) : runLive(selectedCase.id)).catch((err) => {
      setFailureReason(String(err));
      setRunning(false);
    });
  }, [running, replayMode, runReplay, runLive, selectedCase.id]);

  function selectCase(id: string): void {
    setSelectedId(id);
    setActivity([]);
    setPacket(null);
    setRunStatus(null);
    setFeedback(null);
    setProposal(null);
    setMode(null);
    setView("review");
  }

  async function supplyEvidenceAndResume(): Promise<void> {
    if (replayMode) {
      flash("Replay mode: resuming from recorded run 2");
      await runReplay(selectedCase.id, 1);
      return;
    }
    const resp = await fetch(`/api/case/${selectedCase.id}/evidence`, { method: "POST" }).then((r) => r.json()).catch(() => null);
    if (resp?.ok) {
      setCases((current) => current.map((item) => (item.id === resp.caseId ? { ...item, status: "READY", travelRule: { ...item.travelRule, ...resp.travelRule } } : item)));
      flash("Evidence added · resuming same case");
      await runLive(selectedCase.id);
    } else {
      flash("Could not apply evidence (is the agent server running?)");
    }
  }

  function recordReview(action: ReviewFeedback["action"]): void {
    if (!packet) return;
    if (!reviewReason.trim()) { flash("A review reason is required"); return; }
    const item: ReviewFeedback = {
      caseId: packet.caseId,
      action,
      reason: reviewReason.trim(),
      correctedLabel: action === "OVERRIDE" ? correctedLabel : null,
      timestamp: new Date().toISOString(),
    };
    setFeedback(item);
    setPacket({ ...packet, humanDisposition: action === "ACCEPT" ? "ACCEPTED" : action === "OVERRIDE" ? "OVERRIDDEN" : "EVIDENCE_REQUESTED", overrideReason: action === "OVERRIDE" ? reviewReason.trim() : null });
    setProposal(proposePolicyChange(item));
    setView("proposal");
    flash("Human disposition recorded · draft proposal created");
  }

  function reset(): void {
    fetch("/api/reset", { method: "POST" }).catch(() => {});
    setCases(cloneDemoCases());
    setSelectedId("CF-003");
    setActivity([]);
    setPacket(null);
    setRunStatus(null);
    setMode(null);
    setFeedback(null);
    setProposal(null);
    setView("review");
    setReviewReason("Evidence and cited policy support the recommendation.");
    flash("Demo reset complete");
  }

  const m = evalMeta.metrics ?? {};
  const measured = evalMeta.status === "MEASURED";

  return (
    <main className="app-shell">
      {toast && <div className="toast" role="status">{toast}</div>}
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">CF</div>
          <div><strong>CaseFlow</strong><span>Analyst workspace</span></div>
        </div>
        <nav aria-label="Primary">
          <button className="nav-item active"><span className="nav-icon">⌁</span> Alert queue <span className="count">3</span></button>
          <button className="nav-item" onClick={() => setView("evaluation")}><span className="nav-icon">▥</span> Evaluation</button>
          <button className="nav-item" onClick={() => setView("proposal")}><span className="nav-icon">◇</span> Policy proposals</button>
        </nav>
        <div className="sidebar-section-label">Active alerts</div>
        <div className="case-list">
          {cases.map((item) => (
            <button key={item.id} className={`case-item ${item.id === selectedId ? "selected" : ""}`} onClick={() => selectCase(item.id)}>
              <span className={`risk-dot risk-${item.customer.riskTier.toLowerCase()}`} />
              <span><strong>{item.id}</strong><small>{item.title}</small></span>
              <span className="score">{item.vendorScore}</span>
            </button>
          ))}
        </div>
        <div className="synthetic-note"><span>✓</span><div><strong>Synthetic workspace</strong><small>No customer or production data</small></div></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="breadcrumb"><span>Alert queue</span><b>/</b><strong>{selectedCase.id}</strong></div>
          <div className="top-actions">
            <label className="replay-toggle" title="Replay a recorded run — works without an API key">
              <input type="checkbox" checked={replayMode} onChange={(e) => setReplayMode(e.target.checked)} /> Replay mode
            </label>
            <span className="policy-pill">Policy v2026.07</span>
            <button className="ghost-button" onClick={reset}>↻ Reset demo</button>
          </div>
        </header>

        <div className="case-header">
          <div>
            <div className="eyebrow-row"><span className={`status-chip status-${selectedCase.status.toLowerCase()}`}>{selectedCase.status}</span><span>{selectedCase.alertType.replaceAll("_", " ")}</span><span>Opened 11 Jul 2026</span></div>
            <h1>{selectedCase.title}</h1>
            <p>{selectedCase.id} · {selectedCase.customer.syntheticName} · {formatAmount(selectedCase)} · {selectedCase.transaction.corridor}</p>
          </div>
          <div className="header-score"><span>Vendor signal</span><strong>{selectedCase.vendorScore}</strong><small>Input only—not a decision</small></div>
        </div>

        <div className="goal-strip">
          <div className="goal-icon">◎</div>
          <div><span>ANALYST GOAL</span><strong>Resolve this alert with complete evidence, cited policy, and a defensible next action.</strong></div>
          <button className="primary-button" onClick={run} disabled={running}>{running ? "Agent running…" : packet ? "Run again" : replayMode ? "Replay recorded run" : "Run CaseFlow"}<span>→</span></button>
        </div>

        <div className="view-tabs" role="tablist">
          <button className={view === "review" ? "active" : ""} onClick={() => setView("review")}>Case review</button>
          <button className={view === "evaluation" ? "active" : ""} onClick={() => setView("evaluation")}>Measured evaluation</button>
          <button className={view === "proposal" ? "active" : ""} onClick={() => setView("proposal")}>Policy proposal {proposal && <span className="tab-dot" />}</button>
        </div>

        {view === "review" && (
          <div className="review-grid">
            <section className="panel timeline-panel">
              <div className="panel-heading">
                <div><span className="kicker">LIVE AGENT ACTIVITY</span><h2>Plan · tools · challenge</h2></div>
                {mode ? <span className={`run-badge ${mode}`}>{mode === "live" ? (running ? "● LIVE" : "● LIVE (done)") : "▶ RECORDED RUN"}</span> : <span className="bounded">≤ 2 critique rounds</span>}
              </div>
              {activity.length === 0 ? (
                <div className="empty-state"><div className="empty-glyph">⌁</div><h3>Ready for a live agent run</h3><p>An LLM analyst will call tools to gather evidence, retrieve and cite policy, and a second LLM challenger will attack the conclusion — governed by deterministic guardrails.</p><button className="secondary-button" onClick={run} disabled={running}>{replayMode ? "Replay recorded run" : "Run CaseFlow"}</button></div>
              ) : (
                <div className="activity-list" ref={activityRef}>
                  {activity.map((item) => <ActivityRow key={item.key} item={item} />)}
                  {running && <div className="activity-cursor"><span className="blink">▍</span> agent working…</div>}
                </div>
              )}
            </section>

            <section className="panel decision-panel">
              {!packet ? (
                runStatus === "AGENT_FAILURE" || failureReason ? (
                  <div className="packet-placeholder failure-state"><span>AGENT FAILURE — NO PACKET SEALED</span><div className="fail-glyph">⚠</div><p>{failureReason ?? "The agent could not produce a decision that passed deterministic guardrails. No packet was fabricated."}</p></div>
                ) : (
                  <div className="packet-placeholder"><span>DECISION PACKET</span><div className="paper-lines" /><p>The cited recommendation will assemble here once the agent submits and the challenger clears it.</p></div>
                )
              ) : (
                <>
                  <div className={`decision-hero disposition-${packet.recommendation.toLowerCase()}`}>
                    <div><span>CASEFLOW RECOMMENDATION</span><h2>{dispositionLabel[packet.recommendation]}</h2><p>Recommendation only · human review required</p></div>
                    <div className="confidence"><strong>{Math.round(packet.confidence * 100)}%</strong><span>confidence</span></div>
                  </div>
                  <div className="packet-scroll">
                    <section className="packet-section"><h3>Why this recommendation</h3><p>{packet.rationale}</p></section>
                    <section className="packet-section">
                      <h3>Policy citations <span>{packet.policyVersion}</span></h3>
                      <div className="citation-list">
                        {packet.citations.map((citation) => { let clause; try { clause = getClause(citation.clauseId); } catch { return <div key={citation.clauseId} className="citation"><p>{citation.clauseId} — {citation.reason}</p></div>; } return (
                          <details key={citation.clauseId} className="citation"><summary><span>{citation.clauseId}</span><strong>{clause.title}</strong><b>⌄</b></summary><p>{clause.text}</p><small>{citation.reason}</small></details>
                        ); })}
                      </div>
                    </section>
                    {packet.suspectedTypology && <section className="packet-section"><h3>Suspected typology</h3><p>{packet.suspectedTypology}</p></section>}
                    {packet.objections.map((objection) => (
                      <section className={`objection ${objection.resolution.toLowerCase()}`} key={objection.id}><div><span>{objection.resolution === "UNRESOLVED" ? `CHALLENGER BLOCK · ${objection.severity}` : `CHALLENGE ${objection.severity} · RESOLVED`}</span><strong>{objection.claimChallenged}</strong></div><p>{objection.evidenceNeeded.length ? `Needed: ${objection.evidenceNeeded.join(", ")}` : "Verified against evidence and citations."}</p></section>
                    ))}
                    {packet.missingEvidence.length > 0 && (
                      <section className="packet-section missing"><h3>Missing evidence</h3>{packet.missingEvidence.map((item) => <div key={item}><span>○</span>{item}</div>)}<button className="primary-button full" onClick={() => supplyEvidenceAndResume()} disabled={running}>Add seeded evidence & resume <span>→</span></button></section>
                    )}
                    {packet.escalationNarrative && <section className="packet-section narrative"><h3>Analyst-ready narrative <span>DRAFT</span></h3><p>{packet.escalationNarrative}</p></section>}
                    <section className="packet-section evidence"><h3>Evidence IDs</h3><div>{packet.evidence.map((item) => <span key={item.id}>{item.id} · {item.label}</span>)}</div></section>
                    <section className="packet-section"><h3>Audit trace <span>{packet.trace.length} events · SHA-256</span></h3><div className="audit-mini">{packet.trace.slice(0, 6).map((t) => <div key={t.id}><code>{t.tool}</code><small>{t.outputHash.slice(0, 12)}…</small></div>)}<small className="audit-note">{packet.trace.length} real timestamped, hashed events in the downloaded packet.</small></div></section>
                    <section className="next-action"><span>NEXT ACTION</span><p>{packet.nextAction}</p></section>
                  </div>
                  <div className="review-footer">
                    <label>Review reason<input value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} /></label>
                    <div className="review-controls">
                      <button className="icon-button" title="Download JSON decision packet" onClick={() => downloadPacket(packet)}>⇩ JSON</button>
                      <button className="secondary-button" onClick={() => recordReview("REQUEST_EVIDENCE")}>Request evidence</button>
                      <select aria-label="Corrected disposition" value={correctedLabel} onChange={(event) => setCorrectedLabel(event.target.value as Disposition)}>{Object.keys(dispositionLabel).map((value) => <option key={value}>{value}</option>)}</select>
                      <button className="secondary-button" onClick={() => recordReview("OVERRIDE")}>Override</button>
                      <button className="primary-button" onClick={() => recordReview("ACCEPT")}>Accept recommendation</button>
                    </div>
                  </div>
                </>
              )}
            </section>
          </div>
        )}

        {view === "evaluation" && (
          <section className="evaluation-view">
            <div className="section-title-row"><div><span className="kicker">REPEATABLE HARNESS</span><h2>Measured on labelled synthetic cases</h2><p>Expected labels live outside runtime prompts. Numbers are generated by running the real agent orchestrator over the labelled set.</p></div></div>
            {!measured ? <div className="eval-empty"><strong>No metrics claimed yet.</strong><p>Run <code>npm run evaluate</code> to execute the live agent runtime over the labelled cases and populate measured disposition, citation, missing-evidence, unsupported-claim, and timing numbers.</p></div> : (
              <>
                <div className="metric-grid">
                  <div><span>Disposition agreement</span><strong>{Math.round(m.dispositionAgreement * 100)}%</strong><small>{evalMeta.caseCount} labelled cases</small></div>
                  <div><span>Policy-citation recall</span><strong>{Math.round(m.policyCitationRecall * 100)}%</strong><small>Required clauses matched</small></div>
                  <div><span>Request-evidence recall</span><strong>{Math.round(m.requestEvidenceRecall * 100)}%</strong><small>Incomplete cases only</small></div>
                  <div><span>Unsupported claims</span><strong>{m.unsupportedClaimCount}</strong><small>Harness rule count</small></div>
                  <div><span>Median run time</span><strong>{(m.medianWorkflowMs / 1000).toFixed(1)}s</strong><small>Live agent, {evalMeta.model}</small></div>
                </div>
                <div className="measurement-note"><span>✓</span><p><strong>Measured, not asserted.</strong> Generated {evalMeta.generatedAt ? new Date(evalMeta.generatedAt).toLocaleString() : ""} from the live agent runtime (model {evalMeta.model}, temp {evalMeta.temperature}). Challenger blocked {m.challengerBlockedRuns} run(s). Synthetic results do not imply production accuracy or time savings.</p></div>
                {Array.isArray(evalMeta.perCase) && evalMeta.perCase.length > 0 && (
                  <div className="percase-table">
                    <div className="percase-row percase-head"><span>Case</span><span>Expected</span><span>Agent</span><span>Cites</span><span>Result</span></div>
                    {evalMeta.perCase.map((r: any) => (
                      <div className={`percase-row ${r.pass ? "pass" : "miss"}`} key={r.caseId}><span>{r.caseId}</span><span>{r.expected}</span><span>{r.actual}</span><span>{r.citationOk ? "✓" : "—"}</span><span>{r.pass ? "PASS" : "MISS"}</span></div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {view === "proposal" && (
          <section className="proposal-view">
            {!proposal ? <div className="eval-empty"><strong>No proposal yet.</strong><p>Record an analyst disposition on a completed packet. Feedback creates a draft—it never mutates active policy.</p><button className="secondary-button" onClick={() => setView("review")}>Return to case review</button></div> : (
              <>
                <div className="section-title-row"><div><span className="kicker">SAFE LEARNING LOOP</span><h2>{proposal.title}</h2><p>{proposal.id} · sourced from {proposal.sourceCases.join(", ")}</p></div><span className={`approval-badge state-${proposal.approvalState.toLowerCase()}`}>● {proposal.approvalState === "AWAITING_APPROVAL" ? "Awaiting human approval" : proposal.approvalState === "APPROVED" ? "Human approval recorded" : "Rejected"}</span></div>
                <div className="proposal-grid">
                  <div className="panel diff-card"><h3>Human-readable policy diff</h3><div className="version-row"><span>Active {proposal.fromVersion}</span><span>Draft {proposal.proposedVersion}</span></div><div className="diff-line removed"><b>−</b><p>{proposal.diff.before}</p></div><div className="diff-line added"><b>+</b><p>{proposal.diff.after}</p></div><small>Draft only · active policy remains unchanged</small></div>
                  <div className="panel replay-card"><h3>Historical replay</h3><div className="replay-number"><strong>{proposal.replay.cases}</strong><span>labelled synthetic cases</span></div><div className="replay-row"><span>Changed outcomes</span><strong>{proposal.replay.changedOutcomes}</strong></div><div className="replay-row"><span>Regressions</span><strong>{proposal.replay.regressions}</strong></div><div className="replay-row"><span>Agreement delta</span><strong>{proposal.replay.dispositionAgreementDelta.toFixed(1)} pp</strong></div><p>Replay is deterministic against isolated expected labels. No threshold, prompt, allowlist, or policy has changed.</p></div>
                </div>
                <div className="approval-gate"><div className="gate-icon">◇</div><div><span>HUMAN ACTIVATION GATE</span><strong>{proposal.approvalState === "AWAITING_APPROVAL" ? "Compliance owner approval is mandatory" : `Proposal ${proposal.approvalState.toLowerCase()}`}</strong><p>CaseFlow can prepare and replay this proposal. Active policy remains v{proposal.fromVersion}; activation is a separate controlled deployment step.</p></div><button className="secondary-button" disabled={proposal.approvalState !== "AWAITING_APPROVAL"} onClick={() => { setProposal({ ...proposal, approvalState: "REJECTED" }); flash("Proposal rejected · active policy unchanged"); }}>Reject</button><button className="primary-button" disabled={proposal.approvalState !== "AWAITING_APPROVAL"} onClick={() => { setProposal({ ...proposal, approvalState: "APPROVED" }); flash("Human approval recorded · activation remains a controlled deployment step"); }}>Approve proposal</button></div>
                {feedback && <p className="feedback-record">Audit record: {feedback.action} by Analyst · reason “{feedback.reason}”</p>}
              </>
            )}
          </section>
        )}
      </section>
    </main>
  );
}

function ActivityRow({ item }: { item: Activity }) {
  if (item.kind === "role") {
    return <div className="act-role"><span className="act-role-icon">{roleIcon[item.role] ?? "•"}</span><strong>{item.role}</strong><em>{item.note}</em></div>;
  }
  if (item.kind === "thinking") {
    return <div className="act-thinking"><p>{item.text}</p></div>;
  }
  if (item.kind === "tool") {
    const argStr = (() => { try { return JSON.stringify(item.args); } catch { return "{}"; } })();
    return (
      <div className={`act-tool ${item.status === "running" ? "running" : item.status === "BLOCKED" ? "blocked" : "done"}`}>
        <span className="act-tool-badge">TOOL</span>
        <code>{item.tool}</code>
        <span className="act-tool-args">{argStr.length > 90 ? argStr.slice(0, 90) + "…" : argStr}</span>
        {item.summary ? <span className="act-tool-result">→ {item.summary}</span> : <span className="act-tool-result pending">running…</span>}
      </div>
    );
  }
  if (item.kind === "objection") {
    return <div className={`act-objection sev-${item.severity.toLowerCase()}`}><span>CHALLENGER · {item.severity}{item.severity === "HIGH" ? " · BLOCKS" : ""}</span><strong>{item.claim}</strong>{item.evidenceNeeded.length > 0 && <p>Evidence needed: {item.evidenceNeeded.join(", ")}</p>}</div>;
  }
  if (item.kind === "approval") {
    return <div className="act-approval"><span>CHALLENGER · APPROVED</span><p>{item.note}</p></div>;
  }
  if (item.kind === "revision") {
    return <div className="act-revision"><span>ORCHESTRATOR · REVISION ROUND {item.round}</span><p>{item.note}</p></div>;
  }
  if (item.kind === "guardrail") {
    return <div className={`act-guardrail ${item.ok ? "ok" : "fail"}`}><span>DETERMINISTIC GUARDRAIL · {item.ok ? "PASS" : "BLOCKED"}</span><p>{item.ok ? item.note : item.errors.join(" ")}</p></div>;
  }
  if (item.kind === "failure") {
    return <div className="act-failure"><span>AGENT FAILURE</span><p>{item.reason}</p></div>;
  }
  return null;
}
