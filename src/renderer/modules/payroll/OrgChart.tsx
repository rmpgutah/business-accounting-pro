import React, { useEffect, useMemo, useState } from 'react';
import { Network, Users } from 'lucide-react';
import api from '../../lib/api';

interface OrgEmployee {
  id: string;
  name: string;
  job_title: string;
  manager_id: string | null;
  manager_name: string | null;
  department_id: string | null;
  department_name: string | null;
}

interface OrgNode extends OrgEmployee {
  children: OrgNode[];
}

function buildTree(employees: OrgEmployee[]): OrgNode[] {
  const byId = new Map<string, OrgNode>();
  for (const e of employees) byId.set(e.id, { ...e, children: [] });

  const roots: OrgNode[] = [];
  for (const e of employees) {
    const node = byId.get(e.id)!;
    if (e.manager_id && byId.has(e.manager_id)) {
      byId.get(e.manager_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

const OrgChartNode: React.FC<{ node: OrgNode; onSelect: (id: string) => void; depth: number }> = ({ node, onSelect, depth }) => (
  <div style={{ marginLeft: depth === 0 ? 0 : 20 }}>
    <button
      className="block-card p-2.5 flex items-center gap-2 w-full text-left hover:border-accent-blue transition-colors"
      style={{ borderRadius: '6px' }}
      onClick={() => onSelect(node.id)}
    >
      <Users size={14} className="text-accent-blue shrink-0" />
      <div className="min-w-0">
        <div className="text-xs font-semibold text-text-primary truncate">{node.name}</div>
        <div className="text-[10px] text-text-muted truncate">
          {node.job_title || 'No title'}{node.department_name ? ` · ${node.department_name}` : ''}
        </div>
      </div>
    </button>
    {node.children.length > 0 && (
      <div className="mt-2 space-y-2 border-l border-border-secondary pl-3">
        {node.children.map((child) => (
          <OrgChartNode key={child.id} node={child} onSelect={onSelect} depth={depth + 1} />
        ))}
      </div>
    )}
  </div>
);

interface OrgChartProps {
  onSelectEmployee: (id: string) => void;
}

const OrgChart: React.FC<OrgChartProps> = ({ onSelectEmployee }) => {
  const [employees, setEmployees] = useState<OrgEmployee[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.hrOrgChart().then((rows: any) => {
      if (!cancelled) setEmployees(Array.isArray(rows) ? rows : []);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const tree = useMemo(() => buildTree(employees), [employees]);

  if (loading) {
    return <div className="p-6 text-xs font-mono text-text-muted">Loading org chart...</div>;
  }

  if (employees.length === 0) {
    return (
      <div className="p-6 flex flex-col items-center gap-2 text-text-muted">
        <Network size={24} />
        <span className="text-xs">No active employees to display.</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-3 overflow-auto">
      {tree.map((root) => (
        <OrgChartNode key={root.id} node={root} onSelect={onSelectEmployee} depth={0} />
      ))}
    </div>
  );
};

export default OrgChart;
