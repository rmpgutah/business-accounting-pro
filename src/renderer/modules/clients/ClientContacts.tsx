import React from 'react';
import { Plus, Trash2, Star } from 'lucide-react';
import { v4 as uuid } from 'uuid';

export interface ClientContact {
  id: string;
  client_id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  is_primary: boolean;
}

interface Props {
  contacts: ClientContact[];
  onChange: (contacts: ClientContact[]) => void;
}

const ClientContacts: React.FC<Props> = ({ contacts, onChange }) => {
  const addContact = () => {
    onChange([...contacts, { id: uuid(), client_id: '', name: '', title: '', email: '', phone: '', is_primary: contacts.length === 0 }]);
  };

  const update = (id: string, field: keyof ClientContact, value: string | boolean) => {
    onChange(contacts.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const remove = (id: string) => {
    const remaining = contacts.filter(c => c.id !== id);
    // if we removed the primary, make the first remaining one primary
    if (remaining.length > 0 && !remaining.some(c => c.is_primary)) {
      remaining[0] = { ...remaining[0], is_primary: true };
    }
    onChange(remaining);
  };

  const setPrimary = (id: string) => {
    onChange(contacts.map(c => ({ ...c, is_primary: c.id === id })));
  };

  return (
    <div>
      {contacts.length === 0 ? (
        <div style={{ padding: '12px', color: 'var(--color-text-muted)', fontSize: '12px', textAlign: 'center', fontStyle: 'italic' }}>
          No contacts yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
          {contacts.map((c) => (
            <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto auto', gap: 8, alignItems: 'center' }}>
              <input className="block-input" name="name" autoComplete="name" placeholder="Name" value={c.name} onChange={(e) => update(c.id, 'name', e.target.value)} />
              <input className="block-input" name="title" autoComplete="organization-title" placeholder="Title" value={c.title} onChange={(e) => update(c.id, 'title', e.target.value)} />
              <input className="block-input" name="email" autoComplete="email" placeholder="Email" type="email" value={c.email} onChange={(e) => update(c.id, 'email', e.target.value)} />
              <input className="block-input" name="phone" autoComplete="tel" type="tel" placeholder="Phone" value={c.phone} onChange={(e) => update(c.id, 'phone', e.target.value)} />
              <button
                type="button"
                aria-label={c.is_primary ? 'Primary contact' : 'Set as primary'}
                title={c.is_primary ? 'Primary contact' : 'Set as primary'}
                onClick={() => setPrimary(c.id)}
                style={{ color: c.is_primary ? 'var(--color-accent)' : 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
              >
                <Star size={14} fill={c.is_primary ? 'currentColor' : 'none'} />
              </button>
              <button type="button" aria-label="Remove contact" className="text-text-muted p-1" onClick={() => remove(c.id)} title="Remove">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" className="block-btn flex items-center gap-1.5 text-xs py-1 px-3" onClick={addContact}>
        <Plus size={13} />
        Add Contact
      </button>
    </div>
  );
};

export default ClientContacts;
