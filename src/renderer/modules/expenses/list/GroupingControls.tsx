import React from 'react';
import { GroupKey } from './columns';

// Group-by selector for the Expense list. JSX moved verbatim out of
// ExpenseList.tsx (move-only refactor, 2026-06-11) — state refs replaced
// with props.

export interface GroupingControlsProps {
  groupBy: GroupKey;
  setGroupBy: (v: GroupKey) => void;
}

const GroupingControls: React.FC<GroupingControlsProps> = ({ groupBy, setGroupBy }) => {
  return (
    <select className="block-select" style={{ width: 'auto' }} value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupKey)}>
      <option value="none">No grouping</option>
      <option value="vendor">Group by Vendor</option>
      <option value="category">Group by Category</option>
      <option value="project">Group by Project</option>
      <option value="month">Group by Month</option>
      <option value="quarter">Group by Quarter</option>
      <option value="dayofweek">Group by Day of Week</option>
      <option value="taxded">Group by Tax Deductibility</option>
      <option value="currency">Group by Currency</option>
    </select>
  );
};

export default GroupingControls;
