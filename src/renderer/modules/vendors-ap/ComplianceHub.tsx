import React from 'react';
import { Section, Empty } from './shared/ui';
const ComplianceHub: React.FC<{ onViewVendor?: (id: string) => void }> = () => (
  <Section title="Compliance"><Empty msg="Coming up." /></Section>
);
export default ComplianceHub;
