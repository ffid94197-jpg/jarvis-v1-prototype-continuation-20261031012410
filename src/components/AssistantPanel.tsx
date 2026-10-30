"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  error?: boolean;
  /** Real task trace — tool calls, results, Guardian verdicts. */
  steps?: TraceStep[];
  /** Current runtime phase while a task is live. */
  phase?: string;
  paused?: boolean;
  /** Durable task id (from the runtime) — enables RESUME after a pause. */
  taskId?: string;
}

export interface TraceStep {
  seq: number;
  kind: "tool_call" | "tool_result" | "guardian_deny" | "pause" | "error";
  tool?: string;
  args?: string;
  result?: string;
  note?: string;
  ok?: boolean;
}

export interface AssistantPanelProps {
  open: boolean;
  messages: ChatMessage[];
  streaming: boolean;
  cancellable: boolean;
  /** Server-derived principal shown in the console header (text mode only). */
  identity?: string | null;
  onSend: (text: string) => void;
  onCancel: () => void;
  /** Continue a durably paused task through the real resume API. */
  onResume: (taskId: string) => void;
  onOpenSettings: () => void;
  onReturnHome: () => void;
  activity?: "idle" | "connecting" | "executing" | "speaking";
}

const QUICK_PROMPTS = [
  "Create a folder JARVIS_AGENT_TEST with result.txt saying 'Agent execution successful', then read it back to verify",
  "What can you do?",
  "Run a systems check",
];

const KIND_META: Record<TraceStep["kind"], { icon: string; label: string }> = {
  tool_call: { icon: "▸", label: "EXEC" },
  tool_result: { icon: "✓", label: "OK" },
  guardian_deny: { icon: "⛔", label: "DENIED" },
  pause: { icon: "⏸", label: "PAUSED" },
  error: { icon: "⚠", label: "ERROR" },
};

export default function AssistantPanel({
  open,
  messages,
  streaming,
  cancellable,
  identity,
  onSend,
  onCancel,
  onResume,
  onOpenSettings,
  onReturnHome,
  activity = "idle",
}: AssistantPanelProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to latest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  // Focus the console input when opening.
  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 350);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  const submit = (text?: string) => {
    const value = (text ?? input).trim();
    if (!value || streaming) return;
    onSend(value);
    if (!text) setInput("");
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          className="assist-panel"
          role="complementary"
          aria-label="JARVIS assistant console"
          initial={false}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <header className="assist-header">
            <div className="assist-header-titles">
              <span className="assist-title">J.A.R.V.I.S. <span className="nexus-console-title-detail">/ NEXUS CONSOLE</span></span>
              <span className="assist-subtitle">
                PRIVATE ASSISTANT · GUARDIAN PROTECTED{identity ? ` · ${identity}` : ""} · {activity.toUpperCase()}
              </span>
            </div>
            <div className="assist-header-actions">
              <button type="button" className="nexus-chat-orb-button" onClick={onReturnHome}
                aria-label="Return to JARVIS orb" title="Return to the holographic orb">
                <span aria-hidden="true">◎</span> <span>ORB</span>
              </button>
              <button type="button" className="nexus-chat-settings-button" onClick={onOpenSettings}
                aria-label="Open JARVIS Settings" aria-haspopup="dialog" title="Configure models, voice, face, memory, tools and devices">
                <span aria-hidden="true">⚙</span> <span>SETTINGS</span>
              </button>
              {cancellable ? (
                <button
                  type="button"
                  className="assist-cancel-btn"
                  onClick={onCancel}
                  aria-label="Cancel running task"
                >
                  ■ STOP
                </button>
              ) : null}
            </div>
          </header>

          <div ref={scrollRef} className="assist-messages">
            {messages.length === 0 && (
              <div className="assist-empty">
                <p className="assist-empty-title">GOOD DAY.</p>
                <p className="assist-empty-line">
                  Agent runtime online. I can execute real, Guardian-authorized
                  work in the permitted workspace — files, folders, and
                  allowlisted commands — and verify the results.
                </p>
                <div className="assist-quick">
                  {QUICK_PROMPTS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className="assist-chip"
                      onClick={() => submit(p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) => (
              <div key={m.id} className={`msg msg--${m.role}${m.error ? " msg--error" : ""}`}>
                <div className="msg-role">
                  {m.role === "user" ? "OPERATOR" : "JARVIS"}
                  {m.phase && (
                    <span className="msg-phase"> · {m.phase}</span>
                  )}
                </div>

                {m.steps && m.steps.length > 0 && (
                  <div className="trace" aria-label="Task execution trace">
                    {m.steps.map((s) => {
                      const meta = KIND_META[s.kind];
                      return (
                        <div key={`${s.seq}-${s.kind}`} className={`trace-line trace--${s.kind}`}>
                          <span className="trace-icon">{meta.icon}</span>
                          <span className="trace-body">
                            {s.kind === "tool_call" && (
                              <>
                                <span className="trace-tag">{meta.label}</span>{" "}
                                <span className="trace-tool">{s.tool}</span>{" "}
                                <span className="trace-args">{s.args}</span>
                              </>
                            )}
                            {s.kind === "tool_result" && (
                              <>
                                <span className={`trace-tag ${s.ok === false ? "trace-tag--fail" : ""}`}>
                                  {s.ok === false ? "FAIL" : meta.label}
                                </span>{" "}
                                <span className="trace-tool">{s.tool}</span>{" "}
                                <span className="trace-result">{s.result}</span>
                              </>
                            )}
                            {s.kind === "guardian_deny" && (
                              <>
                                <span className="trace-tag">{meta.label}</span>{" "}
                                <span className="trace-tool">{s.tool}</span>{" "}
                                <span className="trace-deny">{s.note}</span>
                              </>
                            )}
                            {(s.kind === "pause" || s.kind === "error") && (
                              <span className="trace-deny">{s.note}</span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="msg-body">{m.content}</div>

                {m.paused && m.taskId && !streaming && (
                  <button
                    type="button"
                    className="assist-resume-btn"
                    onClick={() => onResume(m.taskId!)}
                    aria-label="Resume paused task from its durable journal"
                  >
                    ▶ RESUME TASK
                  </button>
                )}
              </div>
            ))}

            {streaming && !messages.some((m) => m.phase) && (
              <div className="msg msg--assistant msg--streaming">
                <div className="msg-role">JARVIS</div>
                <div className="msg-body msg-typing" aria-label="JARVIS is responding">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>
          <form
            className="assist-input-row"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <input
              ref={inputRef}
              className="assist-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Give JARVIS a real task…"
              maxLength={2000}
              autoComplete="off"
              aria-label="Task or message for JARVIS"
            />
            <button
              type="submit"
              className="assist-send"
              disabled={streaming || input.trim().length === 0}
              aria-label="Send message"
            >
              {streaming ? "…" : "SEND"}
            </button>
          </form>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
