import { createRequire } from 'module';

const allow = createRequire(import.meta.url)('./allowlist.json')['no-hardcoded-hex'];
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_KEYS = /color|background|border|fill|stroke|shadow|outline/i;

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow hard-coded hex colours in .tsx; use CSS variables' },
    schema: [],
  },
  create(ctx) {
    const file = ctx.filename.replace(/\\/g, '/');
    if (!file.endsWith('.tsx') || allow.some((a) => file.endsWith(a))) return {};
    const report = (node) =>
      ctx.report({
        node,
        message: `Hard-coded hex colour ${node.value}; use var(--color-*) / var(--accent-primary)`,
      });
    return {
      Property(node) {
        const key = node.key.name ?? node.key.value;
        if (
          typeof key === 'string' &&
          COLOR_KEYS.test(key) &&
          node.value.type === 'Literal' &&
          typeof node.value.value === 'string' &&
          HEX.test(node.value.value)
        )
          report(node.value);
      },
      JSXAttribute(node) {
        if (
          node.value?.type === 'Literal' &&
          typeof node.value.value === 'string' &&
          HEX.test(node.value.value)
        )
          report(node.value);
      },
    };
  },
};
