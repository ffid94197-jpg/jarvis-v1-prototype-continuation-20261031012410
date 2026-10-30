"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import ModelManager from "@/components/ModelManager";
import JarvisOrb from "@/components/JarvisOrb";
import AssistantPanel, {
  type ChatMessage,
  type TraceStep,
} from "@/components/AssistantPanel";
import type { OrbActivity } from "@/lib/orbScene";

let msgId = 0;
const nextId = () => `m-${Date.now()}-${++msgId}`;

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // V1 NEXUS navigation: orb landing → console → settings (in console only).
  const [view, setView] = useState<"orb" | "console">("orb");
  const [cancellable, setCancellable] = useState(false);
  const [activity, setActivity] = useState<OrbActivity>("idle");
  const [identity, setIdentity] = useState<string | null>(null);
  const [authState, setAuthState] = useState<'checking' | 'enroll' | 'login' | 'ready' | 'dev-error'>('checking');
  const [authSecret, setAuthSecret] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const idleTimer = useRef<number | null>(null);
  const taskIdRef = useRef<string | null>(null);
  const settingsDialogRef = useRef<HTMLDivElement | null>(null);

  // Modal focus is separate from the assistant console and always restored.
  useEffect(() => {
    if (!settingsOpen) return;
    const oldFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = settingsDialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialog) return;
      const candidates = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]'
      )).filter(el => el.getClientRects().length > 0);
      if (candidates.length === 0) {event.preventDefault();return;}
      const first=candidates[0], last=candidates[candidates.length-1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();first.focus();
      }
    };
    window.addEventListener('keydown', trapFocus);
    return () => {window.removeEventListener('keydown', trapFocus);document.body.style.overflow = previousOverflow;oldFocus?.focus();};
  }, [settingsOpen]);

  // No automatic OWNER enrollment: first-run requires an operator-issued
  // setup token and a configured password hash. Expired owners sign in again.
  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        const res = await fetch('/api/jarvis/auth/session', { cache: 'no-store' });
        const data = (await res.json()) as {
          bootstrapOpen?: boolean;
          localDevelopment?: boolean;
          error?: string;
          principal?: { role: string; label: string; status: string };
        };
        if (stopped) return;
        if (res.ok && data.principal?.status === 'ACTIVE') {
          setIdentity(`${data.principal.role} · ${data.principal.label}`);
          setAuthState('ready');
        } else {
          if (data.localDevelopment) {
            setAuthState('dev-error');
            setAuthError(data.error ?? 'Local owner session unavailable. Check the dedicated test database and server logs.');
          } else {
            setAuthState(data.bootstrapOpen ? 'enroll' : 'login');
          }
        }
      } catch {
        if (!stopped) {
          setAuthState('login');
          setAuthError('Unable to reach the owner session service.');
        }
      }
    })();
    return () => { stopped = true; };
  }, []);

  const submitAuth = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (authBusy) return;
    setAuthBusy(true);
    setAuthError('');
    try {
      const enrollment = authState === 'enroll';
      const endpoint = enrollment ? '/api/jarvis/auth/bootstrap' : '/api/jarvis/auth/login';
      const body = enrollment ? { setupToken } : { passphrase: authSecret };
      const res = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null) as {
        error?: string; principal?: { label: string; role: string; status: string };
      } | null;
      if (!res.ok || !data?.principal || data.principal.status !== 'ACTIVE') {
        throw new Error(data?.error ?? `Authentication failed (${res.status}).`);
      }
      setIdentity(`${data.principal.role} · ${data.principal.label}`);
      setAuthState('ready');
      setAuthSecret(''); setSetupToken('');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Authentication unavailable.');
    } finally {
      setAuthBusy(false);
    }
  }, [authBusy, authSecret, authState, setupToken]);

  useEffect(() => {
    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, []);

  const settleIdle = useCallback((delay = 1200) => {
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setActivity("idle"), delay);
  }, []);

  // Settings is nested in Console. Escape dismisses Settings first; then returns to the orb.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (settingsOpen) setSettingsOpen(false);
      else if (view === "console" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) setView("orb");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen, view]);

  // ——— REAL agent task: NEXUS → Core → Guardian → Executor → back ———
  const startTask = useCallback(
    async (body: Record<string, unknown>, initialPhase: string) => {
      if (streaming || authState !== 'ready') return;

      const replyId = nextId();
      setMessages((prev) => [
        ...prev,
        { id: replyId, role: "assistant", content: "", steps: [], phase: initialPhase },
      ]);
      setStreaming(true);
      setActivity("executing");
      taskIdRef.current = null;
      setCancellable(true);

      const patchReply = (fn: (m: ChatMessage) => ChatMessage) =>
        setMessages((prev) => prev.map((m) => (m.id === replyId ? fn(m) : m)));

      try {
        const res = await fetch("/api/jarvis/task", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok || !res.body) {
          if (res.status === 401) { setAuthState('login'); }
          const detail = await res.json().catch(() => null);
          throw new Error(detail?.error ?? `Runtime channel error (${res.status}).`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let sep: number;
          while ((sep = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);

            let event = "message";
            let data = "";
            for (const line of frame.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) data += line.slice(5).trim();
            }
            if (!data) continue;

            let payload: Record<string, unknown> = {};
            try {
              payload = JSON.parse(data);
            } catch {
              continue;
            }

            if (event === "status") {
              const tid = payload.taskId as string | undefined;
              taskIdRef.current = tid ?? taskIdRef.current;
              const phase = String(payload.phase ?? "").toUpperCase();
              const stepsUsed = Number(payload.stepsUsed ?? 0);
              patchReply((m) => ({
                ...m,
                taskId: tid ?? m.taskId,
                phase: stepsUsed > 0 ? `EXECUTING · ${stepsUsed}` : phase,
              }));
              if (phase === "REPORTING") setActivity("speaking");
              else if (phase === "EXECUTING" || phase === "PLANNING") setActivity("executing");
            } else if (event === "step") {
              const step = payload.step as TraceStep | undefined;
              if (step) {
                patchReply((m) => ({ ...m, steps: [...(m.steps ?? []), step] }));
              }
            } else if (event === "delta") {
              const t = payload.text as string | undefined;
              if (t) {
                setActivity("speaking");
                patchReply((m) => ({ ...m, content: m.content + t }));
              }
            } else if (event === "final") {
              const status = payload.status as string;
              const text = payload.text as string;
              if (status === "paused") {
                patchReply((m) => ({
                  ...m,
                  content: text,
                  phase: undefined,
                  paused: true,
                }));
              } else if (status === "denied" || status === "cancelled" || status === "failed" || status === "effect_unknown") {
                patchReply((m) => ({
                  ...m,
                  content: text,
                  phase: undefined,
                  error: status === "failed" || status === "effect_unknown",
                }));
              } else {
                // completed | partial — content already streamed via
                // deltas (partial carries the honest settlement digest).
                patchReply((m) => ({
                  ...m,
                  content: m.content.length > 0 ? m.content : text,
                  phase: undefined,
                }));
              }
            } else if (event === "error") {
              throw new Error(payload.message as string);
            }
          }
        }
        settleIdle();
      } catch (err) {
        patchReply((m) => ({
          ...m,
          content:
            m.content.length > 0
              ? m.content
              : `Runtime disruption: ${err instanceof Error ? err.message : "unknown error"}`,
          phase: undefined,
          error: m.content.length === 0,
        }));
        setActivity("idle");
      } finally {
        setStreaming(false);
        setCancellable(false);
        taskIdRef.current = null;
        settleIdle();
      }
    },
    [streaming, settleIdle, authState],
  );

  const runTask = useCallback(
    (text: string) => {
      if (streaming || authState !== 'ready') return;
      setMessages((prev) => [...prev, { id: nextId(), role: "user", content: text }]);
      void startTask({ objective: text }, "PLANNING");
    },
    [streaming, startTask, authState],
  );

  // Resume a durably paused task through the same runtime channel —
  // NEXUS calls the REAL resume API (journal replay, no duplicate steps).
  const resumeTask = useCallback(
    (taskId: string) => {
      if (streaming) return;
      // The resumed run continues in a new trace message; retire the old
      // paused message's affordance so the flow cannot fork.
      setMessages((prev) =>
        prev.map((m) => (m.taskId === taskId && m.paused ? { ...m, paused: false } : m)),
      );
      void startTask({ resumeTaskId: taskId }, "RESUMING");
    },
    [streaming, startTask, authState],
  );

  const cancelTask = useCallback(async () => {
    const taskId = taskIdRef.current;
    if (!taskId) return;
    try {
      await fetch("/api/jarvis/task/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      });
    } catch {
      // the stream will settle the task state regardless
    }
  }, []);

  return (
    <main className={`jarvis-root nexus-console-only ${view === "orb" ? "nexus-orb-home" : "nexus-console-view"}`}>
      {authState === "ready" && view === "orb" && (
        <JarvisOrb activity={activity} mode="orb" onToggleMode={() => setView("console")} />
      )}
      {authState === 'ready' && (
        <div className={settingsOpen ? "nexus-settings-overlay" : "nexus-settings-overlay nexus-settings-overlay--closed"} aria-hidden={!settingsOpen} inert={!settingsOpen} role="presentation" onMouseDown={event => {
          if (event.target === event.currentTarget) setSettingsOpen(false);
        }}>
          <div ref={settingsDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="JARVIS Settings" className="nexus-settings-dialog">
            <ModelManager settingsOpen={settingsOpen} onClose={() => setSettingsOpen(false)} busyTask={streaming}
              latestReply={!streaming && messages.length>0 && messages[messages.length-1].role === "assistant" && !messages[messages.length-1].phase ? messages[messages.length-1].content : undefined}
              onCommand={text => {setSettingsOpen(false);runTask(text);}} />
          </div>
        </div>
      )}
      <AssistantPanel
        open={authState === "ready" && view === "console"}
        messages={messages}
        streaming={streaming}
        cancellable={cancellable}
        identity={identity}
        onSend={runTask}
        onCancel={cancelTask}
        onResume={resumeTask}
        onOpenSettings={() => setSettingsOpen(true)}
        onReturnHome={() => {setSettingsOpen(false);setView("orb");}}
        activity={activity}
      />
      {authState !== 'ready' && (
        <section className="jarvis-auth-shade" aria-label="Owner authentication">
          <div className="jarvis-auth-card">
            <h2>{authState === 'dev-error' ? 'LOCAL TEST SESSION UNAVAILABLE' : authState === 'enroll' ? 'FIRST-RUN OWNER ENROLLMENT' : 'OWNER AUTHENTICATION'}</h2>
            <p>{authState === 'dev-error'
              ? 'V1 localhost testing does not require a passphrase. The local owner session could not be created. Check database configuration or the terminal error; remote and production access remain protected.'
              : authState === 'enroll'
              ? 'Enter the private one-time setup token provisioned by the operator. Never share it in chat.'
              : 'Sign in with the operator-configured owner passphrase to resume JARVIS.'}</p>
            {authError && <div className="jarvis-auth-error" role="alert">{authError}</div>}
            {authState === 'dev-error' ? (
              <button type="button" onClick={() => window.location.reload()}>RETRY LOCAL SESSION</button>
            ) : authState !== 'checking' ? (
              <form onSubmit={submitAuth}>
                {authState === 'enroll' ? (
                  <label>SETUP TOKEN<input required autoComplete="off" type="password"
                    value={setupToken} onChange={e => setSetupToken(e.target.value)} /></label>
                ) : (
                  <label>PASSPHRASE<input required autoComplete="current-password" type="password"
                    value={authSecret} onChange={e => setAuthSecret(e.target.value)} /></label>
                )}
                <button disabled={authBusy} type="submit">
                  {authBusy ? 'VERIFYING…' : authState === 'enroll' ? 'ENROLL OWNER' : 'AUTHENTICATE'}
                </button>
              </form>
            ) : <p>Checking current session…</p>}
            <small>Guardian-protected tasks require a valid owner session, including in local testing.</small>
          </div>
        </section>
      )}
    </main>
  );
}
