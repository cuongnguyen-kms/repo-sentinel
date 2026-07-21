/**
 * Claude Code CLI execution wrapper using child_process.spawn.
 *
 * Security: prompt is passed via stdin, never via shell interpolation.
 * child_process.spawn is used (NOT exec) to avoid shell injection.
 *
 * CLAUDE_CODE_PATH env var overrides the default "claude" binary path.
 *
 * Streaming uses --output-format stream-json --include-partial-messages.
 * NDJSON lines are parsed via raw data events + manual line splitting:
 *   - ALL events forwarded as "review:stream-event" (no filtering)
 *   - Only stream_event deltas emitted to "review:output" terminal (avoids duplication from assistant events)
 *   - Thinking blocks shown with a dimmed ANSI prefix for visual distinction
 */

import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Server as SocketServer } from "socket.io";
import { prisma } from "@repo-sentinel/db";
import type {
  ClaudeStreamEvent,
  StreamJsonResultEvent,
} from "@repo-sentinel/types";

/** Build a clean env for spawned CLI — strips CLAUDECODE to avoid nested-session guard. */
function buildCliEnv(): NodeJS.ProcessEnv {
  const { CLAUDECODE, ...env } = process.env;
  return env;
}

/** Redact common secret patterns from text before broadcasting to clients. */
function redactSecrets(text: string): string {
  const patterns = [
    [/gh[ps]_\w+/g, "[REDACTED_GH_TOKEN]"],
    [/github_pat_\w+/g, "[REDACTED_GH_PAT]"],
    [/sk-[A-Za-z0-9]{32,}/g, "[REDACTED_SK]"],
    [/token=\S+/gi, "token=[REDACTED]"],
    [/Bearer \S+/gi, "Bearer [REDACTED]"],
    [/xox[bpras]-\S+/g, "[REDACTED_SLACK_TOKEN]"],
  ] as const;

  let result = text;
  for (const [pattern, replacement] of patterns) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  resultText?: string;
  costUsd?: number;
  durationMs?: number;
  sessionId?: string;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface StreamingCliOptions {
  prompt: string;
  /** Working directory — cloned repo path for full codebase context */
  cwd: string;
  timeoutMs?: number;
  io: SocketServer;
  roomId: string;
  /** Review ID for process registry — enables cancel/kill from HTTP endpoint */
  reviewId: string;
  /** Structured logger — replaces console.log in hot streaming path */
  log?: { debug: (obj: Record<string, unknown>, msg: string) => void; error: (obj: Record<string, unknown>, msg: string) => void };
}

/** In-memory output buffers keyed by roomId for terminal replay on reconnect */
const outputBuffers = new Map<string, string[]>();

/** In-memory process registry keyed by reviewId — enables cancel/kill from HTTP layer. */
const activeProcesses = new Map<string, ChildProcess>();

export function registerProcess(reviewId: string, child: ChildProcess): void {
  activeProcesses.set(reviewId, child);
}

export function unregisterProcess(reviewId: string): void {
  activeProcesses.delete(reviewId);
}

/** In-memory SIGKILL escalation timers keyed by reviewId — cleared on normal exit. */
const killTimers = new Map<string, NodeJS.Timeout>();

/** Kill an active CLI process. Returns true if a process was found and signalled. */
export function killProcess(reviewId: string): boolean {
  const child = activeProcesses.get(reviewId);
  if (!child) return false;
  child.kill("SIGTERM");
  // Escalate to SIGKILL if SIGTERM doesn't terminate within 5s
  const timer = setTimeout(() => {
    try { child.kill("SIGKILL"); } catch { /* already exited */ }
    killTimers.delete(reviewId);
  }, 5_000);
  killTimers.set(reviewId, timer);
  activeProcesses.delete(reviewId);
  return true;
}

/** Clear any pending SIGKILL escalation timer for a review. */
export function clearKillTimer(reviewId: string): void {
  const timer = killTimers.get(reviewId);
  if (timer) {
    clearTimeout(timer);
    killTimers.delete(reviewId);
  }
}

/** Resolve CLI path: DB setting > env var > default "claude" */
export async function resolveCliPath(): Promise<string> {
  const setting = await prisma.appSetting.findUnique({
    where: { key: "ai.review.cliPath" },
  });
  return setting?.value?.trim() || process.env["CLAUDE_CODE_PATH"] || "claude";
}

/** Resolved agent config: name + inline JSON for --agents flag. */
interface ResolvedAgent {
  name: string;
  /** Inline JSON for --agents flag (reads agent .md file and extracts prompt). */
  inlineJson: string | null;
}

/**
 * Resolve optional agent from DB setting (e.g. "pr-reviewer").
 * Also reads the agent's .md file and builds inline --agents JSON so the agent
 * works regardless of cwd (the cloned repo may not have .claude/agents/).
 */
async function resolveAgent(): Promise<ResolvedAgent | null> {
  const setting = await prisma.appSetting.findUnique({
    where: { key: "ai.review.agent" },
  });
  const name = setting?.value?.trim();
  if (!name) return null;

  let inlineJson: string | null = null;
  try {
    const cwd = process.cwd();
    const candidates = [
      join(cwd, ".claude", "agents", `${name}.md`),
      join(cwd, "..", "..", ".claude", "agents", `${name}.md`),
      join(cwd, "..", ".claude", "agents", `${name}.md`),
    ];
    let content: string | null = null;
    for (const p of candidates) {
      try { content = await readFile(p, "utf-8"); break; } catch { /* try next */ }
    }
    if (!content) throw new Error("agent file not found");
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (fmMatch) {
      const frontmatter = fmMatch[1];
      const prompt = fmMatch[2].trim();
      const modelMatch = frontmatter.match(/^model:\s*(.+)$/m);
      const model = modelMatch?.[1]?.trim() || "sonnet";
      inlineJson = JSON.stringify({ [name]: { model, prompt } });
    }
  } catch {
    // Agent file not found — fall back to --agent name (works when cwd has the agent)
  }

  return { name, inlineJson };
}

/** Resolve model: DB setting > default "sonnet". */
async function resolveModel(): Promise<string> {
  const setting = await prisma.appSetting.findUnique({
    where: { key: "ai.review.model" },
  });
  return setting?.value?.trim() || "sonnet";
}

/** Retrieve a shallow copy of buffered output chunks for a review room (for replay on reconnect). */
export function getOutputBuffer(roomId: string): string[] {
  return [...(outputBuffers.get(roomId) ?? [])];
}

/** Free the buffer after review completes or fails. */
export function clearOutputBuffer(roomId: string): void {
  outputBuffers.delete(roomId);
}

/**
 * Initialise the output buffer for a room and push an initial chunk.
 * Called before executeClaudeCliStreaming so pre-flight log lines are replayable.
 */
export function appendToOutputBuffer(roomId: string, chunk: string): void {
  if (!outputBuffers.has(roomId)) {
    outputBuffers.set(roomId, []);
  }
  outputBuffers.get(roomId)!.push(chunk);
}

/**
 * Handle a parsed stream-json event:
 *   - Forward ALL events as "review:stream-event" (no server-side filtering)
 *   - Only stream_event deltas produce terminal output (text_delta, thinking_delta, input_json_delta)
 *   - "assistant" events skipped for terminal — they duplicate delta content with --include-partial-messages
 *   - Capture result event data for CliResult
 */
function handleStreamEvent(
  event: ClaudeStreamEvent,
  io: SocketServer,
  roomId: string,
  buffer: string[],
  resultRef: { value: StreamJsonResultEvent | null },
  currentBlockRef: { value: string | null }
): void {
  // Redact secrets from text fields before broadcast to prevent token/key leakage.
  if (event.type === "stream_event") {
    const delta = event.event?.delta;
    if (delta?.text) delta.text = redactSecrets(delta.text);
    if (delta?.thinking) delta.thinking = redactSecrets(delta.thinking);
    if (delta?.partial_json) delta.partial_json = redactSecrets(delta.partial_json);
    io.to(roomId).emit("review:stream-event", event);
  } else if (event.type === "result") {
    resultRef.value = event as StreamJsonResultEvent;
    const r = event as StreamJsonResultEvent;
    io.to(roomId).emit("review:stream-event",
      r.result ? { ...event, result: redactSecrets(r.result) } : event
    );
  } else {
    io.to(roomId).emit("review:stream-event", event);
  }

  // Skip terminal output for "assistant" events — they contain accumulated content
  // that duplicates the incremental stream_event deltas below.
  if (event.type === "stream_event") {
    const { delta } = event.event;
    if (delta?.type === "text_delta" && delta.text) {
      emitToTerminal(io, roomId, buffer, delta.text);
    } else if (delta?.type === "thinking_delta" && delta.thinking) {
      emitToTerminal(io, roomId, buffer, `\x1b[2m${delta.thinking}\x1b[0m`);
    } else if (delta?.type === "input_json_delta" && delta.partial_json) {
      emitToTerminal(io, roomId, buffer, `\x1b[36m${delta.partial_json}\x1b[0m`);
    }
    const inner = event.event as Record<string, unknown>;
    const block = inner?.content_block as { type?: string; name?: string } | undefined;
    if (inner?.type === "content_block_start" && block?.type === "tool_use" && block.name) {
      currentBlockRef.value = "tool_use";
      emitToTerminal(io, roomId, buffer, `[Tool: ${block.name}] `);
    } else if (inner?.type === "content_block_stop" && currentBlockRef.value === "tool_use") {
      currentBlockRef.value = null;
      emitToTerminal(io, roomId, buffer, `\r\n`);
    } else if (inner?.type === "content_block_start" && block?.type === "text") {
      currentBlockRef.value = "text";
    } else if (inner?.type === "content_block_start" && block?.type === "thinking") {
      currentBlockRef.value = "thinking";
      emitToTerminal(io, roomId, buffer, `\x1b[2m[Thinking...]\x1b[0m\r\n`);
    } else if (inner?.type === "content_block_stop") {
      if (currentBlockRef.value === "text" || currentBlockRef.value === "thinking") {
        emitToTerminal(io, roomId, buffer, `\r\n`);
      }
      currentBlockRef.value = null;
    }
  }
}

/** Emit text to a Socket.IO room and buffer it for replay. Normalizes \n → \r\n for terminal display. */
function emitToTerminal(io: SocketServer, roomId: string, buffer: string[], text: string): void {
  const normalized = text.replace(/\r?\n/g, "\r\n");
  buffer.push(normalized);
  io.to(roomId).emit("review:output", normalized);
}

/**
 * Execute Claude CLI with NDJSON streaming to a Socket.IO room.
 *
 * Uses --output-format stream-json --include-partial-messages for real-time events.
 * stdin carries the prompt (avoids OS E2BIG errors on large PRs).
 *
 * cwd sets the working directory to the cloned repo so Claude has full
 * codebase context via its Read/Glob/Grep tools.
 */
export async function executeClaudeCliStreaming(
  options: StreamingCliOptions
): Promise<CliResult> {
  const { prompt, cwd, timeoutMs = 300_000, io, roomId, reviewId, log } = options;
  const [cliPath, agent, model] = await Promise.all([resolveCliPath(), resolveAgent(), resolveModel()]);

  if (!outputBuffers.has(roomId)) outputBuffers.set(roomId, []);
  const buffer = outputBuffers.get(roomId)!;

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const resultRef: { value: StreamJsonResultEvent | null } = { value: null };
    const currentBlockRef: { value: string | null } = { value: null };

    const args = [
      "-p",
      "--model", model,
      "--verbose",
      "--output-format", "stream-json",
      "--include-partial-messages",
      "--no-session-persistence",
      // Required for non-interactive subprocess to write files without prompting.
      "--dangerously-skip-permissions",
    ];
    if (agent) {
      if (agent.inlineJson) {
        args.push("--agents", agent.inlineJson, "--agent", agent.name);
      } else {
        args.push("--agent", agent.name);
      }
    }

    // Show the command in the terminal (mask inline agents JSON for readability)
    const displayArgs = args.map((a, i) => {
      if (args[i - 1] === "--agents") return '"<AGENTS_JSON>"';
      return a;
    });
    const cmdLine = `echo "<PROMPT>" | ${cliPath} ${displayArgs.join(" ")}`;
    const cmdMsg = `\x1b[36m$ ${cmdLine}\x1b[0m\r\n`;
    buffer.push(cmdMsg);
    io.to(roomId).emit("review:output", cmdMsg);

    log?.debug({ cliPath, argCount: args.length, promptBytes: prompt.length, hasAgent: !!agent, hasInlineJson: !!agent?.inlineJson }, "spawning Claude CLI");

    const child = spawn(cliPath, args, {
      env: buildCliEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
    });

    registerProcess(reviewId, child);

    // Write prompt to stdin and close — CLI reads it when -p has no argument value.
    // Suppress EPIPE — thrown when CLI exits before reading all stdin.
    child.stdin!.on("error", () => {});
    child.stdin!.write(prompt);
    child.stdin!.end();

    // Idle-based timeout: resets every time stdout/stderr produces data.
    let idleTimer: NodeJS.Timeout;
    let killTimer: NodeJS.Timeout;
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      }, timeoutMs);
    };
    resetIdleTimer();

    // Parse NDJSON via raw data events + manual line splitting
    let lineBuf = "";
    child.stdout!.on("data", (d: Buffer) => {
      resetIdleTimer();
      log?.debug({ bytes: d.length }, "stdout chunk");
      lineBuf += d.toString();
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop()!;
      for (const line of lines) {
        if (!line.trim()) continue;
        stdout += line + "\n";
        try {
          handleStreamEvent(JSON.parse(line) as ClaudeStreamEvent, io, roomId, buffer, resultRef, currentBlockRef);
        } catch {
          emitToTerminal(io, roomId, buffer, redactSecrets(line) + "\r\n");
        }
      }
    });

    child.stderr.on("data", (d: Buffer) => {
      resetIdleTimer();
      log?.debug({ bytes: d.length }, "stderr chunk");
      const chunk = d.toString();
      stderr += chunk;
      emitToTerminal(io, roomId, buffer, redactSecrets(chunk));
    });

    child.on("error", (err: Error) => {
      log?.error({ error: err.message }, "spawn error");
      unregisterProcess(reviewId);
      clearKillTimer(reviewId);
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      clearTimeout(killTimer);
      resolve({ stdout, stderr: err.message, exitCode: 1, timedOut: false });
    });

    child.on("close", (code: number | null) => {
      log?.debug({ exitCode: code }, "process closed");
      unregisterProcess(reviewId);
      clearKillTimer(reviewId);
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      clearTimeout(killTimer);
      const r = resultRef.value;
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
        timedOut,
        resultText: r?.result,
        costUsd: r?.total_cost_usd,
        durationMs: r?.duration_ms,
        sessionId: r?.session_id,
        usage: r?.usage,
      });
    });
  });
}
