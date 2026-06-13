import React from 'react';
import { Section, Empty } from './shared/ui';
const TaxCompliance1099: React.FC<{ onViewVendor?: (id: string) => void }> = () => (
  <Section title="1099 & Tax"><Empty msg="Coming up." /></Section>
);
export default TaxCompliance1099;
