interface StatusBadgeProps {
  status: string;
}

const STATUS_STYLES: Record<string, { label: string; classes: string }> = {
  paid:     { label: 'PAID',     classes: 'border-green-700 text-green-800 bg-green-100' },
  sent:     { label: 'SENT',     classes: 'border-blue-700  text-blue-800  bg-blue-100'  },
  overdue:  { label: 'OVERDUE',  classes: 'border-red-700   text-red-800   bg-red-100'   },
  partial:  { label: 'PARTIAL',  classes: 'border-amber-600 text-amber-800 bg-amber-100' },
  draft:    { label: 'DRAFT',    classes: 'border-gray-500  text-gray-700  bg-gray-100'  },
  void:     { label: 'VOID',     classes: 'border-gray-700  text-gray-800  bg-gray-200'  },
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const key = (status || 'draft').toLowerCase();
  const cfg = STATUS_STYLES[key] ?? { label: key.toUpperCase(), classes: 'border-gray-500 text-gray-700 bg-gray-100' };
  return (
    <span
      className={`inline-block px-3 py-1 text-[11px] font-black uppercase tracking-widest border-2 ${cfg.classes}`}
      aria-label={`Invoice status: ${cfg.label}`}
    >
      {cfg.label}
    </span>
  );
}
