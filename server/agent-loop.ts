import type { AuditEvent } from "../lib/contracts.ts";
import { nowIso, sha256, uid } from "./util.ts";

export type AgentRole = AuditEvent["actor"];

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  // Terminal tools have no handler; the loop stops and returns their args.
  terminal?: boolean;
  handler?: (args: any) => unknown | Promise<unknown>;
}

// Every event the loop emits. The orchestrator forwards these to the SSE
// stream and collects the audit-relevant ones into the decision packet trace.
export type AgentEvent =
  | { type: "thinking"; role: AgentRole; text: string }
  | { type: "tool_call"; role: AgentRole; id: string; tool: string; args: unknown; timestamp: string; inputHash: string }
  | { type: "tool_result"; role: AgentRole; id: string; tool: string; summary: string; result: unknown; timestamp: string; outputHash: string; status: "COMPLETE" | "BLOCKED" }
  | { type: "role_start"; role: AgentRole; note: string }
  | { type: "role_end"; role: AgentRole; note: string }
  | { type: "objection"; role: AgentRole; severity: string; claim: string; evidenceNeeded: string[] }
  | { type: "approval"; role: AgentRole; note: string }
  | { type: "decision"; recommendation: string; packet: unknown }
  | { type: "revision"; round: number; note: string }
  | { type: "guardrail"; ok: boolean; errors: string[]; note: string }
  | { type: "agent_failure"; reason: string }
  | { type: "run_start"; caseId: string; mode: string; runId: string }
  | { type: "run_complete"; runId: string; recommendation: string | null; status: string }
  | { type: "mode"; mode: "live" | "replay" };

export type ChatMessage =
  | { role: "system" | "user" | "assistant"; content: string; tool_calls?: any[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface RunResult {
  terminalTool: string | null;
  terminalArgs: any | null;
  turns: number;
  trace: AuditEvent[];
  messages: ChatMessage[];
  finalText: string;
}

interface LoopOptions {
  role: AgentRole;
  system: string;
  user: string;
  tools: ToolDef[];
  onEvent: (e: AgentEvent) => void;
  maxTurns?: number;
  temperature?: number;
  priorMessages?: ChatMessage[];
}

function toOpenAITools(tools: ToolDef[]) {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

// A single generic OpenAI-compatible tool-use loop. Streams deltas, executes
// non-terminal tools against their handlers, and returns when a terminal tool
// is called or maxTurns is hit. Real timestamp + SHA-256 on every audit event.
export async function runAgentLoop(opts: LoopOptions): Promise<RunResult> {
  const { role, system, user, tools, onEvent } = opts;
  const maxTurns = opts.maxTurns ?? 12;
  const temperature = opts.temperature ?? 0.2;
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || "qwen3.7-plus";
  if (!baseUrl || !apiKey) throw new Error("LLM_BASE_URL and LLM_API_KEY must be set (see .env.local)");

  const toolByName = new Map(tools.map((t) => [t.name, t]));
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    ...(opts.priorMessages ?? []),
    { role: "user", content: user },
  ];
  const trace: AuditEvent[] = [];
  let finalText = "";

  onEvent({ type: "role_start", role, note: `${role} agent started` });

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, stream: true, temperature, messages, tools: toOpenAITools(tools), tool_choice: "auto" }),
    });
    if (!res.ok || !res.body) {
      const body = res.body ? await res.text() : "no body";
      throw new Error(`LLM error ${res.status}: ${String(body).slice(0, 300)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let contentText = "";
    // tool_calls accumulate across deltas, keyed by index.
    const toolAcc = new Map<number, { id: string; name: string; args: string }>();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;
        let json: any;
        try { json = JSON.parse(data); } catch { continue; }
        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          contentText += delta.content;
          onEvent({ type: "thinking", role, text: delta.content });
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const entry = toolAcc.get(idx) ?? { id: "", name: "", args: "" };
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.name += tc.function.name;
            if (tc.function?.arguments) entry.args += tc.function.arguments;
            toolAcc.set(idx, entry);
          }
        }
      }
    }

    const calls = [...toolAcc.values()].filter((c) => c.name);

    if (calls.length === 0) {
      // No tool call this turn. Accept as final text; nudge once toward a tool.
      finalText = contentText.trim();
      if (turn < maxTurns - 1 && !messages.some((m) => m.role === "user" && typeof m.content === "string" && m.content.includes("must call one of the available tools"))) {
        messages.push({ role: "assistant", content: contentText });
        messages.push({ role: "user", content: "You must call one of the available tools to proceed (gather evidence, or submit your decision)." });
        continue;
      }
      break;
    }

    // Record the assistant turn (with its tool_calls) before appending results.
    messages.push({
      role: "assistant",
      content: contentText,
      tool_calls: calls.map((c) => ({ id: c.id || uid("call"), type: "function", function: { name: c.name, arguments: c.args || "{}" } })),
    });

    let terminalHit: { tool: string; args: any } | null = null;

    for (const call of calls) {
      const callId = call.id || uid("call");
      let args: any = {};
      try { args = call.args ? JSON.parse(call.args) : {}; } catch { args = { _rawArgs: call.args }; }
      const tsIn = nowIso();
      const inputHash = sha256({ tool: call.name, args });
      onEvent({ type: "tool_call", role, id: callId, tool: call.name, args, timestamp: tsIn, inputHash });

      const def = toolByName.get(call.name);
      if (def?.terminal) {
        terminalHit = { tool: call.name, args };
        // Give the model a synthetic tool ack so message history stays valid.
        messages.push({ role: "tool", tool_call_id: callId, content: JSON.stringify({ received: true }) });
        trace.push({ id: uid("EV"), actor: role, action: `Called ${call.name}`, tool: call.name, inputHash, outputHash: sha256({ received: true }), timestamp: tsIn, status: "COMPLETE" });
        continue;
      }

      let result: unknown;
      let status: "COMPLETE" | "BLOCKED" = "COMPLETE";
      try {
        result = def?.handler ? await def.handler(args) : { error: `Unknown tool ${call.name}` };
        if (!def?.handler) status = "BLOCKED";
      } catch (err) {
        result = { error: String(err) };
        status = "BLOCKED";
      }
      const tsOut = nowIso();
      const outputHash = sha256(result);
      const summary = summarize(call.name, result);
      onEvent({ type: "tool_result", role, id: callId, tool: call.name, summary, result, timestamp: tsOut, outputHash, status });
      trace.push({ id: uid("EV"), actor: role, action: `Executed ${call.name}`, tool: call.name, inputHash, outputHash, timestamp: tsOut, status });
      messages.push({ role: "tool", tool_call_id: callId, content: JSON.stringify(result) });
    }

    if (terminalHit) {
      onEvent({ type: "role_end", role, note: `${role} finished via ${terminalHit.tool}` });
      return { terminalTool: terminalHit.tool, terminalArgs: terminalHit.args, turns: turn + 1, trace, messages, finalText: contentText.trim() };
    }
  }

  onEvent({ type: "role_end", role, note: `${role} ended without a terminal tool (turn cap ${maxTurns})` });
  return { terminalTool: null, terminalArgs: null, turns: maxTurns, trace, messages, finalText };
}

function summarize(tool: string, result: unknown): string {
  try {
    const r: any = result;
    if (tool === "search_policy") return `${r.results?.length ?? 0} clause(s): ${(r.results ?? []).map((x: any) => x.clauseId).join(", ")}`;
    if (tool === "search_prior_cases") return `${r.results?.length ?? 0} prior case(s): ${(r.results ?? []).map((x: any) => `${x.id}/${x.disposition}`).join(", ")}`;
    if (tool === "get_travel_rule_payload") return `${r.completeness}${r.missingRequiredFields?.length ? ` · missing ${r.missingRequiredFields.join(", ")}` : ""}`;
    if (tool === "get_wallet_intelligence") return `${r.exposure} exposure · ${r.linkedEntities} linked`;
    if (tool === "get_transaction_history") return `${r.currency} ${r.amount} · ${r.corridor}`;
    if (tool === "get_customer_profile") return `${r.kycState} · ${r.riskTier} risk`;
    if (tool === "get_alert") return `${r.alertType} · vendor ${r.vendorScore}`;
    return JSON.stringify(r).slice(0, 120);
  } catch {
    return "ok";
  }
}
