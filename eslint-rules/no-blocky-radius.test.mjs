import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import rule from './no-blocky-radius.mjs';

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

tester.run('no-blocky-radius', rule, {
  valid: [
    { code: `const s = { borderRadius: 'var(--app-radius)' };`, filename: 'a.tsx' },
    { code: `const s = { borderRadius: '50%' };`, filename: 'a.tsx' },
    { code: `const s = { borderRadius: '9999px' };`, filename: 'a.tsx' },
    { code: `const s = { borderRadius: 1 };`, filename: 'a.tsx' },
    { code: `const s = { borderRadius: '0 var(--app-radius) var(--app-radius) 0' };`, filename: 'a.tsx' },
    { code: `const s = { borderRadius: '1px 1px 0 0' };`, filename: 'a.tsx' },
  ],
  invalid: [
    { code: `const s = { borderRadius: 0 };`, filename: 'a.tsx', errors: 1 },
    { code: `const s = { borderRadius: '2px' };`, filename: 'a.tsx', errors: 1 },
    { code: `const s = { borderRadius: 6 };`, filename: 'a.tsx', errors: 1 },
    { code: `const s = { borderRadius: '8px' };`, filename: 'a.tsx', errors: 1 },
    { code: `const s = { borderRadius: '0 0 0 0' };`, filename: 'a.tsx', errors: 1 },
    { code: `const s = { borderRadius: '4px 4px 0 0' };`, filename: 'a.tsx', errors: 1 },
  ],
});
