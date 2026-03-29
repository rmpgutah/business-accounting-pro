import React, { useState } from 'react';
import BudgetList from './BudgetList';
import BudgetForm from './BudgetForm';
import BudgetDetail from './BudgetDetail';

type View = 'list' | 'new' | 'detail';

const BudgetModule: React.FC = () => {
  const [view, setView] = useState<View>('list');
  const [selectedBudgetId, setSelectedBudgetId] = useState<string | null>(null);

  const handleSelect = (id: string) => {
    setSelectedBudgetId(id);
    setView('detail');
  };

  const handleCreated = (id: string) => {
    setSelectedBudgetId(id);
    setView('detail');
  };

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      <h1 className="text-lg font-bold text-text-primary">Budget Management</h1>

      {view === 'list' && (
        <BudgetList
          onNew={() => setView('new')}
          onSelect={handleSelect}
        />
      )}

      {view === 'new' && (
        <BudgetForm
          onBack={() => setView('list')}
          onCreated={handleCreated}
        />
      )}

      {view === 'detail' && selectedBudgetId && (
        <BudgetDetail
          budgetId={selectedBudgetId}
          onBack={() => setView('list')}
        />
      )}
    </div>
  );
};

export default BudgetModule;
