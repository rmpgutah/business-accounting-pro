// src/renderer/components/TagPicker.tsx
//
// Universal tag picker. Filters existing tags as you type, lets users
// add/remove colored chips, and (optionally) create new tags inline.
// Variants: single-select / multi-select. Pass readonly=true for chip
// rendering only (no editing) — useful for list views.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Plus, Tag as TagIcon } from 'lucide-react';
import api from '../lib/api';
import { useCompanyStore } from '../stores/companyStore';

export interface TagRecord {
  id: string;
  name: string;
  color: string;
  group_id?: string | null;
  sort_order?: number;
}

interface TagPickerProps {
  entityType?: string;
  entityId?: string;
  // Controlled mode: pass value/onChange
  value?: string[];
  onChange?: (tagIds: string[]) => void;
  multiple?: boolean;
  readonly?: boolean;
  allowCreate?: boolean;
  placeholder?: string;
  // When entityType/entityId provided and no value/onChange, auto-load + persist
  autoSave?: boolean;
  className?: string;
}

export const TagChip: React.FC<{ tag: TagRecord; onRemove?: () => void; small?: boolean }> = ({ tag, onRemove, small }) => {
  // Color contrast: pick black/white text based on luminance
  const fg = textOnColor(tag.color);
  return (
    <span
      className={`inline-flex items-center gap-1 ${small ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5'} font-medium`}
      style={{ background: tag.color, color: fg, borderRadius: '3px' }}
      title={tag.name}
    >
      <span>{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="opacity-70 hover:opacity-100"
          aria-label={`Remove ${tag.name}`}
        >
          <X size={small ? 10 : 12} />
        </button>
      )}
    </span>
  );
};

function textOnColor(hex: string): string {
  try {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.55 ? '#000000' : '#ffffff';
  } catch { return '#ffffff'; }
}

const TagPicker: React.FC<TagPickerProps> = ({
  entityType,
  entityId,
  value,
  onChange,
  multiple = true,
  readonly = false,
  allowCreate = true,
  placeholder = 'Add tag…',
  autoSave = true,
  className = '',
}) => {
  const company = useCompanyStore(s => s.activeCompany);
  const [allTags, setAllTags] = useState<TagRecord[]>([]);
  const [selected, setSelected] = useState<string[]>(value ?? []);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const controlled = value !== undefined && onChange !== undefined;

  // Load tags for company
  useEffect(() => {
    if (!company?.id) return;
    api.tagsList(company.id).then((rows: any) => {
      if (Array.isArray(rows)) setAllTags(rows);
    });
  }, [company?.id]);

  // Load assignments if entity given and not controlled
  useEffect(() => {
    if (controlled || !company?.id || !entityType || !entityId) return;
    api.tagsGetForEntity(company.id, entityType, entityId).then((rows: any) => {
      if (Array.isArray(rows)) setSelected(rows.map((r: any) => r.id));
    });
  }, [controlled, company?.id, entityType, entityId]);

  // Sync selected from value prop
  useEffect(() => { if (controlled) setSelected(value ?? []); }, [controlled, value]);

  const tagMap = useMemo(() => {
    const m = new Map<string, TagRecord>();
    for (const t of allTags) m.set(t.id, t);
    return m;
  }, [allTags]);

  const selectedTags = selected.map(id => tagMap.get(id)).filter(Boolean) as TagRecord[];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allTags
      .filter(t => !selected.includes(t.id))
      .filter(t => !q || t.name.toLowerCase().includes(q))
      .slice(0, 12);
  }, [allTags, selected, search]);

  const persist = async (next: string[]) => {
    setSelected(next);
    if (controlled) onChange!(next);
    else if (autoSave && company?.id && entityType && entityId) {
      await api.tagsSetForEntity(company.id, entityType, entityId, next);
    }
  };

  const addTag = (id: string) => {
    if (selected.includes(id)) return;
    const next = multiple ? [...selected, id] : [id];
    void persist(next);
    setSearch('');
    if (!multiple) setOpen(false);
  };

  const removeTag = (id: string) => {
    void persist(selected.filter(x => x !== id));
  };

  const createTag = async () => {
    const name = search.trim();
    if (!name || !company?.id) return;
    const color = TAG_PALETTE[Math.floor(Math.random() * TAG_PALETTE.length)];
    const created = await api.tagsCreate({ company_id: company.id, name, color });
    if (created?.id) {
      setAllTags(prev => [...prev, created]);
      addTag(created.id);
    }
  };

  const exactMatch = filtered.some(t => t.name.toLowerCase() === search.trim().toLowerCase());

  if (readonly) {
    return (
      <div className={`flex flex-wrap gap-1 ${className}`}>
        {selectedTags.map(t => <TagChip key={t.id} tag={t} small />)}
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <div
        className="flex flex-wrap gap-1 items-center min-h-[32px] px-2 py-1 bg-bg-tertiary border border-border-primary"
        style={{ borderRadius: '4px' }}
        onClick={() => { setOpen(true); inputRef.current?.focus(); }}
      >
        {selectedTags.map(t => <TagChip key={t.id} tag={t} onRemove={() => removeTag(t.id)} />)}
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (filtered[0]) addTag(filtered[0].id);
              else if (allowCreate && search.trim()) void createTag();
            } else if (e.key === 'Backspace' && !search && selected.length) {
              removeTag(selected[selected.length - 1]);
            }
          }}
          placeholder={selectedTags.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[80px] bg-transparent text-xs outline-none text-text-primary"
        />
      </div>
      {open && (filtered.length > 0 || (allowCreate && search.trim() && !exactMatch)) && (
        <div
          className="absolute z-50 mt-1 w-full bg-bg-secondary border border-border-primary shadow-lg max-h-64 overflow-y-auto"
          style={{ borderRadius: '4px' }}
        >
          {filtered.map(t => (
            <button
              key={t.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); addTag(t.id); }}
              className="w-full text-left px-2 py-1.5 hover:bg-bg-tertiary flex items-center gap-2"
            >
              <span className="w-3 h-3" style={{ background: t.color }} />
              <span className="text-xs text-text-primary">{t.name}</span>
            </button>
          ))}
          {allowCreate && search.trim() && !exactMatch && (
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); void createTag(); }}
              className="w-full text-left px-2 py-1.5 hover:bg-bg-tertiary flex items-center gap-2 border-t border-border-primary"
            >
              <Plus size={12} className="text-accent-blue" />
              <span className="text-xs text-text-primary">Create "{search.trim()}"</span>
            </button>
          )}
          {filtered.length === 0 && (!search.trim() || exactMatch) && (
            <div className="px-2 py-2 text-xs text-text-muted flex items-center gap-1">
              <TagIcon size={12} /> No more tags
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const TAG_PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#14b8a6', '#06b6d4',
  '#3b82f6', '#6366f1', '#a855f7', '#ec4899',
];

export default TagPicker;
