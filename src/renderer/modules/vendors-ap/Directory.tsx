import React from 'react';
import { Section, Empty } from './shared/ui';
const Directory: React.FC<{ onViewVendor?: (id: string) => void }> = () => (
  <Section title="Directory"><Empty msg="Coming up." /></Section>
);
export default Directory;
