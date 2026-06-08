import React from 'react';
import ExpensesUpgradesPart1 from './ExpensesUpgrades.part1';
import ExpensesUpgradesPart2 from './ExpensesUpgrades.part2';
import ExpensesUpgradesPart3 from './ExpensesUpgrades.part3';
import ExpensesUpgradesPart4 from './ExpensesUpgrades.part4';
import ExpensesUpgradesPart5 from './ExpensesUpgrades.part5';

const ExpensesUpgradesPanel: React.FC = () => (
  <div className="p-6 space-y-6 overflow-y-auto h-full">
    <h1 className="text-xl font-bold text-text-primary">Expenses Upgrades</h1>
    <ExpensesUpgradesPart1 />
    <ExpensesUpgradesPart2 />
    <ExpensesUpgradesPart3 />
    <ExpensesUpgradesPart4 />
    <ExpensesUpgradesPart5 />
  </div>
);

export default ExpensesUpgradesPanel;
