import React from 'react';
import type { LineRowType } from '../../../shared/types';

interface Props {
  onAdd: (type: LineRowType) => void;
}

const BUTTONS: { type: LineRowType; label: string; title: string }[] = [
  { type: 'item',     label: '+ Item',     title: 'Add a billable line item' },
  { type: 'section',  label: '— Section',  title: 'Add a section heading' },
  { type: 'note',     label: '✎ Note',     title: 'Add an italic note' },
  { type: 'subtotal', label: '∑ Subtotal', title: 'Add a running subtotal' },
  { type: 'image',    label: '⎘ Image',    title: 'Add an inline image' },
  { type: 'spacer',   label: '· Spacer',   title: 'Add a blank spacer row' },
];

const RowTypeToolbar: React.FC<Props> = ({ onAdd }) => (
  <div className="flex flex-wrap gap-2 mt-2">
    {BUTTONS.map(b => (
      <button
        key={b.type}
        type="button"
        title={b.title}
        onClick={() => onAdd(b.type)}
        className="block-btn text-xs px-3 py-1"
        style={{ opacity: 0.85 }}
      >
        {b.label}
      </button>
    ))}
  </div>
);

export default RowTypeToolbar;
