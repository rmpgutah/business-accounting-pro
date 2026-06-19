import React, { useState, useCallback } from 'react';
import { ShieldCheck, AlertTriangle, RefreshCw, Wrench, Database } from 'lucide-react';
import api from '../../lib/api';

/**
 * P1.15/P1.16/P1.17 — Database Integrity Check UI
 *
 * Surfaces the same integrity-check service that runs nightly via
 * cron. Users can trigger it on-demand to spot:
 *   • Schema drift (tables missing from the company-id exemption set)
 *   • Orphan FK references (rows pointing at deleted parents)
 *   • PRAGMA integrity_check / foreign_key_check failures
 *
 * One-click cleanup NULLs out orphan FK columns. VACUUM is also
 * exposed as a manual trigger — runs weekly automatically, but
 * the user might want to reclaim space after a big delete.
 */

interface CheckResult {
  ok: boolean;
  ranAt: string;
  pragmaIntegrity: string[];
  pragmaFkCheck: any[];
  schemaDrift: { missingFromExemption: string[]; staleExemption: string[] };
  orphans: Record<string, { count: number; sampleIds: string[] }>;
  durationMs: number;
}

const IntegritySettings: React.FC = () => {
  const [running, setRunning] = useState(false);
  const [vacuuming, setVacuuming] = useState(false);
  const [cleaning, setCleaning] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);

  const runCheck = useCallback(async () => {
    setRunning(true);
    try {
      const r = await api.integrityCheck();
      setResult(r);
    } finally {
      setRunning(false);
    }
  }, []);

  const cleanup = useCallback(async (target: string) => {
    if (!confirm('Cleanup will NULL out the foreign-key column on orphaned rows in "' + target + '". This cannot be undone. Continue?')) return;
    setCleaning(target);
    try {
      const r = await api.integrityCleanupOrphans(target);
      if (r.error) alert('Cleanup failed: ' + r.error);
      else alert('Cleaned ' + r.cleaned + ' row(s).');
      await runCheck();
    } finally {
      setCleaning(null);
    }
  }, [runCheck]);

  const vacuum = useCallback(async () => {
    if (!confirm('VACUUM rewrites the entire database file to reclaim space. Takes a few seconds. Continue?')) return;
    setVacuuming(true);
    try {
      const r = await api.integrityVacuum();
      if (!r.ok) alert('VACUUM failed: ' + (r.error || 'unknown'));
      else {
        const reclaimed = Math.max(0, r.sizeBefore - r.sizeAfter);
        const mb = (b: number) => (b / 1024 / 1024).toFixed(2);
        alert('VACUUM complete. Reclaimed ' + mb(reclaimed) + ' MB (' + mb(r.sizeBefore) + ' → ' + mb(r.sizeAfter) + ' MB).');
      }
    } finally {
      setVacuuming(false);
    }
  }, []);

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900 }}>
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
          <ShieldCheck size={22} />
          Database Integrity
        </h2>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          Verifies database health: schema drift, orphan foreign-key references, and SQLite's internal integrity check. Runs nightly automatically.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={runCheck} disabled={running} className="block-btn flex items-center gap-2">
          {running ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {running ? 'Checking…' : 'Run Check Now'}
        </button>
        <button onClick={vacuum} disabled={vacuuming} className="block-btn flex items-center gap-2">
          <Database size={14} />
          {vacuuming ? 'Vacuuming…' : 'VACUUM Database'}
        </button>
      </div>

      {result && (
        <div className="block-card" style={{ padding: 16, borderLeft: '3px solid ' + (result.ok ? 'var(--color-positive)' : 'var(--color-warning, #d97706)') }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            {result.ok ? (
              <ShieldCheck size={16} style={{ color: 'var(--color-positive)' }} />
            ) : (
              <AlertTriangle size={16} style={{ color: 'var(--color-warning, #d97706)' }} />
            )}
            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-text-primary)' }}>
              {result.ok ? 'All checks passed' : 'Issues found'}
            </span>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              · {result.durationMs}ms · {new Date(result.ranAt).toLocaleString()}
            </span>
          </div>

          {/* PRAGMA integrity_check */}
          {result.pragmaIntegrity.length > 0 && result.pragmaIntegrity[0] !== 'ok' && (
            <div style={{ marginTop: 8, fontSize: 12 }}>
              <div style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>PRAGMA integrity_check</div>
              <ul style={{ margin: '4px 0 0 18px', listStyle: 'disc', color: 'var(--color-text-muted)' }}>
                {result.pragmaIntegrity.map((m, i) => <li key={i} style={{ fontSize: 11 }}>{m}</li>)}
              </ul>
            </div>
          )}

          {/* Schema drift */}
          {result.schemaDrift.missingFromExemption.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12 }}>
              <div style={{ fontWeight: 700, color: 'var(--color-warning, #d97706)' }}>
                Tables missing from company-id exemption ({result.schemaDrift.missingFromExemption.length})
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                Add to <code>tablesWithoutCompanyId</code> in <code>src/main/ipc/index.ts</code> to prevent <code>db:create</code> crashes.
              </div>
              <ul style={{ margin: '4px 0 0 18px', listStyle: 'disc', color: 'var(--color-text-muted)' }}>
                {result.schemaDrift.missingFromExemption.map((t) => <li key={t} style={{ fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace' }}>{t}</li>)}
              </ul>
            </div>
          )}
          {result.schemaDrift.staleExemption.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12 }}>
              <div style={{ fontWeight: 700, color: 'var(--color-text-muted)' }}>
                Stale exemptions ({result.schemaDrift.staleExemption.length})
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                These tables now have a <code>company_id</code> column but are still on the exemption list. Safe to remove.
              </div>
              <ul style={{ margin: '4px 0 0 18px', listStyle: 'disc', color: 'var(--color-text-muted)' }}>
                {result.schemaDrift.staleExemption.map((t) => <li key={t} style={{ fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace' }}>{t}</li>)}
              </ul>
            </div>
          )}

          {/* Orphan FKs */}
          {Object.keys(result.orphans).length > 0 && (
            <div style={{ marginTop: 12, fontSize: 12 }}>
              <div style={{ fontWeight: 700, color: 'var(--color-warning, #d97706)', marginBottom: 4 }}>
                Orphan foreign-key references ({Object.keys(result.orphans).length} relationships)
              </div>
              {Object.entries(result.orphans).map(([target, info]) => (
                <div key={target} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px dashed var(--color-border-primary)' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: 'SF Mono, Menlo, monospace', fontSize: 11, color: 'var(--color-text-primary)' }}>{target}</div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                      {info.count} orphan{info.count === 1 ? '' : 's'} · sample: {info.sampleIds.slice(0, 3).join(', ')}
                    </div>
                  </div>
                  <button
                    onClick={() => cleanup(target)}
                    disabled={cleaning === target}
                    className="block-btn text-xs flex items-center gap-1.5"
                    style={{ color: 'var(--color-warning, #d97706)', borderColor: 'var(--color-warning, #d97706)' }}
                  >
                    <Wrench size={11} />
                    {cleaning === target ? 'Cleaning…' : 'NULL the FK'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* PRAGMA foreign_key_check */}
          {result.pragmaFkCheck.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12 }}>
              <div style={{ fontWeight: 700, color: 'var(--color-warning, #d97706)' }}>
                FK constraint violations ({result.pragmaFkCheck.length})
              </div>
              <ul style={{ margin: '4px 0 0 18px', listStyle: 'disc', color: 'var(--color-text-muted)' }}>
                {result.pragmaFkCheck.slice(0, 10).map((v: any, i: number) => (
                  <li key={i} style={{ fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace' }}>
                    {v.table}.{v.fkid} → rowid {v.rowid} (parent: {v.parent})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default IntegritySettings;
