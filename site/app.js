// CaseFlow — static hosted demo. Replays genuine recorded agent runs client-side
// (no server, no API key). Mirrors app/CaseFlowApp.tsx rendering for the review flow.

const CASES = {
  "CF-001": { id: "CF-001", title: "Known counterparty pattern", alertType: "TRAVEL_RULE", status: "NEW", riskTier: "LOW", name: "Synthetic Customer A", amount: 42000, corridor: "PH → SG", vendorScore: 24 },
  "CF-002": { id: "CF-002", title: "Rapid cross-border wallet flow", alertType: "WALLET_RISK", status: "NEW", riskTier: "HIGH", name: "Synthetic Customer B", amount: 780000, corridor: "PH → multiple", vendorScore: 91 },
  "CF-003": { id: "CF-003", title: "Incomplete Travel Rule payload", alertType: "TRAVEL_RULE", status: "PAUSED", riskTier: "MEDIUM", name: "Synthetic Customer C", amount: 265000, corridor: "PH → VN", vendorScore: 74 },
};
const ORDER = ["CF-001", "CF-002", "CF-003"];
const RUNS = { "CF-001": ["CF-001-run1"], "CF-002": ["CF-002-run1"], "CF-003": ["CF-003-run1", "CF-003-run2"] };

const POLICY = {
  "TR-1.2": { title: "Travel Rule minimum data", text: "Originator, beneficiary, and beneficiary VASP data must be present before a transfer alert can be resolved." },
  "KYT-3.1": { title: "High-risk wallet exposure", text: "High-risk wallet exposure, linked entities, or rapid onward movement requires analyst escalation with a documented fund-flow narrative." },
  "KYC-2.4": { title: "Identity contradictions", text: "Material contradictions between verified customer data and transfer data require analyst escalation once minimum evidence is complete." },
  "CLR-1.1": { title: "Explainable low-risk clearance", text: "A low-risk alert may be recommended for clearance only when required evidence is complete and no material risk indicator remains unresolved." },
  "GOV-4.2": { title: "Human-controlled policy activation", text: "A policy or threshold change requires a versioned proposal, historical replay, and explicit human approval before activation." },
};

const DISPO_LABEL = { CLEAR: "Clear", ESCALATE: "Escalate", REQUEST_EVIDENCE: "Request evidence" };
const ROLE_ICON = { "Triage": "◎", "Compliance Challenger": "⚔", "Orchestrator": "▣" };
const DELAY = { thinking: 6, tool_call: 300, tool_result: 240, objection: 420, approval: 320, revision: 380, guardrail: 320, decision: 240, role_start: 180, role_end: 100, run_start: 120, agent_failure: 380, run_complete: 120, mode: 40 };

const state = { selected: "CF-003", runIndex: 0, replaying: false };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const money = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(n);

// Tiny DOM helper.
function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  if (props) for (const k in props) {
    if (k === "class") n.className = props[k];
    else if (k === "html") n.innerHTML = props[k];
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), props[k]);
    else n.setAttribute(k, props[k]);
  }
  for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}

const root = document.getElementById("root");

function render() {
  const c = CASES[state.selected];
  const status = (state.selected === "CF-003" && state.runIndex === 1) ? "READY" : c.status;
  root.replaceChildren(
    el("main", { class: "app-shell" },
      el("aside", { class: "sidebar" },
        el("div", { class: "brand-row" }, el("div", { class: "brand-mark" }, "CF"), el("div", null, el("strong", null, "CaseFlow"), el("span", null, "Analyst workspace"))),
        el("div", { class: "sidebar-section-label" }, "Active alerts"),
        el("div", { class: "case-list" }, ORDER.map((id) => {
          const cc = CASES[id];
          return el("button", { class: "case-item " + (id === state.selected ? "selected" : ""), onclick: () => selectCase(id) },
            el("span", { class: "risk-dot risk-" + cc.riskTier.toLowerCase() }),
            el("span", null, el("strong", null, id), el("small", null, cc.title)),
            el("span", { class: "score" }, cc.vendorScore));
        })),
        el("div", { class: "synthetic-note" }, el("span", null, "✓"), el("div", null, el("strong", null, "Synthetic workspace"), el("small", null, "No customer or production data")))),
      el("section", { class: "workspace" },
        el("header", { class: "topbar" },
          el("div", { class: "breadcrumb" }, el("span", null, "Alert queue"), el("b", null, "/"), el("strong", null, c.id)),
          el("div", { class: "top-actions" }, el("span", { class: "policy-pill" }, "Policy v2026.07"))),
        el("div", { class: "case-header" },
          el("div", null,
            el("div", { class: "eyebrow-row" }, el("span", { class: "status-chip status-" + status.toLowerCase() }, status), el("span", null, c.alertType.replaceAll("_", " ")), el("span", null, "Opened 11 Jul 2026")),
            el("h1", null, c.title),
            el("p", null, `${c.id} · ${c.name} · ${money(c.amount)} · ${c.corridor}`)),
          el("div", { class: "header-score" }, el("span", null, "Vendor signal"), el("strong", null, c.vendorScore), el("small", null, "Input only—not a decision"))),
        el("div", { class: "goal-strip" },
          el("div", { class: "goal-icon" }, "◎"),
          el("div", null, el("span", null, "ANALYST GOAL"), el("strong", null, "Resolve this alert with complete evidence, cited policy, and a defensible next action.")),
          el("button", { class: "primary-button", id: "runbtn", onclick: run }, state.replaying ? "Replaying…" : "Replay recorded run", el("span", null, "→"))),
        el("div", { class: "review-grid" },
          el("section", { class: "panel timeline-panel" },
            el("div", { class: "panel-heading" }, el("div", null, el("span", { class: "kicker" }, "LIVE AGENT ACTIVITY"), el("h2", null, "Plan · tools · challenge")), el("span", { class: "run-badge replay", id: "modebadge" }, "▶ RECORDED RUN")),
            el("div", { class: "activity-list", id: "activity" },
              el("div", { class: "empty-state" }, el("div", { class: "empty-glyph" }, "⌁"), el("h3", null, "Ready to replay a recorded run"), el("p", null, "A recorded LLM analyst run: it calls tools to gather evidence, retrieves and cites policy, and a second LLM challenger reviews the conclusion — governed by deterministic guardrails."), el("button", { class: "secondary-button", onclick: run }, "Replay recorded run")))),
          el("section", { class: "panel decision-panel", id: "decision" }, placeholder())))));
}

function placeholder() {
  return el("div", { class: "packet-placeholder" }, el("span", null, "DECISION PACKET"), el("div", { class: "paper-lines" }), el("p", null, "The cited recommendation assembles here once the recorded run reaches its decision."));
}

function selectCase(id) {
  if (state.replaying) return;
  state.selected = id;
  state.runIndex = 0;
  render();
}

function run() {
  if (state.replaying) return;
  const rec = RUNS[state.selected][state.runIndex];
  replay(rec);
}

let activityEl, lastThinking;
function resetActivity() {
  activityEl = document.getElementById("activity");
  activityEl.replaceChildren();
  lastThinking = null;
  document.getElementById("decision").replaceChildren(placeholder());
}

async function replay(recordingId) {
  state.replaying = true;
  render();
  resetActivity();
  const badge = document.getElementById("modebadge");
  let rec;
  try {
    rec = await fetch(`recordings/${recordingId}.json`).then((r) => r.json());
  } catch (e) {
    activityEl.append(el("div", { class: "act-failure" }, el("span", null, "LOAD ERROR"), el("p", null, "Could not load the recording: " + e)));
    state.replaying = false; render(); return;
  }
  for (const ev of rec.events) {
    applyEvent(ev);
    activityEl.scrollTop = activityEl.scrollHeight;
    await sleep(DELAY[ev.type] ?? 120);
  }
  state.replaying = false;
  render();
  // keep the finished activity + packet visible after re-render
  restoreAfterRun(rec);
}

// After a run completes we re-render the shell (to flip the button label); replay the
// finished DOM back in by re-applying events instantly.
function restoreAfterRun(rec) {
  activityEl = document.getElementById("activity");
  activityEl.replaceChildren();
  lastThinking = null;
  for (const ev of rec.events) applyEvent(ev, true);
  document.getElementById("modebadge").textContent = "▶ RECORDED RUN (done)";
  activityEl.scrollTop = 0;
}

function applyEvent(e, instant) {
  switch (e.type) {
    case "role_start":
      lastThinking = null;
      activityEl.append(el("div", { class: "act-role" }, el("span", { class: "act-role-icon" }, ROLE_ICON[e.role] || "•"), el("strong", null, e.role), el("em", null, e.note)));
      break;
    case "thinking":
      if (lastThinking && lastThinking._role === e.role) { lastThinking._p.textContent += e.text; }
      else { const p = el("p", null, e.text); const box = el("div", { class: "act-thinking" }, p); box._role = e.role; box._p = p; lastThinking = box; activityEl.append(box); }
      break;
    case "tool_call": {
      let argStr = "{}"; try { argStr = JSON.stringify(e.args); } catch {}
      if (argStr.length > 90) argStr = argStr.slice(0, 90) + "…";
      const node = el("div", { class: "act-tool running" }, el("span", { class: "act-tool-badge" }, "TOOL"), el("code", null, e.tool), el("span", { class: "act-tool-args" }, argStr), el("span", { class: "act-tool-result pending" }, "running…"));
      node.dataset.id = e.id; activityEl.append(node); lastThinking = null;
      break;
    }
    case "tool_result": {
      const node = [...activityEl.querySelectorAll(".act-tool")].find((n) => n.dataset.id === e.id);
      if (node) { node.className = "act-tool " + (e.status === "BLOCKED" ? "blocked" : "done"); const r = node.querySelector(".act-tool-result"); r.className = "act-tool-result"; r.textContent = "→ " + e.summary; }
      break;
    }
    case "objection":
      lastThinking = null;
      activityEl.append(el("div", { class: "act-objection sev-" + e.severity.toLowerCase() }, el("span", null, `CHALLENGER · ${e.severity}${e.severity === "HIGH" ? " · BLOCKS" : ""}`), el("strong", null, e.claim), e.evidenceNeeded && e.evidenceNeeded.length ? el("p", null, "Evidence needed: " + e.evidenceNeeded.join(", ")) : null));
      break;
    case "approval":
      lastThinking = null;
      activityEl.append(el("div", { class: "act-approval" }, el("span", null, "CHALLENGER · APPROVED"), el("p", null, e.note)));
      break;
    case "revision":
      lastThinking = null;
      activityEl.append(el("div", { class: "act-revision" }, el("span", null, "ORCHESTRATOR · REVISION ROUND " + e.round), el("p", null, e.note)));
      break;
    case "guardrail":
      lastThinking = null;
      activityEl.append(el("div", { class: "act-guardrail " + (e.ok ? "ok" : "fail") }, el("span", null, "DETERMINISTIC GUARDRAIL · " + (e.ok ? "PASS" : "BLOCKED")), el("p", null, e.ok ? e.note : (e.errors || []).join(" "))));
      break;
    case "decision":
      renderPacket(e.packet);
      break;
    case "agent_failure":
      lastThinking = null;
      activityEl.append(el("div", { class: "act-failure" }, el("span", null, "AGENT FAILURE"), el("p", null, e.reason)));
      break;
    default: break;
  }
}

function renderPacket(p) {
  const panel = document.getElementById("decision");
  const sections = [];
  sections.push(el("section", { class: "packet-section" }, el("h3", null, "Why this recommendation"), el("p", null, p.rationale)));
  sections.push(el("section", { class: "packet-section" },
    el("h3", { html: `Policy citations <span>${p.policyVersion}</span>` }),
    el("div", { class: "citation-list" }, p.citations.map((cit) => {
      const clause = POLICY[cit.clauseId];
      if (!clause) return el("div", { class: "citation" }, el("p", null, `${cit.clauseId} — ${cit.reason}`));
      const d = el("details", { class: "citation" }, el("summary", null, el("span", null, cit.clauseId), el("strong", null, clause.title), el("b", null, "⌄")), el("p", null, clause.text), el("small", null, cit.reason));
      return d;
    }))));
  if (p.suspectedTypology) sections.push(el("section", { class: "packet-section" }, el("h3", null, "Suspected typology"), el("p", null, p.suspectedTypology)));
  for (const o of p.objections || []) {
    sections.push(el("section", { class: "objection " + o.resolution.toLowerCase() },
      el("div", null, el("span", null, o.resolution === "UNRESOLVED" ? `CHALLENGER BLOCK · ${o.severity}` : `CHALLENGE ${o.severity} · RESOLVED`), el("strong", null, o.claimChallenged)),
      el("p", null, (o.evidenceNeeded && o.evidenceNeeded.length) ? "Needed: " + o.evidenceNeeded.join(", ") : "Verified against evidence and citations.")));
  }
  if (p.missingEvidence && p.missingEvidence.length) {
    const box = el("section", { class: "packet-section missing" }, el("h3", null, "Missing evidence"), ...p.missingEvidence.map((m) => el("div", null, el("span", null, "○"), m)));
    if (state.selected === "CF-003" && RUNS["CF-003"][1]) {
      box.append(el("button", { class: "primary-button full", onclick: () => { if (state.replaying) return; state.runIndex = 1; replay(RUNS["CF-003"][1]); } }, "Add seeded evidence & resume ", el("span", null, "→")));
    }
    sections.push(box);
  }
  if (p.escalationNarrative) sections.push(el("section", { class: "packet-section narrative" }, el("h3", { html: "Analyst-ready narrative <span>DRAFT</span>" }), el("p", null, p.escalationNarrative)));
  sections.push(el("section", { class: "packet-section evidence" }, el("h3", null, "Evidence IDs"), el("div", null, (p.evidence || []).map((it) => el("span", null, `${it.id} · ${it.label}`)))));
  sections.push(el("section", { class: "packet-section" }, el("h3", { html: `Audit trace <span>${p.trace.length} events · SHA-256</span>` }),
    el("div", { class: "audit-mini" }, ...p.trace.slice(0, 6).map((t) => el("div", null, el("code", null, t.tool), el("small", null, t.outputHash.slice(0, 12) + "…"))), el("small", { class: "audit-note" }, `${p.trace.length} real timestamped, hashed events in the downloaded packet.`))));
  sections.push(el("section", { class: "next-action" }, el("span", null, "NEXT ACTION"), el("p", null, p.nextAction)));

  panel.replaceChildren(
    el("div", { class: "decision-hero disposition-" + p.recommendation.toLowerCase() },
      el("div", null, el("span", null, "CASEFLOW RECOMMENDATION"), el("h2", null, DISPO_LABEL[p.recommendation]), el("p", null, "Recommendation only · human review required")),
      el("div", { class: "confidence" }, el("strong", null, Math.round(p.confidence * 100) + "%"), el("span", null, "confidence"))),
    el("div", { class: "packet-scroll" }, ...sections));
}

render();
