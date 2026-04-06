// src/renderer/components/FieldLabel.tsx
import React from 'react';
import { HelpCircle } from 'lucide-react';
import { Tooltip } from './Tooltip';

interface Props {
  label: string;
  tooltip?: string;
  required?: boolean;
  htmlFor?: string;
}

export const FieldLabel: React.FC<Props> = ({ label, tooltip, required, htmlFor }) => (
  <label
    htmlFor={htmlFor}
    className="text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1 mb-1.5"
  >
    {label}
    {required && <span className="text-accent-expense">*</span>}
    {tooltip && (
      <Tooltip content={tooltip}>
        <HelpCircle size={11} className="text-text-muted cursor-help" />
      </Tooltip>
    )}
  </label>
);
