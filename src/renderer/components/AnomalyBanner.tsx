import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface AnomalyBannerProps {
  message: string;
  severity?: 'low' | 'medium' | 'high';
  onDismiss?: () => void;
}

export const AnomalyBanner: React.FC<AnomalyBannerProps> = ({ message, severity = 'medium', onDismiss }) => {
  const colorMap = {
    low: 'bg-bg-tertiary border-border-primary text-text-secondary',
    medium: 'bg-accent-warning/10 border-accent-warning/30 text-accent-warning',
    high: 'bg-accent-expense/10 border-accent-expense/30 text-accent-expense',
  };
  return (
    <div className={`flex items-start gap-2 p-3 border ${colorMap[severity]}`} style={{ borderRadius: '6px' }}>
      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
      <span className="text-xs flex-1">{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="text-[10px] hover:opacity-70 transition-opacity">
          <X size={12} />
        </button>
      )}
    </div>
  );
};

export default AnomalyBanner;
