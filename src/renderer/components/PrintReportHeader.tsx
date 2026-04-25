import React from 'react';
import { format } from 'date-fns';
import { useCompanyStore } from '../stores/companyStore';

/**
 * Print-only report header used across all financial reports
 * (P&L, Balance Sheet, Cash Flow, AR/AP Aging, Trial Balance,
 * General Ledger, Tax Summary, Expense by Category, Budget vs Actual).
 *
 * Hidden on screen — visible only inside `@media print` via the
 * `.print-report-header` class defined in globals.css.
 *
 * Props:
 *   title       — Report title (e.g. "Profit & Loss Statement")
 *   periodLabel — Period descriptor (e.g. "year", "month", "quarter", "as of")
 *   periodEnd   — End of report period (ISO yyyy-MM-dd or Date)
 */
export interface PrintReportHeaderProps {
  title: string;
  periodLabel?: string;
  periodEnd?: string | Date;
  /** Optional explicit period range string overriding periodLabel/periodEnd. */
  periodText?: string;
}

const PrintReportHeader: React.FC<PrintReportHeaderProps> = ({
  title,
  periodLabel,
  periodEnd,
  periodText,
}) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const companyName = activeCompany?.name ?? 'Company';

  const endDate =
    periodEnd instanceof Date
      ? periodEnd
      : periodEnd
        ? new Date(periodEnd)
        : new Date();

  const periodDisplay =
    periodText ??
    (periodLabel
      ? `For the ${periodLabel} ended ${format(endDate, 'MMMM d, yyyy')}`
      : `As of ${format(endDate, 'MMMM d, yyyy')}`);

  const runDate = format(new Date(), 'MMMM d, yyyy');

  return (
    <div className="print-report-header" aria-hidden="true">
      <div className="print-report-header-top">
        <div className="print-report-header-left">
          <div className="print-report-company">{companyName}</div>
          <div className="print-report-title">{title}</div>
          <div className="print-report-period">{periodDisplay}</div>
        </div>
        <div className="print-report-header-right">
          <div className="print-report-prepared">Prepared on {runDate}</div>
        </div>
      </div>
      <div className="print-report-rule" />
    </div>
  );
};

export default PrintReportHeader;
