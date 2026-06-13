import React from 'react';
import { Section, Empty } from './shared/ui';
const Overview: React.FC<{ onViewVendor?: (id: string) => void }> = () => (
  <Section title="Overview"><Empty msg="Coming up in this wave." /></Section>
);
export default Overview;
