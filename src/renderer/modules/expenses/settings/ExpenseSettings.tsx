import React, { useState } from 'react';
import { CreditCard } from 'lucide-react';
import ExpenseCategorySettings from '../ExpenseCategorySettings';
import CreditCardImportModal from '../CreditCardImportModal';
import PolicyAdmin from './PolicyAdmin';
import TemplateAdmin from './TemplateAdmin';

interface Props {
  onBack: () => void;
}

const ExpenseSettings: React.FC<Props> = ({ onBack }) => {
  const [showCcImport, setShowCcImport] = useState(false);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end">
        <button className="block-btn flex items-center gap-2 text-xs" onClick={() => setShowCcImport(true)}>
          <CreditCard size={14} /> Import Credit-Card Statement
        </button>
      </div>
      <PolicyAdmin />
      <TemplateAdmin />
      <ExpenseCategorySettings onBack={onBack} />
      {showCcImport && (
        <CreditCardImportModal onClose={() => setShowCcImport(false)} onDone={() => setShowCcImport(false)} />
      )}
    </div>
  );
};

export default ExpenseSettings;
