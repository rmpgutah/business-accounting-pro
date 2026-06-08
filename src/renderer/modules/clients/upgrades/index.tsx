// src/renderer/modules/clients/upgrades/index.tsx
//
// Aggregates the four self-contained Clients upgrade panels into a single
// scrollable "Upgrades" surface. Each part is a default-exported component
// that loads its own real data through the api wrapper.

import React from 'react';
import ClientsUpgradesPart1 from './ClientsUpgrades.part1';
import ClientsUpgradesPart2 from './ClientsUpgrades.part2';
import ClientsUpgradesPart3 from './ClientsUpgrades.part3';
import ClientsUpgradesPart4 from './ClientsUpgrades.part4';

const ClientsUpgradesPanel: React.FC = () => {
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold text-text-primary">Clients Upgrades</h1>
      <ClientsUpgradesPart1 />
      <ClientsUpgradesPart2 />
      <ClientsUpgradesPart3 />
      <ClientsUpgradesPart4 />
    </div>
  );
};

export default ClientsUpgradesPanel;
