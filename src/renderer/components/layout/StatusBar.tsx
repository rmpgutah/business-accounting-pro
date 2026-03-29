import React from 'react';
import { useCompanyStore } from '../../stores/companyStore';

const StatusBar: React.FC = () => {
  const { activeCompany } = useCompanyStore();

  const fiscalYear = activeCompany?.fiscal_year_end
    ? `FY ${activeCompany.fiscal_year_end}`
    : 'FY 2025';

  return (
    <footer
      className="flex items-center justify-between h-6 px-3 bg-bg-tertiary border-t border-border-primary text-[11px] text-text-muted shrink-0 select-none"
      style={{ borderRadius: '0px' }}
    >
      <div className="flex items-center gap-3">
        <span>{fiscalYear}</span>
        {activeCompany?.name && (
          <>
            <span className="text-border-secondary">|</span>
            <span>{activeCompany.name}</span>
          </>
        )}
      </div>
      <span>Business Accounting Pro v1.0.0</span>
    </footer>
  );
};

export default StatusBar;
