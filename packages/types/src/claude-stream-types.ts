/**
 * TypeScript types for Claude CLI --output-format stream-json NDJSON events.
 * Used by both API (parsing) and Web (consuming Socket.IO events).
 */

export interface StreamJsonSystemEvent {
  type: "system";
  subtype: "init" | "hook_started" | "hook_response" | string;
  session_id: string;
  [key: string]: unknown;
}

export type StreamJsonAssistantContent =
  | { type: "thinking"; thinking: string }
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

export interface StreamJsonAssistantEvent {
  type: "assistant";
  message: {
    id: string;
    model: string;
    role: "assistant";
    content: StreamJsonAssistantContent[];
    stop_reason: string | null;
    usage: { input_tokens: number; output_tokens: number };
  };
  session_id: string;
}

export interface StreamJsonStreamEvent {
  type: "stream_event";
  event: {
    delta?: { type: string; text?: string; thinking?: string; partial_json?: string };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface StreamJsonResultEvent {
  type: "result";
  subtype: "success" | "error";
  is_error: boolean;
  result: string;
  duration_ms: number;
  total_cost_usd: number;
  usage: { input_tokens: number; output_tokens: number };
  session_id: string;
}

export type ClaudeStreamEvent =
  | StreamJsonSystemEvent
  | StreamJsonAssistantEvent
  | StreamJsonStreamEvent
  | StreamJsonResultEvent;
