import React from 'react';
import { useCompanyStore } from '../stores/companyStore';

/**
 * Print-only report footer used across all financial reports.
 *
 * Hidden on screen — visible only inside `@media print` via the
 * `.print-report-footer` class defined in globals.css.
 *
 * The page number is rendered with CSS `counter(page)` so it works
 * across all rendering engines (Chromium for Electron print, Safari, etc.)
 * without needing JS-driven page calculation. The "of N" portion uses
 * `counter(pages)` which Chromium supports for printed output.
 */
const PrintReportFooter: React.FC<{
  /** Optional confidentiality line override. */
  confidentiality?: string;
}> = ({ confidentiality = 'Confidential — internal use only' }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const companyName = activeCompany?.name ?? 'Company';

  return (
    <div className="print-report-footer" aria-hidden="true">
      <div className="print-report-footer-left">{companyName}</div>
      <div className="print-report-footer-center">{confidentiality}</div>
      <div className="print-report-footer-right">
        {/* Page number injected via CSS counters in globals.css */}
        <span className="print-report-pageno" />
      </div>
    </div>
  );
};

export default PrintReportFooter;
