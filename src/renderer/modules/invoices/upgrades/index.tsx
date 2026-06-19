import React from 'react';
import InvoicesUpgradesPart1 from './InvoicesUpgrades.part1';
import InvoicesUpgradesPart2 from './InvoicesUpgrades.part2';
import InvoicesUpgradesPart3 from './InvoicesUpgrades.part3';
import InvoicesUpgradesPart4 from './InvoicesUpgrades.part4';

const InvoicesUpgradesPanel: React.FC = () => {
  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <h1 className="text-xl font-bold text-text-primary">Invoices Upgrades</h1>
      <InvoicesUpgradesPart1 />
      <InvoicesUpgradesPart2 />
      <InvoicesUpgradesPart3 />
      <InvoicesUpgradesPart4 />
    </div>
  );
};

export default InvoicesUpgradesPanel;
