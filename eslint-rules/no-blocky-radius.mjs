// Multi-corner shorthand (e.g. '0 var(--app-radius) var(--app-radius) 0', '1px 1px 0 0'):
// every token must be a token-safe value and not all zero.
const OK_TOKEN = /^(?:0|1px|50%|9999px|var\(.*\))$/;
const okShorthand = (v) => {
  const t = v.trim().split(/\s+(?![^(]*\))/);
  return t.every((x) => OK_TOKEN.test(x)) && t.some((x) => x !== '0');
};

const OK_STRINGS = new Set(['var(--app-radius)', '50%', '9999px', 'inherit', 'initial']);

export default {
  meta: {
    type: 'problem',
    docs: { description: 'borderRadius must use var(--app-radius)' },
    schema: [],
  },
  create(ctx) {
    if (!ctx.filename.endsWith('.tsx')) return {};
    return {
      Property(node) {
        const key = node.key.name ?? node.key.value;
        if (key !== 'borderRadius' || node.value.type !== 'Literal') return;
        const v = node.value.value;
        const ok =
          (typeof v === 'number' && v === 1) ||
          (typeof v === 'string' && (OK_STRINGS.has(v) || v.startsWith('var(') || okShorthand(v)));
        if (!ok)
          ctx.report({
            node: node.value,
            message: `borderRadius: ${JSON.stringify(v)} — use 'var(--app-radius)' (1 is allowed for thin bars)`,
          });
      },
    };
  },
};
