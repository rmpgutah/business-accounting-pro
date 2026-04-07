import React, { useCallback } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { v4 as uuid } from 'uuid';

export interface Milestone {
  id: string;
  milestone_label: string;
  due_date: string;
  amount: number;
  paid: boolean;
}

interface Props {
  milestones: Milestone[];
  onChange: (milestones: Milestone[]) => void;
  totalAmount?: number;
}

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

const PaymentScheduleEditor: React.FC<Props> = ({ milestones, onChange, totalAmount }) => {
  const addMilestone = useCallback(() => {
    onChange([...milestones, { id: uuid(), milestone_label: '', due_date: '', amount: 0, paid: false }]);
  }, [milestones, onChange]);

  const updateMilestone = useCallback((id: string, field: keyof Milestone, value: string | number | boolean) => {
    onChange(milestones.map(m => m.id === id ? { ...m, [field]: value } : m));
  }, [milestones, onChange]);

  const removeMilestone = useCallback((id: string) => {
    onChange(milestones.filter(m => m.id !== id));
  }, [milestones, onChange]);

  const allocatedTotal = milestones.reduce((s, m) => s + Number(m.amount || 0), 0);
  const remaining = totalAmount !== undefined ? totalAmount - allocatedTotal : null;

  return (
    <div>
      {milestones.length === 0 ? (
        <div style={{ padding: '16px', color: 'var(--color-text-muted)', fontSize: '12px', textAlign: 'center', fontStyle: 'italic' }}>
          No milestones yet. Click "Add Milestone" to split this invoice into payment stages.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {milestones.map((m) => (
            <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 120px auto auto', gap: 8, alignItems: 'center' }}>
              <input
                className="block-input"
                placeholder="Milestone label (e.g. Deposit 50%)"
                value={m.milestone_label}
                onChange={(e) => updateMilestone(m.id, 'milestone_label', e.target.value)}
              />
              <input
                type="date"
                className="block-input"
                value={m.due_date}
                onChange={(e) => updateMilestone(m.id, 'due_date', e.target.value)}
              />
              <input
                type="number"
                min={0}
                step="0.01"
                className="block-input text-right font-mono"
                placeholder="Amount"
                value={m.amount}
                onChange={(e) => updateMilestone(m.id, 'amount', parseFloat(e.target.value) || 0)}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', whiteSpace: 'nowrap', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={m.paid}
                  onChange={(e) => updateMilestone(m.id, 'paid', e.target.checked)}
                  style={{ width: 14, height: 14 }}
                />
                Paid
              </label>
              <button className="text-text-muted p-1" onClick={() => removeMilestone(m.id)} title="Remove">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button className="block-btn flex items-center gap-1.5 text-xs py-1 px-3" onClick={addMilestone}>
          <Plus size={13} />
          Add Milestone
        </button>
        {remaining !== null && milestones.length > 0 && (
          <div style={{ fontSize: '12px', color: remaining < -0.005 ? '#ef4444' : remaining > 0.005 ? '#d97706' : '#16a34a' }}>
            Allocated: {fmt.format(allocatedTotal)}
            {' · '}
            {remaining > 0.005 ? `Remaining: ${fmt.format(remaining)}` : remaining < -0.005 ? `Over by: ${fmt.format(-remaining)}` : 'Fully allocated ✓'}
          </div>
        )}
      </div>
    </div>
  );
};

export default PaymentScheduleEditor;
