// src/renderer/modules/settings/TagsAndFieldsSettings.tsx
//
// Single admin surface that ties together universal tags + custom fields.
// Mountable as a settings sub-page. Other modules (settings/index.tsx) can
// add a tab/route that renders <TagsAndFieldsSettings />.

import React, { useState } from 'react';
import { Tag as TagIcon, Database } from 'lucide-react';
import TagManager from '../../components/TagManager';
import CustomFieldEditor from '../../components/CustomFieldEditor';

const TagsAndFieldsSettings: React.FC = () => {
  const [tab, setTab] = useState<'tags' | 'fields'>('tags');
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-text-primary">Tags & Custom Fields</h2>
        <p className="text-xs text-text-muted mt-0.5">
          Universal tagging + custom-field registry. Available across every entity (invoices, expenses, clients, vendors, projects, debts, bills, POs, employees, accounts, journal entries, assets, inventory).
        </p>
      </div>
      <div className="flex items-center gap-1 border-b border-border-primary">
        <button
          type="button"
          onClick={() => setTab('tags')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs ${tab === 'tags' ? 'text-accent-blue border-b-2 border-accent-blue' : 'text-text-muted hover:text-text-primary'}`}
        >
          <TagIcon size={12} /> Tags
        </button>
        <button
          type="button"
          onClick={() => setTab('fields')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs ${tab === 'fields' ? 'text-accent-blue border-b-2 border-accent-blue' : 'text-text-muted hover:text-text-primary'}`}
        >
          <Database size={12} /> Custom Fields
        </button>
      </div>
      {tab === 'tags' ? <TagManager /> : <CustomFieldEditor />}
    </div>
  );
};

export default TagsAndFieldsSettings;
