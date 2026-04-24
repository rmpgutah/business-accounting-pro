import React, { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Trash2, Mail, Phone } from 'lucide-react';
import api from '../../lib/api';

// ─── Types ──────────────────────────────────────────────
interface Contact {
  id: string;
  role: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  bar_number: string;
}

interface ContactListProps {
  debtId: string;
  onAdd: () => void;
  onEdit: (id: string) => void;
}

// ─── Role badge colors ──────────────────────────────────
const ROLE_STYLES: Record<string, string> = {
  debtor:            'bg-accent-expense/20 text-red-400',
  guarantor:         'bg-amber-500/20 text-amber-400',
  attorney:          'bg-accent-blue/20 text-accent-blue',
  witness:           'bg-purple-500/20 text-purple-400',
  collections_agent: 'bg-amber-500/20 text-amber-400',
  judge:             'bg-accent-expense/20 text-red-400',
  mediator:          'bg-emerald-500/20 text-emerald-400',
};

function roleLabel(role: string): string {
  return role
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ─── Component ──────────────────────────────────────────
const ContactList: React.FC<ContactListProps> = ({ debtId, onAdd, onEdit }) => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const rows = await api.query('debt_contacts', { debt_id: debtId });
      if (Array.isArray(rows)) setContacts(rows as Contact[]);
    } catch (err) {
      console.error('Failed to load contacts:', err);
    } finally {
      setLoading(false);
    }
  }, [debtId]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string, name: string) => {
    const ok = window.confirm(`Delete contact "${name}"? This cannot be undone.`);
    if (!ok) return;
    try {
      await api.remove('debt_contacts', id);
      setContacts((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      console.error('Failed to delete contact:', err);
    }
  };

  if (loading) {
    return (
      <div className="block-card">
        <div className="flex items-center justify-center py-6 text-text-muted text-sm">
          Loading contacts...
        </div>
      </div>
    );
  }

  return (
    <div className="block-card">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-bold text-text-primary uppercase tracking-wider">
          Contacts
        </h4>
        <button
          className="block-btn flex items-center gap-1.5 text-xs"
          onClick={onAdd}
        >
          <Plus size={14} />
          Add
        </button>
      </div>

      {/* Empty state */}
      {contacts.length === 0 && (
        <p className="text-text-muted text-sm py-4 text-center">
          No contacts. Add attorneys, witnesses, or other contacts.
        </p>
      )}

      {/* Contact rows */}
      {contacts.length > 0 && (
        <div className="space-y-0">
          {contacts.map((c) => {
            const badgeStyle = ROLE_STYLES[c.role] || 'bg-bg-secondary/20 text-text-muted';

            return (
              <div
                key={c.id}
                className="flex items-center gap-3 px-3 py-2.5 border-b border-border-primary last:border-b-0 hover:bg-bg-tertiary transition-colors"
                style={{ borderRadius: '6px' }}
              >
                {/* Role badge */}
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 flex-shrink-0 ${badgeStyle}`}
                  style={{ borderRadius: '6px' }}
                >
                  {roleLabel(c.role)}
                </span>

                {/* Name & info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-primary truncate">
                    {c.name}
                    {c.company && (
                      <span className="text-text-muted font-normal ml-1.5 text-xs">
                        {c.company}
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-3 mt-0.5">
                    {c.email && (
                      <span className="flex items-center gap-1 text-xs text-text-muted truncate">
                        <Mail size={10} />
                        {c.email}
                      </span>
                    )}
                    {c.phone && (
                      <span className="flex items-center gap-1 text-xs text-text-muted">
                        <Phone size={10} />
                        {c.phone}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
                    style={{ borderRadius: '6px' }}
                    onClick={() => onEdit(c.id)}
                    title="Edit contact"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-accent-expense transition-colors"
                    style={{ borderRadius: '6px' }}
                    onClick={() => handleDelete(c.id, c.name)}
                    title="Delete contact"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ContactList;
