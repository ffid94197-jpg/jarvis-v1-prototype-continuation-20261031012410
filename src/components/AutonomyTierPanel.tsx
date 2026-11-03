'use client';
/**
 * NEXUS Settings — owner autonomy tier (Part 9).
 *
 * This panel is wired to the real runtime: it reads the profile that
 * src/app/api/jarvis/autonomy/route.ts resolves durably for the authenticated
 * owner, and saving writes the row that src/app/api/jarvis/task/route.ts reads
 * when deriving the next run's step budget and the Core's in-scope replan
 * budget. It is not a decorative toggle.
 *
 * It also states plainly what the control CANNOT do, because that is the part an
 * owner is most likely to assume: raising the tier does not grant a permission.
 */
import { useCallback, useEffect, useState } from 'react';

interface Profile { tier: string; stepBudget: number; replanBudget: number; repeatLimit: number }
interface AutonomyState {
  tier: string;
  profile: Profile;
  source: string;
  warnings: string[];
  untrustedRowIgnored: boolean;
  updatedAt: string | null;
  availableTiers: string[];
  tierPreviews: Profile[];
  limits: { maxStepsHardCeiling: number; repeatLimitFixedAcrossAllTiers: number };
  notice: string;
}

const TIER_LABELS: Record<string, string> = {
  normal: 'NORMAL — confirm each strategy change',
  advanced: 'ADVANCED AUTONOMY — replan within scope',
  full: 'FULL AUTONOMY — persist until verified or genuinely blocked',
};

const box = { display: 'grid', gap: 10, padding: 12, border: '1px solid #6b471c' } as const;
const buttonStyle = { background: '#2b1c09', border: '1px solid #986c2b', color: '#ffca62', padding: '7px 10px', cursor: 'pointer' } as const;
const rowStyle = { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' as const };

export default function AutonomyTierPanel() {
  const [state, setState] = useState<AutonomyState | null>(null);
  const [chosen, setChosen] = useState<string>('normal');
  const [stepBudget, setStepBudget] = useState<number>(12);
  const [replanBudget, setReplanBudget] = useState<number>(2);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/jarvis/autonomy', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw Error(body.error ?? `HTTP ${res.status}`);
      setState(body as AutonomyState);
      setChosen(body.tier as string);
      setStepBudget((body.profile as Profile).stepBudget);
      setReplanBudget((body.profile as Profile).replanBudget);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Autonomy service unavailable.');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const preview = state?.tierPreviews.find((p) => p.tier === chosen);
  const save = async () => {
    if (busy) return;
    setBusy(true); setError(''); setSaved('');
    try {
      const res = await fetch('/api/jarvis/autonomy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: chosen, stepBudget, replanBudget }),
      });
      const body = await res.json();
      if (!res.ok) throw Error(body.error ?? `HTTP ${res.status}`);
      setSaved(body.notice ?? 'Saved.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the autonomy tier.');
    } finally {
      setBusy(false);
    }
  };

  if (error && !state) {
    return <div style={box} aria-label="Autonomy tier unavailable">
      <h3>Autonomy Tier</h3>
      <p role="alert">{error}</p>
      <button type="button" style={buttonStyle} onClick={() => void refresh()}>RETRY</button>
    </div>;
  }

  return (
    <section style={box} aria-label="Owner autonomy tier">
      <h3>Autonomy Tier</h3>
      <p style={{ fontSize: 12 }}>
        Controls how long JARVIS keeps working on an objective that is already authorized, and how many
        times it may replan within scope after a strategy fails. It does not decide what is allowed.
      </p>

      {state && <p style={{ fontSize: 12 }} role="status">
        In effect now: <strong>{state.tier.toUpperCase()}</strong>
        {' '}· step budget {state.profile.stepBudget}
        {' '}· in-scope replans {state.profile.replanBudget}
        {' '}· source: {state.source}
        {state.updatedAt ? ` · updated ${state.updatedAt}` : ''}
      </p>}

      {state && state.warnings.length > 0 && <ul aria-label="Autonomy configuration warnings" style={{ fontSize: 12 }}>
        {state.warnings.map((w) => <li key={w} role="status">{w}</li>)}
      </ul>}
      {state?.untrustedRowIgnored && <p role="alert" style={{ fontSize: 12 }}>
        A stored autonomy value that was not written by an explicit owner action was IGNORED.
        Model output and tool output cannot raise autonomy.
      </p>}

      <fieldset style={{ border: '1px solid #6b471c', padding: 10 }}>
        <legend style={{ fontSize: 12 }}>Tier</legend>
        {(state?.availableTiers ?? ['normal', 'advanced', 'full']).map((tier) => {
          const p = state?.tierPreviews.find((x) => x.tier === tier);
          return <label key={tier} style={{ ...rowStyle, fontSize: 12 }}>
            <input type="radio" name="autonomy-tier" value={tier} checked={chosen === tier}
              onChange={() => {
                setChosen(tier);
                if (p) { setStepBudget(p.stepBudget); setReplanBudget(p.replanBudget); }
              }} />
            <span>{TIER_LABELS[tier] ?? tier}</span>
            {p && <small>({p.stepBudget} steps · {p.replanBudget} replans)</small>}
          </label>;
        })}
      </fieldset>

      <div style={rowStyle}>
        <label style={{ fontSize: 12 }}>Continuous step budget
          <input type="number" min={1} max={preview?.stepBudget ?? state?.limits.maxStepsHardCeiling ?? 48}
            value={stepBudget} onChange={(e) => setStepBudget(Number(e.target.value))} style={{ width: 90 }} />
        </label>
        <label style={{ fontSize: 12 }}>In-scope replans
          <input type="number" min={0} max={preview?.replanBudget ?? 4}
            value={replanBudget} onChange={(e) => setReplanBudget(Number(e.target.value))} style={{ width: 90 }} />
        </label>
      </div>
      <small>Values above the selected tier&rsquo;s maximum are clamped server-side and reported back to you.</small>

      <div style={rowStyle}>
        <button type="button" style={buttonStyle} onClick={() => void save()} disabled={busy}>
          {busy ? 'SAVING…' : 'SAVE AUTONOMY TIER'}
        </button>
        <button type="button" style={buttonStyle} onClick={() => void refresh()} disabled={busy}>REFRESH</button>
      </div>
      {saved && <p role="status" style={{ fontSize: 12 }}>{saved}</p>}
      {error && <p role="alert" style={{ fontSize: 12 }}>{error}</p>}

      <div style={{ borderTop: '1px solid #6b471c', paddingTop: 8, fontSize: 12 }}>
        <p><strong>What this does not do.</strong> {state?.notice ??
          'The autonomy tier grants no permission. Guardian authorizes every tool call independently, and destructive, irreversible, financial or out-of-scope actions still require explicit authorization at every tier.'}</p>
        <p>
          Identical unverified actions stop after {state?.limits.repeatLimitFixedAcrossAllTiers ?? 3} repeats at
          <em> every</em> tier — that watchdog is a safety property and is not adjustable here.
          Absolute ceiling: {state?.limits.maxStepsHardCeiling ?? 48} steps per run.
        </p>
        <p>
          A run that reaches its budget is durably <em>paused</em>, not failed: progress is recorded and the same
          task can be resumed without redoing completed steps. JARVIS stops only on a verified completion, an owner
          cancel or emergency stop, or a genuine blocker it reports honestly.
        </p>
      </div>
    </section>
  );
}
