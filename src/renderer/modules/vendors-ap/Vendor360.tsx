import React from 'react';
import { Section, Empty } from './shared/ui';
const Vendor360: React.FC<{ vendorId: string; onBack: () => void }> = () => (
  <Section title="Vendor 360"><Empty msg="Coming up." /></Section>
);
export default Vendor360;
