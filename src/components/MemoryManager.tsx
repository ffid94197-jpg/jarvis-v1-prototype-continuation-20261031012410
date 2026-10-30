"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type MemoryRecord = {
  id: string; key: string; content: string; dataClass: string; updatedAt: string;
};
type WorldRecord = {
  id: string; subject: string; predicate: string; value: string; source: string;
  stale: boolean; expiresAt?: string;
};

/**
 * Text-Mode-only, owner-scoped opt-in memory manager.
 * Does not promote user claims into VERIFIED_TOOL and never pushes local
 * memory to the model. A future cloud-context feature requires a separate
 * explicit consent and provider-data-policy implementation.
 */
export default function MemoryManager({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<"memory" | "world">("memory");
  const [items, setItems] = useState<(MemoryRecord | WorldRecord)[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [keyName, setKeyName] = useState("");
  const [content, setContent] = useState("");
  const [predicate, setPredicate] = useState("");

  const reload = useCallback(async (target: "memory" | "world") => {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/jarvis/memory?kind=${target}&limit=50`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.records)) throw new Error(data.error || "Memory unavailable.");
      setItems(data.records);
    } catch (e) {
      setItems([]);
      setMessage(e instanceof Error ? e.message : "Memory unavailable.");
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { void reload(kind); }, [kind, reload]);

  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const input = kind === "memory"
        ? { kind, key: keyName, content, dataClass: "LOCAL_PRIVATE" }
        : { kind, subject: keyName, predicate, value: content, source: "USER_REPORTED" };
      const res = await fetch("/api/jarvis/memory", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save record.");
      setKeyName(""); setContent(""); setPredicate("");
      setMessage(kind === "memory" ? "Private memory saved." : "Unverified owner observation recorded.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Save failed."); }
    finally { setBusy(false); void reload(kind); }
  }

  async function retract(id: string) {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const res = await fetch("/api/jarvis/memory", {
        method: "DELETE", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({kind:kind === "memory" ? "memory" : "observation", id}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not retract.");
      setItems(previous => previous.filter(x => x.id !== id));
      setMessage("Record retracted from active memory.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Retraction failed."); }
    finally { setBusy(false); }
  }

  return (
    <section aria-label="JARVIS memory manager" style={{ padding: 16, overflowY: "auto", height: "100%" }}>
      <header style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <strong>MEMORY & WORLD MODEL</strong>
        <button type="button" onClick={onClose}>RETURN TO CHAT</button>
      </header>
      <p style={{ fontSize: 12, opacity: 0.8 }}>
        These owner-managed records are private to this JARVIS instance. They are not automatically included in model requests.
        World observations entered here are user-reported, not independently verified facts.
      </p>
      <div style={{ display: "flex", gap: 8, marginBlock: 12 }}>
        <button type="button" aria-pressed={kind === "memory"} onClick={() => {setKind("memory");setItems([]);}}>Private memory</button>
        <button type="button" aria-pressed={kind === "world"} onClick={() => {setKind("world");setItems([]);}}>World observations</button>
      </div>
      <form onSubmit={submit} style={{ display: "grid", gap: 10 }}>
        <input required maxLength={128} value={keyName} onChange={e => setKeyName(e.target.value)} placeholder={kind === "memory" ? "Memory key (e.g. project.goal)" : "Subject (e.g. my-application)"} aria-label="Memory key or observation subject" />
        {kind === "world" && <input required maxLength={128} value={predicate} onChange={e => setPredicate(e.target.value)} placeholder="Predicate (e.g. window_open)" aria-label="Observation predicate" />}
        <textarea required maxLength={4000} rows={3} value={content} onChange={e => setContent(e.target.value)} placeholder={kind === "memory" ? "Approved personal memory" : "What you observed (unverified)"} aria-label="Record content" />
        <button disabled={busy} type="submit">{busy ? "WORKING…" : "SAVE RECORD"}</button>
      </form>
      {message && <p role="status">{message}</p>}
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10, marginTop: 12 }}>
        {items.map(item => <li key={item.id} style={{ border: "1px solid rgba(180,180,180,.25)", borderRadius: 8, padding: 10 }}>
          {"key" in item
            ? <><strong>{item.key}</strong><p>{item.content}</p><small>{item.dataClass}</small></>
            : <><strong>{item.subject} / {item.predicate}</strong><p>{item.value}</p><small>{item.source}{item.stale ? " · STALE" : " · CURRENT REPORT"}</small></>}
          <div><button disabled={busy} type="button" onClick={() => void retract(item.id)}>RETRACT</button></div>
        </li>)}
      </ul>
    </section>
  );
}
