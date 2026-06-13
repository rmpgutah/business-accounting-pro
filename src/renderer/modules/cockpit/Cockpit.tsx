import React, { useEffect } from 'react';
import { LayoutGrid, Pencil, RotateCcw } from 'lucide-react';
import { useCockpitLayoutStore } from './cockpitLayoutStore';
import { useWidgetData } from './widgets/useWidgetData';
import { widgetDef, WIDGET_DEFS } from './widgets/registry';
import WidgetFrame from './widgets/WidgetFrame';
import WidgetBody from './widgets/WidgetBody';
import { GRID_COLS, pixelToCell } from './layout-utils';
import { useAppStore } from '../../stores/appStore';
import { useAuthStore } from '../../stores/authStore';
import { useCompanyStore } from '../../stores/companyStore';

const ROW_H = 88; // px per grid row

const DRILL: Record<string, string> = {
  'ar-aging': 'invoicing', 'ap-aging': 'bills', 'top-clients': 'clients',
  'anomalies': 'expenses', 'cash-forecast': 'reports', 'kpis': 'dashboard',
};

const WidgetSlot: React.FC<{ p: any; editing: boolean; onDragStart?: () => void }> = ({ p, editing, onDragStart }) => {
  const def = widgetDef(p.type);
  const { data, loading } = useWidgetData(p.type);
  const setModule = useAppStore((s) => s.setModule);
  const removeWidget = useCockpitLayoutStore((s) => s.removeWidget);
  if (!def) return null;
  return (
    <div style={{ gridColumn: `${p.x + 1} / span ${p.w}`, gridRow: `${p.y + 1} / span ${p.h}` }}>
      <WidgetFrame title={def.title} accent={def.accent} editing={editing}
        onRemove={() => removeWidget(p.id)} onOpen={() => setModule(DRILL[p.type] || 'dashboard')}
        dragHandleProps={editing ? { draggable: true, onDragStart } : undefined}>
        <WidgetBody type={p.type} data={data} loading={loading} />
      </WidgetFrame>
    </div>
  );
};

const Cockpit: React.FC = () => {
  const { layout, editing, setEditing, addWidget, resetLayout, updatePlacement, loadFromCloud, saveToCloud } = useCockpitLayoutStore();
  const user = useAuthStore((s) => s.user);
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const gridRef = React.useRef<HTMLDivElement>(null);
  const dragId = React.useRef<string | null>(null);

  useEffect(() => { if (user?.id && activeCompany?.id) loadFromCloud(user.id, activeCompany.id); }, [user?.id, activeCompany?.id]);

  const persist = () => { if (user?.id && activeCompany?.id) saveToCloud(user.id, activeCompany.id); };

  const onGridDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragId.current || !gridRef.current) return;
    const rect = gridRef.current.getBoundingClientRect();
    const { x, y } = pixelToCell(e.clientX - rect.left, e.clientY - rect.top, rect.width, ROW_H, GRID_COLS);
    updatePlacement(dragId.current, { x, y });
    dragId.current = null;
    persist();
  };

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2 text-text-primary"><LayoutGrid size={18} /><h1 className="text-lg font-bold">Intelligence Cockpit</h1></div>
        <div className="flex items-center gap-2">
          {editing && (
            <select className="block-input text-xs" defaultValue="" onChange={(e) => { if (e.target.value) { addWidget(e.target.value); e.target.value = ''; } }}>
              <option value="" disabled>＋ Add widget…</option>
              {WIDGET_DEFS.map(w => <option key={w.type} value={w.type}>{w.title}</option>)}
            </select>
          )}
          {editing && <button className="block-btn flex items-center gap-1 text-xs" onClick={resetLayout}><RotateCcw size={12} /> Reset</button>}
          <button className={`block-btn flex items-center gap-1 text-xs ${editing ? 'text-accent-income' : ''}`}
            onClick={() => { if (editing) persist(); setEditing(!editing); }}>
            <Pencil size={12} /> {editing ? 'Done' : 'Edit'}
          </button>
        </div>
      </div>
      <div ref={gridRef} onDragOver={(e) => e.preventDefault()} onDrop={onGridDrop}
        style={{ display: 'grid', gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`, gridAutoRows: `${ROW_H}px`, gap: '12px' }}>
        {layout.map(p => <WidgetSlot key={p.id} p={p} editing={editing} onDragStart={() => { dragId.current = p.id; }} />)}
      </div>
    </div>
  );
};

export default Cockpit;
