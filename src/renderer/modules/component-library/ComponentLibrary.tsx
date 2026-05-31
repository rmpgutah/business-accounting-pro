// src/renderer/modules/component-library/ComponentLibrary.tsx
//
// Showcase / gallery for the ~150-component UI library under
// src/renderer/components/library/. Every library component is a pure
// presentational React function that renders with zero props, so the
// gallery can render each one bare. Components are grouped by their source
// module and filterable by name.

import React, { useMemo, useState } from 'react';
import { Search, LayoutGrid } from 'lucide-react';

import * as accounting from '../../components/library/accounting';
import * as advancedInputs from '../../components/library/advanced-inputs';
import * as alerts from '../../components/library/alerts';
import * as arAp from '../../components/library/ar-ap';
import * as badgesPills from '../../components/library/badges-pills';
import * as buttons from '../../components/library/buttons';
import * as cards from '../../components/library/cards';
import * as chartsBar from '../../components/library/charts-bar';
import * as chartsCircular from '../../components/library/charts-circular';
import * as chartsLine from '../../components/library/charts-line';
import * as command from '../../components/library/command';
import * as containers from '../../components/library/containers';
import * as emptyStates from '../../components/library/empty-states';
import * as formFields from '../../components/library/form-fields';
import * as headers from '../../components/library/headers';
import * as hero from '../../components/library/hero';
import * as indicators from '../../components/library/indicators';
import * as invoiceUi from '../../components/library/invoice-ui';
import * as loading from '../../components/library/loading';
import * as money from '../../components/library/money';
import * as navMisc from '../../components/library/nav-misc';
import * as people from '../../components/library/people';
import * as progressViz from '../../components/library/progress-viz';
import * as statCards from '../../components/library/stat-cards';
import * as statusFeedback from '../../components/library/status-feedback';
import * as structure from '../../components/library/structure';
import * as tables from '../../components/library/tables';
import * as tabs from '../../components/library/tabs';
import * as toggles from '../../components/library/toggles';
import * as utility from '../../components/library/utility';

type Mod = Record<string, unknown>;

const GROUPS: Array<{ label: string; mod: Mod }> = [
  { label: 'Stat Cards', mod: statCards },
  { label: 'Progress & Gauges', mod: progressViz },
  { label: 'Charts — Bar', mod: chartsBar },
  { label: 'Charts — Line', mod: chartsLine },
  { label: 'Charts — Circular', mod: chartsCircular },
  { label: 'Tables', mod: tables },
  { label: 'Badges & Pills', mod: badgesPills },
  { label: 'Indicators', mod: indicators },
  { label: 'Empty States', mod: emptyStates },
  { label: 'Loading', mod: loading },
  { label: 'Alerts', mod: alerts },
  { label: 'Status Feedback', mod: statusFeedback },
  { label: 'Buttons', mod: buttons },
  { label: 'Form Fields', mod: formFields },
  { label: 'Toggles', mod: toggles },
  { label: 'Advanced Inputs', mod: advancedInputs },
  { label: 'Command', mod: command },
  { label: 'Tabs', mod: tabs },
  { label: 'Navigation', mod: navMisc },
  { label: 'Headers', mod: headers },
  { label: 'Cards', mod: cards },
  { label: 'Containers', mod: containers },
  { label: 'Structure', mod: structure },
  { label: 'Invoice UI', mod: invoiceUi },
  { label: 'AR / AP', mod: arAp },
  { label: 'Accounting', mod: accounting },
  { label: 'Money', mod: money },
  { label: 'Hero', mod: hero },
  { label: 'People', mod: people },
  { label: 'Utility', mod: utility },
];

// A library export is renderable if it's a function whose name starts with an
// uppercase letter (component), excluding Props interfaces (erased at runtime).
function componentEntries(mod: Mod): Array<[string, React.ComponentType]> {
  return Object.entries(mod)
    .filter(([name, val]) => typeof val === 'function' && /^[A-Z]/.test(name))
    .map(([name, val]) => [name, val as React.ComponentType]);
}

class CellBoundary extends React.Component<
  { name: string; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return <span className="text-xs text-text-muted">⚠ {this.props.name} failed to render</span>;
    }
    return <>{this.props.children}</>;
  }
}

export default function ComponentLibrary() {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GROUPS.map((g) => ({
      label: g.label,
      items: componentEntries(g.mod).filter(([name]) => !q || name.toLowerCase().includes(q)),
    })).filter((g) => g.items.length > 0);
  }, [query]);

  const total = useMemo(
    () => GROUPS.reduce((n, g) => n + componentEntries(g.mod).length, 0),
    []
  );
  const shown = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <LayoutGrid size={22} className="text-accent-blue" />
          <div>
            <h1 className="text-xl font-bold text-text-primary">Component Library</h1>
            <p className="text-sm text-text-muted">
              {shown} of {total} components{query ? ` matching “${query}”` : ''} · {GROUPS.length} groups
            </p>
          </div>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            className="block-input pl-9 text-sm"
            placeholder="Filter components…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ minWidth: 240 }}
          />
        </div>
      </div>

      {groups.map((g) => (
        <section key={g.label} className="space-y-3">
          <h2
            className="text-xs font-semibold uppercase tracking-wider text-text-muted pb-2"
            style={{ borderBottom: '1px solid var(--color-border-primary)' }}
          >
            {g.label} <span className="text-text-muted">({g.items.length})</span>
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {g.items.map(([name, Comp]) => (
              <div key={name} className="block-card p-4 flex flex-col gap-3" style={{ borderRadius: 6 }}>
                <span className="text-[10px] font-mono text-text-muted uppercase tracking-wide">{name}</span>
                <div className="flex-1 flex items-center justify-center min-h-[64px] overflow-hidden">
                  <CellBoundary name={name}>
                    <Comp />
                  </CellBoundary>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
