import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import rule from './no-hardcoded-hex.mjs';

RuleTester.it = it;
RuleTester.itOnly = it.only;
RuleTester.describe = describe;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

tester.run('no-hardcoded-hex', rule, {
  valid: [
    { code: `<div style={{ color: 'var(--color-accent-income)' }} />`, filename: 'src/renderer/x.tsx' },
    { code: `const id = '#main';`, filename: 'src/renderer/x.tsx' },
    { code: `<div style={{ color: '#fff' }} />`, filename: 'src/renderer/components/SignaturePad.tsx' },
  ],
  invalid: [
    { code: `<div style={{ color: '#dc2626' }} />`, filename: 'src/renderer/x.tsx', errors: 1 },
    { code: `const s = { background: '#FFF' };`, filename: 'src/renderer/x.tsx', errors: 1 },
    { code: `<div color="#2563eb" />`, filename: 'src/renderer/x.tsx', errors: 1 },
  ],
});
