// src/renderer/components/TagManager.tsx
//
// Admin UI: list / create / rename / merge / soft-delete tags + groups,
// configure tag rules, view usage analytics, and CSV import/export.

import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Edit2, Merge, RefreshCw, Download, Upload, Tag as TagIcon, Settings as SettingsIcon, BarChart2 } from 'lucide-react';
import api from '../lib/api';
import { useCompanyStore } from '../stores/companyStore';
import { TagChip, TAG_PALETTE, type TagRecord } from './TagPicker';

interface TagGroup {
  id: string;
  company_id: string;
  name: string;
  color: string;
  allow_multiple: number;
  sort_order: number;
}

interface TagRule {
  id: string;
  company_id: string;
  name: string;
  entity_type: string;
  when_condition_json: string;
  then_apply_tag_id: string;
  is_active: number;
}

const ENTITY_TYPES = [
  'invoice', 'expense', 'client', 'vendor', 'project', 'debt', 'bill',
  'purchase_order', 'employee', 'account', 'journal_entry', 'asset', 'inventory_item',
];

const TagManager: React.FC = () => {
  const company = useCompanyStore(s => s.activeCompany);
  const [tab, setTab] = useState<'tags' | 'groups' | 'rules' | 'analytics'>('tags');
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [groups, setGroups] = useState<TagGroup[]>([]);
  const [rules, setRules] = useState<TagRule[]>([]);
  const [usage, setUsage] = useState<any[]>([]);
  const [showDeleted, setShowDeleted] = useState(false);
  const [mergeMode, setMergeMode] = useState<{ source: string | null }>({ source: null });

  const refresh = async () => {
    if (!company?.id) return;
    const [t, g, r, u] = await Promise.all([
      api.tagsList(company.id, showDeleted),
      api.tagsGroupsList(company.id),
      api.tagsRulesList(company.id),
      api.tagsUsageStats(company.id),
    ]);
    if (Array.isArray(t)) setTags(t);
    if (Array.isArray(g)) setGroups(g);
    if (Array.isArray(r)) setRules(r);
    if (Array.isArray(u)) setUsage(u);
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [company?.id, showDeleted]);

  const groupMap = useMemo(() => new Map(groups.map(g => [g.id, g])), [groups]);

  // Tag CRUD
  const handleCreateTag = async () => {
    const name = window.prompt('Tag name?');
    if (!name?.trim() || !company?.id) return;
    const color = TAG_PALETTE[Math.floor(Math.random() * TAG_PALETTE.length)];
    await api.tagsCreate({ company_id: company.id, name: name.trim(), color });
    refresh();
  };

  const handleRename = async (t: TagRecord) => {
    const name = window.prompt('Rename tag', t.name);
    if (!name?.trim()) return;
    await api.tagsRename(t.id, name.trim());
    refresh();
  };

  const handleColor = async (t: TagRecord) => {
    const color = window.prompt('Hex color (e.g. #3b82f6)', t.color);
    if (!color) return;
    await api.tagsUpdate(t.id, { color });
    refresh();
  };

  const handleAssignGroup = async (t: TagRecord) => {
    const choices = ['(none)', ...groups.map(g => g.name)].map((n, i) => `${i}: ${n}`).join('\n');
    const pick = window.prompt(`Group?\n${choices}`, '0');
    if (pick === null) return;
    const idx = Number(pick);
    const group_id = idx === 0 ? null : groups[idx - 1]?.id ?? null;
    await api.tagsUpdate(t.id, { group_id });
    refresh();
  };

  const handleSoftDelete = async (t: TagRecord) => {
    if (!window.confirm(`Soft-delete "${t.name}"? (assignments preserved)`)) return;
    await api.tagsSoftDelete(t.id);
    refresh();
  };

  const handleRestore = async (t: TagRecord) => {
    await api.tagsRestore(t.id);
    refresh();
  };

  const handleMerge = async (target: TagRecord) => {
    if (!mergeMode.source) { setMergeMode({ source: target.id }); return; }
    if (mergeMode.source === target.id) { setMergeMode({ source: null }); return; }
    const src = tags.find(t => t.id === mergeMode.source);
    if (!src) { setMergeMode({ source: null }); return; }
    if (!window.confirm(`Merge "${src.name}" into "${target.name}"? "${src.name}" will be deleted.`)) {
      setMergeMode({ source: null }); return;
    }
    await api.tagsMerge(src.id, target.id);
    setMergeMode({ source: null });
    refresh();
  };

  // Group CRUD
  const handleCreateGroup = async () => {
    const name = window.prompt('Group name?');
    if (!name?.trim() || !company?.id) return;
    const allow = window.confirm('Allow multiple selection? OK = multi, Cancel = single');
    await api.tagsGroupCreate({ company_id: company.id, name: name.trim(), color: '#6b7280', allow_multiple: allow ? 1 : 0 });
    refresh();
  };

  const handleDeleteGroup = async (g: TagGroup) => {
    if (!window.confirm(`Delete group "${g.name}"? Tags will be ungrouped.`)) return;
    await api.tagsGroupDelete(g.id);
    refresh();
  };

  // Rules CRUD
  const handleCreateRule = async () => {
    if (!company?.id || !tags.length) { window.alert('Create at least one tag first'); return; }
    const name = window.prompt('Rule name?');
    if (!name) return;
    const entityType = window.prompt(`Entity type? (${ENTITY_TYPES.join('/')})`, 'invoice');
    if (!entityType || !ENTITY_TYPES.includes(entityType)) return;
    const cond = window.prompt('Condition JSON (e.g. {"all":[{"field":"status","op":"=","value":"overdue"}]})', '{"all":[{"field":"status","op":"=","value":""}]}');
    if (!cond) return;
    const tagChoices = tags.map((t, i) => `${i}: ${t.name}`).join('\n');
    const pick = window.prompt(`Apply tag?\n${tagChoices}`, '0');
    if (pick === null) return;
    const tag = tags[Number(pick)];
    if (!tag) return;
    await api.tagsRuleCreate({
      company_id: company.id, name, entity_type: entityType,
      when_condition_json: cond, then_apply_tag_id: tag.id, is_active: 1,
    });
    refresh();
  };

  const handleToggleRule = async (r: TagRule) => {
    await api.tagsRuleUpdate(r.id, { is_active: r.is_active ? 0 : 1 });
    refresh();
  };

  const handleDeleteRule = async (r: TagRule) => {
    if (!window.confirm(`Delete rule "${r.name}"?`)) return;
    await api.tagsRuleDelete(r.id);
    refresh();
  };

  // CSV
  const handleExport = async () => {
    if (!company?.id) return;
    const res = await api.tagsExportCsv(company.id);
    if (res?.csv) {
      const blob = new Blob([res.csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `tags-${company.id}.csv`; a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleImport = async () => {
    if (!company?.id) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const csv = await f.text();
      const res = await api.tagsImportCsv(company.id, csv);
      window.alert(res?.error ? `Error: ${res.error}` : `Imported ${res?.imported ?? 0} tags`);
      refresh();
    };
    input.click();
  };

  return (
    <div className="space-y-3">
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border-primary">
        {[
          { k: 'tags', icon: TagIcon, label: 'Tags' },
          { k: 'groups', icon: SettingsIcon, label: 'Groups' },
          { k: 'rules', icon: RefreshCw, label: 'Rules' },
          { k: 'analytics', icon: BarChart2, label: 'Analytics' },
        ].map(t => {
          const Icon = t.icon as any;
          const active = tab === t.k;
          return (
            <button
              key={t.k}
              type="button"
              onClick={() => setTab(t.k as any)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs ${active ? 'text-accent-blue border-b-2 border-accent-blue' : 'text-text-muted hover:text-text-primary'}`}
            >
              <Icon size={12} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'tags' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={handleCreateTag} className="px-2 py-1 bg-accent-blue text-white text-xs flex items-center gap-1" style={{ borderRadius: '3px' }}>
              <Plus size={12} /> New Tag
            </button>
            <button type="button" onClick={handleExport} className="px-2 py-1 bg-bg-tertiary border border-border-primary text-xs flex items-center gap-1" style={{ borderRadius: '3px' }}>
              <Download size={12} /> Export CSV
            </button>
            <button type="button" onClick={handleImport} className="px-2 py-1 bg-bg-tertiary border border-border-primary text-xs flex items-center gap-1" style={{ borderRadius: '3px' }}>
              <Upload size={12} /> Import CSV
            </button>
            <label className="text-xs text-text-muted flex items-center gap-1 ml-auto">
              <input type="checkbox" checked={showDeleted} onChange={e => setShowDeleted(e.target.checked)} />
              Show deleted
            </label>
            {mergeMode.source && (
              <span className="text-[11px] text-accent-amber">Pick target tag to merge into…</span>
            )}
          </div>
          <div className="block-card">
            <table className="w-full text-xs">
              <thead className="text-text-muted">
                <tr className="border-b border-border-primary">
                  <th className="text-left py-1.5 px-2">Tag</th>
                  <th className="text-left py-1.5 px-2">Group</th>
                  <th className="text-left py-1.5 px-2">Color</th>
                  <th className="text-right py-1.5 px-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tags.map(t => (
                  <tr key={t.id} className="border-b border-border-primary/50">
                    <td className="py-1 px-2"><TagChip tag={t} small /></td>
                    <td className="py-1 px-2 text-text-muted">{t.group_id ? groupMap.get(t.group_id)?.name : '—'}</td>
                    <td className="py-1 px-2"><span className="inline-block w-4 h-4" style={{ background: t.color }} /> <span className="text-text-muted">{t.color}</span></td>
                    <td className="py-1 px-2 text-right">
                      <div className="inline-flex gap-1">
                        <button type="button" onClick={() => handleRename(t)} className="text-text-muted hover:text-text-primary" title="Rename"><Edit2 size={12} /></button>
                        <button type="button" onClick={() => handleColor(t)} className="text-text-muted hover:text-text-primary" title="Color">●</button>
                        <button type="button" onClick={() => handleAssignGroup(t)} className="text-text-muted hover:text-text-primary" title="Group">G</button>
                        <button type="button" onClick={() => handleMerge(t)} className={`hover:text-text-primary ${mergeMode.source === t.id ? 'text-accent-amber' : 'text-text-muted'}`} title="Merge"><Merge size={12} /></button>
                        {(t as any).deleted_at
                          ? <button type="button" onClick={() => handleRestore(t)} className="text-text-muted hover:text-accent-green" title="Restore"><RefreshCw size={12} /></button>
                          : <button type="button" onClick={() => handleSoftDelete(t)} className="text-text-muted hover:text-accent-red" title="Delete"><Trash2 size={12} /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
                {!tags.length && <tr><td colSpan={4} className="py-4 px-2 text-center text-text-muted">No tags</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'groups' && (
        <div className="space-y-2">
          <button type="button" onClick={handleCreateGroup} className="px-2 py-1 bg-accent-blue text-white text-xs flex items-center gap-1" style={{ borderRadius: '3px' }}>
            <Plus size={12} /> New Group
          </button>
          <div className="block-card">
            <table className="w-full text-xs">
              <thead className="text-text-muted">
                <tr className="border-b border-border-primary">
                  <th className="text-left py-1.5 px-2">Name</th>
                  <th className="text-left py-1.5 px-2">Mode</th>
                  <th className="text-right py-1.5 px-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <tr key={g.id} className="border-b border-border-primary/50">
                    <td className="py-1 px-2 text-text-primary">{g.name}</td>
                    <td className="py-1 px-2 text-text-muted">{g.allow_multiple ? 'Multi-select' : 'Single-select'}</td>
                    <td className="py-1 px-2 text-right">
                      <button type="button" onClick={() => handleDeleteGroup(g)} className="text-text-muted hover:text-accent-red"><Trash2 size={12} /></button>
                    </td>
                  </tr>
                ))}
                {!groups.length && <tr><td colSpan={3} className="py-4 px-2 text-center text-text-muted">No groups</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'rules' && (
        <div className="space-y-2">
          <button type="button" onClick={handleCreateRule} className="px-2 py-1 bg-accent-blue text-white text-xs flex items-center gap-1" style={{ borderRadius: '3px' }}>
            <Plus size={12} /> New Rule
          </button>
          <p className="text-[11px] text-text-muted">Rules apply on entity create/update. Condition JSON shape: {`{"all": [{"field":"status","op":"=","value":"overdue"}]}`}</p>
          <div className="block-card">
            <table className="w-full text-xs">
              <thead className="text-text-muted">
                <tr className="border-b border-border-primary">
                  <th className="text-left py-1.5 px-2">Rule</th>
                  <th className="text-left py-1.5 px-2">Entity</th>
                  <th className="text-left py-1.5 px-2">Tag</th>
                  <th className="text-left py-1.5 px-2">Active</th>
                  <th className="text-right py-1.5 px-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map(r => {
                  const tag = tags.find(t => t.id === r.then_apply_tag_id);
                  return (
                    <tr key={r.id} className="border-b border-border-primary/50">
                      <td className="py-1 px-2 text-text-primary">{r.name}</td>
                      <td className="py-1 px-2 text-text-muted">{r.entity_type}</td>
                      <td className="py-1 px-2">{tag ? <TagChip tag={tag} small /> : <span className="text-text-muted">(missing)</span>}</td>
                      <td className="py-1 px-2">
                        <input type="checkbox" checked={!!r.is_active} onChange={() => handleToggleRule(r)} />
                      </td>
                      <td className="py-1 px-2 text-right">
                        <button type="button" onClick={() => handleDeleteRule(r)} className="text-text-muted hover:text-accent-red"><Trash2 size={12} /></button>
                      </td>
                    </tr>
                  );
                })}
                {!rules.length && <tr><td colSpan={5} className="py-4 px-2 text-center text-text-muted">No rules</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'analytics' && (
        <div className="block-card">
          <table className="w-full text-xs">
            <thead className="text-text-muted">
              <tr className="border-b border-border-primary">
                <th className="text-left py-1.5 px-2">Tag</th>
                <th className="text-right py-1.5 px-2">Usage</th>
                <th className="text-right py-1.5 px-2">Entity Types</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((u: any) => (
                <tr key={u.id} className="border-b border-border-primary/50">
                  <td className="py-1 px-2"><TagChip tag={u} small /></td>
                  <td className="py-1 px-2 text-right text-text-primary font-mono">{u.usage_count}</td>
                  <td className="py-1 px-2 text-right text-text-muted font-mono">{u.entity_type_count}</td>
                </tr>
              ))}
              {!usage.length && <tr><td colSpan={3} className="py-4 px-2 text-center text-text-muted">No usage yet</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default TagManager;
