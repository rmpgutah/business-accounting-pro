import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import unusedImports from 'eslint-plugin-unused-imports';
import bap from './eslint-rules/index.mjs';

const TYPED_FILES = ['src/**/*.{ts,tsx}', 'scripts/**/*.ts'];

const warnAll = (rules) =>
  Object.fromEntries(
    Object.entries(rules).map(([k, v]) => [
      k,
      Array.isArray(v) ? ['warn', ...v.slice(1)] : v === 'off' ? 'off' : 'warn',
    ]),
  );

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'release/**',
      'cloudflare-app/dist/**',
      'landing-page/**',
      'node_modules/**',
      '.tmp-test/**',
    ],
  },
  js.configs.recommended,
  // Typed rules only where a tsconfig covers the files (src/**, scripts/**/*.ts).
  ...tseslint.configs.recommendedTypeChecked.map((c) => ({
    ...(c.rules ? { ...c, rules: warnAll(c.rules) } : c),
    files: TYPED_FILES,
  })),
  {
    files: TYPED_FILES,
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks, 'unused-imports': unusedImports, bap },
    rules: {
      ...warnAll(js.configs.recommended.rules),
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'unused-imports/no-unused-imports': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'bap/no-hardcoded-hex': 'error',
      'bap/no-blocky-radius': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/no-floating-promises': 'warn' },
  },
  {
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: { globals: { ...globals.node } },
    rules: warnAll(js.configs.recommended.rules),
  },
  {
    files: ['**/*.test.{ts,tsx,js}', 'src/main/test/**'],
    rules: { '@typescript-eslint/no-floating-promises': 'off' },
  },
  prettier,
);
