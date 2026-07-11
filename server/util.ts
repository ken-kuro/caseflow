import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

// Load KEY=VALUE lines from .env.local into process.env (does not override
// values already present). Node 25 also supports --env-file, but we want the
// sidecar and the eval script to work with a plain `node file.ts` invocation.
export function loadEnvLocal(path = ".env.local"): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// Real SHA-256 of the canonical JSON of a value — replaces the fabricated FNV
// "audit hashes" of the deterministic v1. Verifiable in the downloaded packet.
export function sha256(value: unknown): string {
  const source = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return createHash("sha256").update(source).digest("hex");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function uid(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}
